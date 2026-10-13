import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { after, test } from "node:test";
import { prisma } from "@borafest/database";
import { registerEmailSender } from "@borafest/notifications";
import type { EmailMessage } from "@borafest/notifications";
import { createFixtureEvent, cleanupFixtureEvent } from "../../../api/src/__tests__/helpers";
import { expireOrder } from "../expire-orders";
import { sendExpiredRescueEmails } from "../abandoned-cart";

// Convite por e-mail × pedido que expira (2026-10-12).
// (4) O Pix do lote EMAIL pago expirou: o convite usado naquele pedido volta a
//     SENT (sem pedido, sem data de uso), na mesma transação da expiração — só
//     o DESTE pedido e só se ainda CLAIMED (revogado segue revogado).
// (3) O "Ainda dá tempo" pula pedido com lote restrito de QUALQUER modo que
//     não seja o aberto: o de convite por e-mail também (antes só o LINK).
// O e-mail é capturado aqui — nada sai para caixa de verdade.

const enviados: EmailMessage[] = [];
registerEmailSender({
  provider: "captura-expirar-convite",
  async send(mensagem) {
    enviados.push(mensagem);
  },
});
process.env.EMAIL_PROVIDER = "captura-expirar-convite";
process.env.CHECKOUT_BASE_URL = "https://borafest.com.br";

after(async () => {
  await prisma.$disconnect();
});

const rand = () => Math.random().toString(36).slice(2, 10);
const codigo = () => randomBytes(16).toString("base64url");

type Fx = Awaited<ReturnType<typeof createFixtureEvent>>;

/** Lote de convite por e-mail, pago (R$ 40), com `reservados` já presos por pedidos pendentes. */
function loteDeConvite(fx: Fx, reservados: number) {
  return prisma.ticketLot.create({
    data: {
      ticketTypeId: fx.ticketType.id,
      name: `Convidados por e-mail ${rand()}`,
      priceCents: 4000,
      feeCents: 400,
      capacity: 10,
      reservedCount: reservados,
      status: "ACTIVE",
      inviteMode: "EMAIL",
    },
  });
}

/** Pedido do lote, com a janela de pagamento já vencida (ou não, pelo status). */
async function pedido(
  fx: Fx,
  lotId: string,
  email: string,
  status: "PAYMENT_PENDING" | "PAID" | "EXPIRED",
  opcoes: { expiradoHaMin?: number } = {},
) {
  const venceuHa = (opcoes.expiradoHaMin ?? 1) * 60_000;
  const reserva = await prisma.reservation.create({
    data: { eventId: fx.event.id, status: "CONVERTED", expiresAt: new Date(Date.now() - venceuHa - 30 * 60_000) },
  });
  return prisma.order.create({
    data: {
      eventId: fx.event.id,
      reservationId: reserva.id,
      contactEmail: email,
      contactName: "Convidada Teste",
      status,
      totalCents: 4400,
      createdAt: new Date(Date.now() - venceuHa - 30 * 60_000),
      expiresAt: new Date(Date.now() - venceuHa),
      paidAt: status === "PAID" ? new Date() : null,
      items: { create: [{ ticketLotId: lotId, quantity: 1, priceCents: 4000, feeCents: 400 }] },
    },
  });
}

function convite(
  lotId: string,
  email: string,
  status: "SENT" | "CLAIMED" | "REVOKED",
  orderId: string | null,
) {
  return prisma.lotEmailInvite.create({
    data: {
      ticketLotId: lotId,
      email,
      token: codigo(),
      status,
      orderId,
      claimedAt: orderId ? new Date(Date.now() - 31 * 60_000) : null,
    },
  });
}

const reler = (id: string) => prisma.lotEmailInvite.findUniqueOrThrow({ where: { id } });

