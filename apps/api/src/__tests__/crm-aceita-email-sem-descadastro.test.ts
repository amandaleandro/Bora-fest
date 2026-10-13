import { after, test } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@borafest/database";
import { closeRedisConnection } from "@borafest/queues";
import { CustomerCrmService } from "../customer-crm/customer-crm.service";
import { CrmReactivationService } from "../customer-crm/crm-reactivation.service";
import { OrgAccessService } from "../common/org-access.service";
import { IdempotencyService } from "../common/idempotency.service";
import { chaveDoEmail } from "../descadastro/descadastro-token";
import { cleanupFixtureEvent, createFixtureEvent } from "./helpers";

// FRENTE SERVIDOR (2026-10-12): no CRM da Casa, "Aceita e-mail" (etiqueta
// EMAIL_OPT_IN, segmento e contagem) contava quem marcou "receber ofertas" no
// perfil MESMO depois de essa pessoa clicar em "Não quero mais receber" numa
// campanha da Casa. Agora quem saiu das campanhas DESTA Casa fica fora — e a
// prévia do disparo continua dizendo quantos saíram.

after(async () => {
  await closeRedisConnection();
});

const rand = () => Math.random().toString(36).slice(2, 10);
const OUTRA_CASA = "00000000-0000-4000-8000-0000000000aa";

async function montar() {
  const fx = await createFixtureEvent({ lotCapacity: 50, priceCents: 7000, feeCents: 700 });
  const usuarios: string[] = [];
  const dono = await prisma.user.create({ data: { email: `crm-dono-${rand()}@example.com` } });
  usuarios.push(dono.id);
  await prisma.organizationMember.create({
    data: { organizationId: fx.organization.id, userId: dono.id, roleId: fx.ownerRoleId, status: "ACTIVE" },
  });

  const cliente = async (prefixo: string, aceita: boolean, emailDoPedido?: (e: string) => string) => {
    const user = await prisma.user.create({
      data: { email: `${prefixo}-${rand()}@example.com`, name: `Cliente ${prefixo}`, notifyEmailOffers: aceita },
    });
    usuarios.push(user.id);
    const reserva = await prisma.reservation.create({
      data: { eventId: fx.event.id, userId: user.id, status: "CONVERTED", expiresAt: new Date(Date.now() + 60_000) },
    });
    await prisma.order.create({
      data: {
        eventId: fx.event.id,
        reservationId: reserva.id,
        userId: user.id,
        contactEmail: emailDoPedido ? emailDoPedido(user.email!) : user.email!,
        contactName: user.name,
        status: "PAID",
        totalCents: 7000,
        paidAt: new Date(),
      },
    });
    return user;
  };

  const fica = await cliente("crm-fica", true);
  // e-mail do pedido com maiúsculas: a saída vale pela chave normalizada
  const sai = await cliente("crm-sai", true, (e) => e.toUpperCase());
  const naoAceita = await cliente("crm-nao-aceita", false);

  await prisma.marketingOptOut.create({
    data: { organizationId: fx.organization.id, emailKey: chaveDoEmail(sai.email!) },
  });
  // saiu de OUTRA Casa: não muda nada aqui
  await prisma.marketingOptOut.create({ data: { organizationId: OUTRA_CASA, emailKey: chaveDoEmail(fica.email!) } });

  const crm = new CustomerCrmService(new OrgAccessService());
  return { fx, dono, fica, sai, naoAceita, usuarios, crm };
}

type Ctx = Awaited<ReturnType<typeof montar>>;

async function desmontar(ctx: Ctx) {
  await prisma.marketingOptOut.deleteMany({
    where: { organizationId: { in: [ctx.fx.organization.id, OUTRA_CASA] } },
  });
  await prisma.organizationMember.deleteMany({ where: { organizationId: ctx.fx.organization.id } });
  await cleanupFixtureEvent(ctx.fx.organization.id);
  await prisma.user.deleteMany({ where: { id: { in: ctx.usuarios } } });
}

test("CRM: etiqueta e contagem de 'aceita e-mail' não incluem quem saiu das campanhas da Casa", async () => {
  const ctx = await montar();
  try {
    const todos = await ctx.crm.list(ctx.fx.organization.id, ctx.dono.id, { segment: "ALL" });
    assert.equal(todos.total, 3);
    assert.equal(todos.summary.emailOptIn, 1, "só quem aceita E não saiu");
    assert.equal(todos.summary.emailOptOut, 1, "quem saiu aparece na contagem própria");

    const porEmail = new Map(todos.customers.map((c) => [c.email.toLowerCase(), c]));
    const fica = porEmail.get(ctx.fica.email!.toLowerCase());
    const sai = porEmail.get(ctx.sai.email!.toLowerCase());
    const naoAceita = porEmail.get(ctx.naoAceita.email!.toLowerCase());
    assert.ok(fica && sai && naoAceita);

    assert.ok(fica.tags.includes("EMAIL_OPT_IN"), "saiu de outra Casa: aqui continua aceitando");
    assert.equal(fica.emailOffersOptIn, true);
    assert.equal(fica.saiuDasCampanhas, false);

    assert.ok(!sai.tags.includes("EMAIL_OPT_IN"), "quem saiu perde a etiqueta");
    assert.equal(sai.emailOffersOptIn, false);
    assert.equal(sai.saiuDasCampanhas, true);

    assert.ok(!naoAceita.tags.includes("EMAIL_OPT_IN"));
    assert.equal(naoAceita.saiuDasCampanhas, false);

    // o segmento "Aceitam ofertas por e-mail" traz só quem pode receber
    const segmento = await ctx.crm.list(ctx.fx.organization.id, ctx.dono.id, { segment: "EMAIL_OPT_IN" });
    assert.equal(segmento.total, 1);
    assert.deepEqual(
      segmento.customers.map((c) => c.email.toLowerCase()),
      [ctx.fica.email!.toLowerCase()],
    );

    // uso interno do disparo: traz quem saiu, marcado, para ser contado
    const interno = await ctx.crm.list(ctx.fx.organization.id, ctx.dono.id, {
      segment: "EMAIL_OPT_IN",
      incluirQuemSaiuDasCampanhas: true,
    });
    assert.equal(interno.total, 2);
    assert.equal(interno.customers.filter((c) => c.saiuDasCampanhas).length, 1);
  } finally {
    await desmontar(ctx);
  }
});

test("prévia da campanha: quem saiu continua contado à parte e fora do público", async () => {
  const ctx = await montar();
  try {
    const reactivation = new CrmReactivationService(ctx.crm, new IdempotencyService());
    const previa = await reactivation.preview(ctx.fx.organization.id, ctx.dono.id, { segment: "EMAIL_OPT_IN" });
    assert.equal(previa.eligibleCount, 1);
    assert.equal(previa.optedOutCount, 1, "o produtor sabe que 1 cliente saiu");
    assert.deepEqual(
      previa.sample.map((s) => s.email.toLowerCase()),
      [ctx.fica.email!.toLowerCase()],
    );
  } finally {
    await desmontar(ctx);
  }
});
