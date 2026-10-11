import { test, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@borafest/database";
import { computePlatformFeeCents } from "@borafest/payments";
import { closeRedisConnection } from "@borafest/queues";
import { CatalogService } from "../catalog/catalog.service";
import { ReservationsService } from "../reservations/reservations.service";
import { CouponsService } from "../coupons/coupons.service";
import { OrgAccessService } from "../common/org-access.service";
import { OrdersService } from "../orders/orders.service";
import { InventoryService } from "../inventory/inventory.service";
import { WaitingRoomService } from "../waiting-room/waiting-room.service";
import { createFixtureEvent, cleanupFixtureEvent } from "./helpers";

// Mínimo do pagamento online + limite por CPF à prova de corrida (2026-10-11).
// (1) pedido entre R$ 0,01 e o mínimo é recusado ANTES de gravar qualquer coisa;
// (2) lote pago abaixo do mínimo nem nasce; (3) dois pedidos simultâneos do
// mesmo CPF num lote "1 por pessoa" → só um passa.

// o mínimo vem do ambiente; o teste fixa R$ 5,00 para as contas serem estas
process.env.PAYMENT_MIN_CHARGE_CENTS = "500";
const MINIMO = 500;

after(async () => {
  await closeRedisConnection();
});

const rand = () => Math.random().toString(36).slice(2, 10);
const semOverride = { pixFeeBps: null, pixFeeFloorCents: null, cardFeeBps: null };
const taxa = (precoCents: number) => computePlatformFeeCents("PIX", precoCents, semOverride);
const consent = { version: "2026-08", terms: true as const, privacy: true as const };

/** CPF válido aleatório: cada execução usa CPFs que nenhum pedido antigo tem. */
function geraCpf(): string {
  const n = Array.from({ length: 9 }, () => Math.floor(Math.random() * 10));
  const dv = (base: number[]) => {
    const soma = base.reduce((acc, d, i) => acc + d * (base.length + 1 - i), 0);
    const r = (soma * 10) % 11;
    return r === 10 ? 0 : r;
  };
  const d1 = dv(n);
  const d2 = dv([...n, d1]);
  return [...n, d1, d2].join("");
}

async function montar(fixture: { priceCents: number; feeCents: number }) {
  const fx = await createFixtureEvent({ lotCapacity: 50, ...fixture });
  const dono = await prisma.user.create({ data: { email: `dono-${rand()}@borafest.dev` } });
  await prisma.organizationMember.create({
    data: { organizationId: fx.organization.id, userId: dono.id, roleId: fx.ownerRoleId, status: "ACTIVE" },
  });
  const catalog = new CatalogService(new OrgAccessService(), new InventoryService());
  const reservations = new ReservationsService(new InventoryService(), new WaitingRoomService());
  const orders = new OrdersService(new CouponsService(new OrgAccessService()), new OrgAccessService());
  return { fx, dono, catalog, reservations, orders, emails: [] as string[] };
}

async function desmontar(ctx: Awaited<ReturnType<typeof montar>>) {
  const pedidos = await prisma.order.findMany({ where: { eventId: ctx.fx.event.id }, select: { id: true } });
  await prisma.outboxEvent.deleteMany({ where: { aggregateId: { in: pedidos.map((p) => p.id) } } });
  await prisma.organizationMember.deleteMany({ where: { organizationId: ctx.fx.organization.id } });
  // cupons e resgates saem em cascata com o evento e os pedidos
  await cleanupFixtureEvent(ctx.fx.organization.id);
  await prisma.user.deleteMany({ where: { email: { in: ctx.emails } } }).catch(() => undefined);
  await prisma.user.delete({ where: { id: ctx.dono.id } }).catch(() => undefined);
}

function criarLote(ctx: Awaited<ReturnType<typeof montar>>, extra: Record<string, unknown>) {
  return ctx.catalog.createLot(ctx.fx.ticketType.id, ctx.dono.id, {
    name: `Lote ${rand()}`,
    priceCents: 0,
    feeCents: 0,
    capacity: 10,
    maxPerOrder: 6,
    ...extra,
  } as never);
}

const erroDoMinimoNoPedido = (e: unknown) =>
  e instanceof Error && /pagamento online começa em R\$\s?5,00/.test(e.message) && /aumente a quantidade/.test(e.message);

test("pedido de R$ 3 é recusado antes de gravar qualquer coisa (nem pedido, nem cupom, nem conta)", async () => {
  // lote de R$ 50 + R$ 5 de taxa (comprador paga)
  const ctx = await montar({ priceCents: 5000, feeCents: 500 });
  try {
    // cupom fixo de R$ 52 em R$ 55 → sobra R$ 3, abaixo do mínimo
    const cupom = await prisma.coupon.create({
      data: { eventId: ctx.fx.event.id, code: "QUASETUDO", discountType: "FIXED", discountValue: 5200, maxRedemptions: 1 },
    });
    const reserva = await ctx.reservations.create(undefined, {
      eventId: ctx.fx.event.id,
      items: [{ ticketLotId: ctx.fx.lot.id, quantity: 1 }],
    });
    const email = `minimo-${rand()}@example.com`;
    ctx.emails.push(email);

    await assert.rejects(
      ctx.orders.createFromReservation(undefined, {
        reservationId: reserva.id,
        contactEmail: email,
        couponCode: "QUASETUDO",
        consent,
      }),
      erroDoMinimoNoPedido,
    );

    assert.equal(await prisma.order.count({ where: { eventId: ctx.fx.event.id } }), 0, "nenhum pedido nasce");
    const cupomDepois = await prisma.coupon.findUniqueOrThrow({ where: { id: cupom.id } });
    assert.equal(cupomDepois.redeemedCount, 0, "o cupom de uso único não é gasto");
    assert.equal(await prisma.couponRedemption.count({ where: { couponId: cupom.id } }), 0, "nenhum uso de cupom");
    assert.equal(await prisma.user.count({ where: { email } }), 0, "nenhuma conta criada");
    const reservaDepois = await prisma.reservation.findUniqueOrThrow({ where: { id: reserva.id } });
    assert.equal(reservaDepois.status, "ACTIVE", "a reserva continua dele para voltar e mudar a quantidade");

    // lote antigo (criado antes da trava no painel): R$ 2,50 + taxa também é recusado
    const loteAntigo = await prisma.ticketLot.create({
      data: {
        ticketTypeId: ctx.fx.ticketType.id,
        name: "Lote antigo barato",
        priceCents: 250,
        feeCents: taxa(250),
        capacity: 5,
        status: "ACTIVE",
      },
    });
    assert.ok(250 + taxa(250) < MINIMO, "sanidade: o lote antigo fica abaixo do mínimo");
    const reservaAntiga = await ctx.reservations.create(undefined, {
      eventId: ctx.fx.event.id,
      items: [{ ticketLotId: loteAntigo.id, quantity: 1 }],
    });
    await assert.rejects(
      ctx.orders.createFromReservation(undefined, { reservationId: reservaAntiga.id, contactEmail: email, consent }),
      erroDoMinimoNoPedido,
    );
    assert.equal(await prisma.order.count({ where: { eventId: ctx.fx.event.id } }), 0);

    // no mínimo exato o pedido nasce normalmente e vai para pagamento
    await prisma.coupon.create({
      data: { eventId: ctx.fx.event.id, code: "NOLIMITE", discountType: "FIXED", discountValue: 5500 - MINIMO },
    });
    const reservaNoLimite = await ctx.reservations.create(undefined, {
      eventId: ctx.fx.event.id,
      items: [{ ticketLotId: ctx.fx.lot.id, quantity: 1 }],
    });
    const pedido = await ctx.orders.createFromReservation(undefined, {
      reservationId: reservaNoLimite.id,
      contactEmail: email,
      couponCode: "NOLIMITE",
      consent,
    });
    assert.equal(pedido.totalCents, MINIMO);
    assert.equal(pedido.status, "PAYMENT_PENDING");
  } finally {
    await desmontar(ctx);
  }
});

test("lote pago abaixo do mínimo é recusado na criação; R$ 0 e lote só de balcão são aceitos", async () => {
  const ctx = await montar({ priceCents: 0, feeCents: 0 });
  try {
    const recusados: string[] = [];
    const recusar = async (extra: Record<string, unknown>, padrao: RegExp) => {
      const name = `Recusado ${rand()}`;
      recusados.push(name);
      await assert.rejects(criarLote(ctx, { name, ...extra }), padrao);
    };

    // comprador paga a taxa: R$ 3 + taxa fica abaixo de R$ 5
    assert.ok(300 + taxa(300) < MINIMO, "sanidade: R$ 3 + taxa < mínimo");
    await recusar({ priceCents: 300 }, /pelo menos R\$\s?5,00 para o comprador.*Para dar de graça, use R\$ 0/);

    // produtor absorve a taxa: o comprador paga só o preço — R$ 4,50 não passa,
    // mesmo que com a taxa somada passasse
    assert.ok(450 + taxa(450) >= MINIMO, "sanidade: com a taxa somada passaria");
    await recusar({ priceCents: 450, feeMode: "PRODUCER" }, /pelo menos R\$\s?5,00/);

    // meia-entrada: metade do preço com a taxa cheia
    assert.ok(700 + taxa(700) >= MINIMO, "sanidade: a inteira passa");
    assert.ok(Math.round(700 / 2) + taxa(700) < MINIMO, "sanidade: a meia fica abaixo");
    await recusar({ priceCents: 700, halfPriceEnabled: true }, /meia-entrada sairia por .*desmarque a meia-entrada/);

    const nomes = await prisma.ticketLot.count({ where: { ticketTypeId: ctx.fx.ticketType.id, name: { in: recusados } } });
    assert.equal(nomes, 0, "nenhum lote recusado foi gravado");

    // aceitos
    const inteira = await criarLote(ctx, { priceCents: 700 });
    assert.equal(inteira.priceCents, 700, "a mesma inteira sem meia passa");

    const gratis = await criarLote(ctx, { priceCents: 0 });
    assert.equal(gratis.priceCents, 0, "R$ 0 é grátis, não passa pelo banco");
    assert.equal(gratis.feeCents, 0);

    const balcao = await criarLote(ctx, { priceCents: 300, pdvOnly: true });
    assert.equal(balcao.pdvOnly, true, "lote só de balcão pode ser barato: na porta tem dinheiro");

    const preco = 400;
    if (preco + taxa(preco) >= MINIMO) {
      const noLimite = await criarLote(ctx, { priceCents: preco });
      assert.ok(noLimite.priceCents + noLimite.feeCents >= MINIMO, "no mínimo exato passa");
    }
  } finally {
    await desmontar(ctx);
  }
});

test("limite por CPF: dois pedidos simultâneos do mesmo CPF num lote de 1 por pessoa → só um passa", async () => {
  const ctx = await montar({ priceCents: 0, feeCents: 0 });
  try {
    const lote = await criarLote(ctx, { priceCents: 0, limitPerCpf: 1 });
    await prisma.ticketLot.update({ where: { id: lote.id }, data: { status: "ACTIVE" } });

    // e-mails de contas que já existem: o pedido não cria conta, então a corrida
    // é só a do limite (duas contas novas com o mesmo CPF brigariam pelo CPF único)
    const emailA = `corrida-a-${rand()}@example.com`;
    const emailB = `corrida-b-${rand()}@example.com`;
    ctx.emails.push(emailA, emailB);
    await prisma.user.createMany({ data: [{ email: emailA }, { email: emailB }] });

    const cpf = geraCpf();
    const reservar = () =>
      ctx.reservations.create(undefined, { eventId: ctx.fx.event.id, items: [{ ticketLotId: lote.id, quantity: 1 }] });
    const [r1, r2] = await Promise.all([reservar(), reservar()]);

    const resultados = await Promise.allSettled([
      ctx.orders.createFromReservation(undefined, { reservationId: r1.id, contactEmail: emailA, contactCpf: cpf, consent }),
      ctx.orders.createFromReservation(undefined, { reservationId: r2.id, contactEmail: emailB, contactCpf: cpf, consent }),
    ]);

    const passaram = resultados.filter((r) => r.status === "fulfilled");
    const recusados = resultados.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    assert.equal(passaram.length, 1, "exatamente um pedido passa");
    assert.equal(recusados.length, 1);
    assert.match(String((recusados[0].reason as Error)?.message), /já garantiu/, "o outro é recusado pelo limite");

    const soma = await prisma.orderItem.aggregate({
      _sum: { quantity: true },
      where: { ticketLotId: lote.id, order: { contactCpf: cpf } },
    });
    assert.equal(soma._sum.quantity, 1, "o CPF fica com 1 ingresso só");
    const pedidos = await prisma.order.count({ where: { eventId: ctx.fx.event.id } });
    assert.equal(pedidos, 1, "o recusado não deixa pedido pra trás");
    const loteDepois = await prisma.ticketLot.findUniqueOrThrow({ where: { id: lote.id } });
    assert.equal(loteDepois.soldCount, 1, "só um ingresso sai do estoque");
  } finally {
    await desmontar(ctx);
  }
});