test("pedido expirado devolve o convite por e-mail dele para SENT — e só o dele", async () => {
  const fx = await createFixtureEvent({ lotCapacity: 50, priceCents: 5000, feeCents: 500 });
  try {
    const lote = await loteDeConvite(fx, 3);

    // o pedido que expira, com o convite que ele pegou
    const emailA = `convite-a-${rand()}@borafest.dev`;
    const pedidoA = await pedido(fx, lote.id, emailA, "PAYMENT_PENDING");
    const conviteA = await convite(lote.id, emailA, "CLAIMED", pedidoA.id);

    // outro convite, pego por OUTRO pedido ainda pagando: não é tocado
    const emailB = `convite-b-${rand()}@borafest.dev`;
    const pedidoB = await pedido(fx, lote.id, emailB, "PAYMENT_PENDING", { expiradoHaMin: -20 });
    const conviteB = await convite(lote.id, emailB, "CLAIMED", pedidoB.id);

    // convite que o produtor revogou com o pedido ainda pendente: segue revogado
    const emailC = `convite-c-${rand()}@borafest.dev`;
    const pedidoC = await pedido(fx, lote.id, emailC, "PAYMENT_PENDING");
    const conviteC = await convite(lote.id, emailC, "REVOKED", pedidoC.id);

    await expireOrder(pedidoA.id);

    assert.equal((await prisma.order.findUniqueOrThrow({ where: { id: pedidoA.id } })).status, "EXPIRED");
    const devolvido = await reler(conviteA.id);
    assert.equal(devolvido.status, "SENT", "o convite volta a valer");
    assert.equal(devolvido.orderId, null, "sem o pedido morto");
    assert.equal(devolvido.claimedAt, null, "sem a data de uso");
    assert.equal(devolvido.token, conviteA.token, "o link pessoal é o MESMO: a pessoa paga de novo por ele");

    const intacto = await reler(conviteB.id);
    assert.equal(intacto.status, "CLAIMED", "convite de outro pedido não é tocado");
    assert.equal(intacto.orderId, pedidoB.id);

    await expireOrder(pedidoC.id);
    const revogado = await reler(conviteC.id);
    assert.equal(revogado.status, "REVOKED", "expirar nunca desfaz uma revogação do produtor");

    // estoque dos dois expirados devolvido; o do pedido B segue reservado
    assert.equal((await prisma.ticketLot.findUniqueOrThrow({ where: { id: lote.id } })).reservedCount, 1);

    // expirar de novo (varredura repetida) não muda nada
    await expireOrder(pedidoA.id);
    const deNovo = await reler(conviteA.id);
    assert.equal(deNovo.status, "SENT");
    assert.equal((await prisma.ticketLot.findUniqueOrThrow({ where: { id: lote.id } })).reservedCount, 1);
  } finally {
    await cleanupFixtureEvent(fx.organization.id);
  }
});

test("pedido que pagou no meio do caminho não expira e o convite segue usado", async () => {
  const fx = await createFixtureEvent({ lotCapacity: 50, priceCents: 5000, feeCents: 500 });
  try {
    const lote = await loteDeConvite(fx, 0);
    const email = `convite-pago-${rand()}@borafest.dev`;
    const pago = await pedido(fx, lote.id, email, "PAID");
    const usado = await convite(lote.id, email, "CLAIMED", pago.id);

    await expireOrder(pago.id);

    assert.equal((await prisma.order.findUniqueOrThrow({ where: { id: pago.id } })).status, "PAID");
    const depois = await reler(usado.id);
    assert.equal(depois.status, "CLAIMED");
    assert.equal(depois.orderId, pago.id);
  } finally {
    await cleanupFixtureEvent(fx.organization.id);
  }
});

test("resgate 'Ainda dá tempo' pula pedido com lote de convite por e-mail (não só o de link)", async () => {
  const fx = await createFixtureEvent({ lotCapacity: 50, priceCents: 5000, feeCents: 0 });
  try {
    const lote = await loteDeConvite(fx, 0);
    // expirado há 2h: dentro da janela do resgate (1h a 6h)
    const emailConvite = `resgate-convite-email-${rand()}@borafest.dev`;
    const doConvite = await pedido(fx, lote.id, emailConvite, "EXPIRED", { expiradoHaMin: 120 });
    // controle: pedido do lote aberto da fixture, mesma janela, recebe o resgate
    const emailAberto = `resgate-aberto-${rand()}@borafest.dev`;
    await pedido(fx, fx.lot.id, emailAberto, "EXPIRED", { expiradoHaMin: 120 });

    await sendExpiredRescueEmails();

    assert.equal(enviados.filter((m) => m.to === emailAberto).length, 1, "o lote aberto recebe o resgate");
    assert.equal(enviados.filter((m) => m.to === emailConvite).length, 0, "o de convite por e-mail, não");
    const marcado = await prisma.order.findUniqueOrThrow({
      where: { id: doConvite.id },
      select: { rescueReminderSentAt: true },
    });
    assert.ok(marcado.rescueReminderSentAt, "mas fica marcado como tratado (não reavalia a cada varredura)");
  } finally {
    await cleanupFixtureEvent(fx.organization.id);
  }
});
