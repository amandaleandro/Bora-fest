import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { prisma } from "@borafest/database";
import { OrgAccessService } from "../common/org-access.service";
import { PublicVipStatusService } from "../vip/public-vip-status.service";
import { VipService } from "../vip/vip.service";
import { cleanupFixtureEvent, createFixtureEvent } from "./helpers";

let fixture: Awaited<ReturnType<typeof createFixtureEvent>>;
let ownerId = "";
let inventoryId = "";
const vip = new VipService(new OrgAccessService());
const publicStatus = new PublicVipStatusService();

describe("N8 — reservas VIP", () => {
  before(async () => {
    fixture = await createFixtureEvent({ lotCapacity: 100, priceCents: 4000, feeCents: 0 });
    const startsAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await prisma.event.update({
      where: { id: fixture.event.id },
      data: {
        status: "PUBLISHED",
        startsAt,
        endsAt: new Date(startsAt.getTime() + 6 * 60 * 60 * 1000),
      },
    });

    const owner = await prisma.user.create({ data: { email: `vip-owner-${Date.now()}@example.com` } });
    ownerId = owner.id;
    await prisma.organizationMember.create({
      data: {
        organizationId: fixture.organization.id,
        userId: owner.id,
        roleId: fixture.ownerRoleId,
        status: "ACTIVE",
      },
    });

    const inventory = await vip.createInventory(fixture.event.id, ownerId, {
      kind: "CAMAROTE",
      name: "Camarote Teste",
      description: "Última unidade",
      benefits: "Acesso reservado",
      unitPriceCents: 50_000,
      quantity: 1,
      capacityPerUnit: 4,
      maxUnitsPerReservation: 1,
    });
    inventoryId = inventory.id;
  });

  after(async () => {
    await cleanupFixtureEvent(fixture.organization.id);
    if (ownerId) await prisma.user.delete({ where: { id: ownerId } }).catch(() => undefined);
  });

  it("publica disponibilidade e congela o preço no pedido", async () => {
    const publicView = await vip.publicInventory(fixture.event.slug);
    assert.equal(publicView.spaces.length, 1);
    assert.equal(publicView.spaces[0]?.availableUnits, 1);

    const request = await vip.requestReservation(fixture.event.slug, {
      inventoryId,
      contactName: "Ana VIP",
      contactEmail: "ANA.VIP@EXAMPLE.COM",
      contactPhone: "34999990000",
      partySize: 4,
      units: 1,
      customerNote: "Aniversário",
    });
    await vip.updateInventory(inventoryId, ownerId, { unitPriceCents: 60_000 });

    const stored = await prisma.vipReservation.findUniqueOrThrow({ where: { id: request.id } });
    assert.equal(stored.contactEmail, "ana.vip@example.com");
    assert.equal(stored.unitPriceCents, 50_000);
    assert.equal(stored.totalCents, 50_000);
  });

  it("não aceita grupo maior que a capacidade solicitada", async () => {
    await assert.rejects(
      () => vip.requestReservation(fixture.event.slug, {
        inventoryId,
        contactName: "Grupo Grande",
        contactEmail: "grupo@example.com",
        contactPhone: "34999990001",
        partySize: 5,
        units: 1,
      }),
      /capacidade/,
    );
  });

  it("serializa confirmações concorrentes e nunca faz overbooking", async () => {
    const one = await vip.requestReservation(fixture.event.slug, {
      inventoryId,
      contactName: "Cliente Um",
      contactEmail: "vip-um@example.com",
      contactPhone: "34999990002",
      partySize: 4,
      units: 1,
    });
    const two = await vip.requestReservation(fixture.event.slug, {
      inventoryId,
      contactName: "Cliente Dois",
      contactEmail: "vip-dois@example.com",
      contactPhone: "34999990003",
      partySize: 4,
      units: 1,
    });

    const results = await Promise.allSettled([
      vip.confirmReservation(one.id, ownerId, {}),
      vip.confirmReservation(two.id, ownerId, {}),
    ]);
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(results.filter((result) => result.status === "rejected").length, 1);

    const confirmed = await prisma.vipReservation.aggregate({
      where: { vipInventoryId: inventoryId, status: "CONFIRMED" },
      _sum: { units: true },
    });
    assert.equal(confirmed._sum.units, 1);

    const view = await vip.listInventory(fixture.event.id, ownerId);
    const item = view.find((space) => space.id === inventoryId);
    assert.equal(item?.confirmedUnits, 1);
    assert.equal(item?.availableUnits, 0);
  });

  it("não permite reduzir inventário abaixo do já confirmado", async () => {
    await assert.rejects(
      () => vip.updateInventory(inventoryId, ownerId, { quantity: 0 } as any),
      /quantidade/,
    );

    const current = await prisma.vipInventory.findUniqueOrThrow({ where: { id: inventoryId } });
    assert.equal(current.quantity, 1);
  });

  it("serializa confirmar e recusar a mesma solicitação", async () => {
    const secondInventory = await vip.createInventory(fixture.event.id, ownerId, {
      kind: "MESA",
      name: "Mesa concorrência",
      unitPriceCents: 20_000,
      quantity: 1,
      capacityPerUnit: 4,
      maxUnitsPerReservation: 1,
    });
    const request = await vip.requestReservation(fixture.event.slug, {
      inventoryId: secondInventory.id,
      contactName: "Cliente Decisão",
      contactEmail: "decisao-vip@example.com",
      contactPhone: "34999990004",
      partySize: 2,
      units: 1,
    });

    const results = await Promise.allSettled([
      vip.confirmReservation(request.id, ownerId, {}),
      vip.rejectReservation(request.id, ownerId, {}),
    ]);
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(results.filter((result) => result.status === "rejected").length, 1);

    const stored = await prisma.vipReservation.findUniqueOrThrow({ where: { id: request.id } });
    assert.ok(stored.status === "CONFIRMED" || stored.status === "REJECTED");
    const inventory = await vip.listInventory(fixture.event.id, ownerId);
    const row = inventory.find((space) => space.id === secondInventory.id);
    assert.equal(row?.availableUnits, stored.status === "CONFIRMED" ? 0 : 1);
  });

  it("expõe status público sem vazar dados pessoais", async () => {
    const inventory = await vip.createInventory(fixture.event.id, ownerId, {
      kind: "LOUNGE",
      name: "Lounge status",
      unitPriceCents: 30_000,
      quantity: 2,
      capacityPerUnit: 6,
      maxUnitsPerReservation: 1,
    });
    const request = await vip.requestReservation(fixture.event.slug, {
      inventoryId: inventory.id,
      contactName: "Cliente Privado",
      contactEmail: "privado@example.com",
      contactPhone: "34999990005",
      partySize: 4,
      units: 1,
    });

    const pending = await publicStatus.get(request.publicToken);
    assert.equal(pending.status, "REQUESTED");
    assert.equal("contactEmail" in pending, false);
    assert.equal("contactPhone" in pending, false);
    assert.equal("contactName" in pending, false);

    await vip.confirmReservation(request.id, ownerId, { note: "Entrada pela fila VIP" });
    const confirmed = await publicStatus.get(request.publicToken);
    assert.equal(confirmed.status, "CONFIRMED");
    assert.equal(confirmed.resolutionNote, "Entrada pela fila VIP");
    assert.equal(confirmed.inventory.event.slug, fixture.event.slug);
  });
});
