import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { prisma } from "@borafest/database";
import { ticketThemeSchema } from "@borafest/contracts";
import { StoreService } from "../store/store.service";
import { EventsService } from "../events/events.service";
import { cleanupFixtureEvent, createFixtureEvent } from "./helpers";

describe("Loja da Casa + Ticket Studio", () => {
  let fixture: Awaited<ReturnType<typeof createFixtureEvent>>;
  const access = { assertPermission: async () => undefined } as any;
  const store = new StoreService(access);
  const events = new EventsService(access);

  before(async () => {
    fixture = await createFixtureEvent({ lotCapacity: 20 });
  });

  after(async () => {
    await cleanupFixtureEvent(fixture.organization.id);
    await prisma.$disconnect();
  });

  it("criações concorrentes com o mesmo nome recebem slugs distintos", async () => {
    const [a, b] = await Promise.all([
      store.createProduct(fixture.organization.id, "actor", { name: "Produto concorrente" }),
      store.createProduct(fixture.organization.id, "actor", { name: "Produto concorrente" }),
    ]);

    assert.notEqual(a.slug, b.slug);
    assert.equal(a.organizationId, fixture.organization.id);
    assert.equal(b.organizationId, fixture.organization.id);
  });

  it("não publica produto sem variação ativa", async () => {
    const product = await store.createProduct(fixture.organization.id, "actor", {
      name: "Camiseta oficial",
      description: "Modelo da Casa",
    });

    await assert.rejects(
      () => store.updateProduct(product.id, "actor", { status: "ACTIVE" }),
      /variação ativa/i,
    );
  });

  it("publica produto com variação e calcula estoque disponível", async () => {
    const product = await store.createProduct(fixture.organization.id, "actor", {
      name: "Copo oficial",
    });
    const variant = await store.createVariant(product.id, "actor", {
      name: "500ml",
      sku: "COPO-500",
      priceCents: 2000,
      stockTotal: 40,
    });

    await prisma.storeProductVariant.update({
      where: { id: variant.id },
      data: { soldCount: 7, reservedCount: 3 },
    });

    await store.updateProduct(product.id, "actor", { status: "ACTIVE" });
    const publicStore = await store.listPublicByHouseSlug(fixture.organization.slug);
    const listed = publicStore.products.find((item) => item.id === product.id);

    assert.ok(listed);
    assert.equal(listed!.variants[0].available, 30);
  });

  it("produto publicado não pode perder a última variação ativa", async () => {
    const product = await store.createProduct(fixture.organization.id, "actor", {
      name: "Produto publicado",
    });
    const variant = await store.createVariant(product.id, "actor", {
      name: "Padrão",
      sku: "ULTIMA-ATIVA",
      priceCents: 2500,
      stockTotal: 8,
    });
    await store.updateProduct(product.id, "actor", { status: "ACTIVE" });

    await assert.rejects(
      () => store.updateVariant(variant.id, "actor", { active: false }),
      /precisa manter pelo menos uma variação ativa/i,
    );

    const saved = await prisma.storeProductVariant.findUniqueOrThrow({ where: { id: variant.id } });
    assert.equal(saved.active, true);
  });

  it("trata nome ou SKU duplicado como erro de negócio", async () => {
    const product = await store.createProduct(fixture.organization.id, "actor", {
      name: "Produto duplicidade",
    });
    await store.createVariant(product.id, "actor", {
      name: "P",
      sku: "SKU-UNICO",
      priceCents: 1000,
      stockTotal: 5,
    });

    await assert.rejects(
      () =>
        store.createVariant(product.id, "actor", {
          name: "P",
          sku: "OUTRO-SKU",
          priceCents: 1200,
          stockTotal: 5,
        }),
      /Já existe uma variação/,
    );
    await assert.rejects(
      () =>
        store.createVariant(product.id, "actor", {
          name: "M",
          sku: "SKU-UNICO",
          priceCents: 1200,
          stockTotal: 5,
        }),
      /Já existe uma variação/,
    );
  });

  it("não deixa estoque total menor que vendido + reservado", async () => {
    const variant = await prisma.storeProductVariant.findFirstOrThrow({
      where: { product: { organizationId: fixture.organization.id } },
      orderBy: { createdAt: "desc" },
    });

    await prisma.storeProductVariant.update({
      where: { id: variant.id },
      data: { soldCount: 5, reservedCount: 2, stockTotal: 10 },
    });

    await assert.rejects(
      () => store.updateVariant(variant.id, "actor", { stockTotal: 6 }),
      /abaixo do que já foi vendido ou reservado/i,
    );
  });

  it("banco também impede estoque abaixo de vendido + reservado", async () => {
    const product = await store.createProduct(fixture.organization.id, "actor", {
      name: "Produto com constraint",
    });
    const variant = await store.createVariant(product.id, "actor", {
      name: "Único",
      sku: "CONSTRAINT-ESTOQUE",
      priceCents: 1500,
      stockTotal: 10,
    });

    await prisma.storeProductVariant.update({
      where: { id: variant.id },
      data: { soldCount: 6, reservedCount: 2 },
    });

    await assert.rejects(
      () =>
        prisma.storeProductVariant.update({
          where: { id: variant.id },
          data: { stockTotal: 7 },
        }),
      "a constraint do banco deve proteger estoque mesmo se alguém contornar o service",
    );
  });

  it("não vaza loja de organização excluída do catálogo público", async () => {
    const previous = process.env.PUBLIC_CATALOG_EXCLUDED_ORG_SLUGS;
    process.env.PUBLIC_CATALOG_EXCLUDED_ORG_SLUGS = fixture.organization.slug;

    try {
      await assert.rejects(
        () => store.listPublicByHouseSlug(fixture.organization.slug),
        /Casa não encontrada/,
      );
    } finally {
      if (previous === undefined) delete process.env.PUBLIC_CATALOG_EXCLUDED_ORG_SLUGS;
      else process.env.PUBLIC_CATALOG_EXCLUDED_ORG_SLUGS = previous;
    }
  });

  it("valida e persiste tema visual sem tocar na segurança do ingresso", async () => {
    const theme = ticketThemeSchema.parse({
      template: "FESTA",
      primaryColor: "#DB2777",
      secondaryColor: "#581C87",
      sponsorText: "Apresentado pela Casa",
      showVenue: true,
      showLot: false,
      showAttendee: true,
    });

    await events.update(fixture.event.id, "actor", { ticketTheme: theme } as any);
    const saved = await prisma.event.findUniqueOrThrow({ where: { id: fixture.event.id } });

    assert.deepEqual(saved.ticketTheme, theme);
  });

  it("recusa asset externo no Ticket Studio mesmo com HTTPS válido", async () => {
    await assert.rejects(
      () =>
        events.update(fixture.event.id, "actor", {
          ticketTheme: {
            template: "CLASSIC",
            primaryColor: "#6D28D9",
            secondaryColor: "#111827",
            backgroundImageUrl: "https://tracker.example.com/fundo.jpg",
            showVenue: true,
            showLot: true,
            showAttendee: true,
          },
        } as any),
      /hospedada pelo BoraFest/,
    );
  });

  it("recusa cores inválidas no Ticket Studio", () => {
    assert.throws(() =>
      ticketThemeSchema.parse({
        template: "CLASSIC",
        primaryColor: "javascript:alert(1)",
        secondaryColor: "#111827",
      }),
    );
  });
});
