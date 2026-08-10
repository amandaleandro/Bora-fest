import assert from "node:assert/strict";
import { after, test } from "node:test";
import { prisma } from "@borafest/database";
import { applyGatewayStatus } from "@borafest/payments";
import { createSessionToken } from "@borafest/auth";
import { closeRedisConnection } from "@borafest/queues";
import { ReservationsService } from "../reservations/reservations.service";
import { CouponsService } from "../coupons/coupons.service";
import { OrgAccessService } from "../common/org-access.service";
import { OrdersService } from "../orders/orders.service";
import { PaymentsService } from "../payments/payments.service";
import { InventoryService } from "../inventory/inventory.service";
import { WaitingRoomService } from "../waiting-room/waiting-room.service";
import { IdempotencyService } from "../common/idempotency.service";
import { IdentityService } from "../identity/identity.service";
import { TicketsService } from "../tickets/tickets.service";
import { issueTicketsForOrder } from "../../../worker/src/issue-tickets";
import { createFixtureEvent, cleanupFixtureEvent } from "./helpers";

after(async () => {
  await closeRedisConnection();
});

async function comprar(eventId: string, lotId: string, email: string, cpf: string) {
  const reservations = new ReservationsService(new InventoryService(), new WaitingRoomService());
  const orders = new OrdersService(new CouponsService(new OrgAccessService()), new OrgAccessService());
  const payments = new PaymentsService(new IdempotencyService());
  const reservation = await reservations.create(undefined, {
    eventId,
    items: [{ ticketLotId: lotId, quantity: 1 }],
  });
  const order = await orders.createFromReservation(undefined, {
    reservationId: reservation.id,
    contactEmail: email,
    contactName: "Comprador Novo",
    contactPhone: `349${Math.floor(Math.random() * 1e8)}`,
    contactCpf: cpf,
  } as never);
  const payment = await payments.createPix(order.id, {});
  await applyGatewayStatus(payment.id, "PAID");
  return order;
}

test("conta invisível: compra cria conta com CPF, tranca o 1º ingresso e verificação abre", async () => {
  const f = await createFixtureEvent({ lotCapacity: 5, priceCents: 5000, feeCents: 0 });
  const email = `novo-${Math.random().toString(36).slice(2, 8)}@borafest.dev`;
  const cpf = `${Math.floor(10000000000 + Math.random() * 8e10)}`;
  try {
    const order = await comprar(f.event.id, f.lot.id, email, cpf);

    // conta nasceu dos dados da compra, ainda não verificada
    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    assert.equal(user.cpf, cpf, "CPF da compra vira o CPF da conta");
    assert.equal(user.emailVerifiedAt, null, "conta nasce não verificada");
    const pedido = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    assert.equal(pedido.userId, user.id, "pedido anexado à conta");

    // emissão: notificação vira AVISO (account_claim) sem entrega de QR
    await issueTicketsForOrder(order.id);
    const notificacoes = await prisma.notification.findMany({ where: { orderId: order.id } });
    assert.equal(notificacoes.length, 1, "só o aviso — nada de QR por e-mail/wpp");
    assert.equal(notificacoes[0].template, "account_claim");
    const payload = notificacoes[0].payload as { claimUrl?: string };
    assert.ok(payload.claimUrl?.includes("/acesso?token="), "aviso carrega o link mágico");

    // carteira trancada antes de verificar
    const tickets = new TicketsService();
    const trancado = await tickets.findByOrderPublicToken(pedido.publicToken);
    assert.equal(trancado.requiresVerification, true);
    assert.equal(trancado.tickets.length, 0, "QR não aparece sem verificação");

    // link mágico: verifica, loga e destrava
    const identity = new IdentityService();
    const magic = await createSessionToken(
      { sub: user.id, purpose: "email-verify", orderToken: pedido.publicToken },
      "7d",
    );
    const sessao = await identity.verifyMagicLink(magic);
    assert.ok(sessao.token, "sessão emitida");
    assert.equal(sessao.orderToken, pedido.publicToken);
    const verificado = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    assert.ok(verificado.emailVerifiedAt, "conta verificada pelo clique");

    const aberto = await tickets.findByOrderPublicToken(pedido.publicToken);
    assert.equal(aberto.requiresVerification, false);
    assert.equal(aberto.tickets.length, 1, "QR liberado");

    // 2ª compra do MESMO e-mail: segue o jogo — entrega normal por e-mail
    const order2 = await comprar(f.event.id, f.lot.id, email, cpf);
    await issueTicketsForOrder(order2.id);
    const n2 = await prisma.notification.findMany({ where: { orderId: order2.id } });
    assert.ok(
      n2.some((n) => n.template === "ticket_delivery" && n.channel === "EMAIL"),
      "verificado recebe o ingresso por e-mail normalmente",
    );
  } finally {
    await cleanupFixtureEvent(f.organization.id);
    await prisma.user.deleteMany({ where: { email } });
  }
});

test("corrigir e-mail digitado errado: sessão pagante troca e o aviso reenvia", async () => {
  const f = await createFixtureEvent({ lotCapacity: 5, priceCents: 5000, feeCents: 0 });
  const errado = `errado-${Math.random().toString(36).slice(2, 8)}@borafest.dev`;
  const certo = `certo-${Math.random().toString(36).slice(2, 8)}@borafest.dev`;
  try {
    const order = await comprar(f.event.id, f.lot.id, errado, `${Math.floor(10000000000 + Math.random() * 8e10)}`);
    const pedido = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });

    const orders = new OrdersService(new CouponsService(new OrgAccessService()), new OrgAccessService());
    const res = await orders.correctEmail(pedido.publicToken, certo);
    assert.equal(res.contactEmail, certo);

    const user = await prisma.user.findUniqueOrThrow({ where: { email: certo } });
    assert.equal(user.emailVerifiedAt, null);
    const reenvio = await prisma.notification.findFirst({
      where: { orderId: order.id, template: "account_claim", recipient: certo },
    });
    assert.ok(reenvio, "aviso reenviado para o e-mail corrigido");

    // depois de verificada, correção fecha
    await prisma.user.update({ where: { id: user.id }, data: { emailVerifiedAt: new Date() } });
    await assert.rejects(
      () => orders.correctEmail(pedido.publicToken, "outro@borafest.dev"),
      /verificada/,
    );
  } finally {
    await cleanupFixtureEvent(f.organization.id);
    await prisma.user.deleteMany({ where: { email: { in: [errado, certo] } } });
  }
});
