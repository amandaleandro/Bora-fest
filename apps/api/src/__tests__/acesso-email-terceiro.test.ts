import assert from "node:assert/strict";
import { after, test } from "node:test";
import { prisma } from "@borafest/database";
import { applyGatewayStatus } from "@borafest/payments";
import { closeRedisConnection } from "@borafest/queues";
import { ReservationsService } from "../reservations/reservations.service";
import { CouponsService } from "../coupons/coupons.service";
import { OrgAccessService } from "../common/org-access.service";
import { OrdersService } from "../orders/orders.service";
import { PaymentsService } from "../payments/payments.service";
import { InventoryService } from "../inventory/inventory.service";
import { WaitingRoomService } from "../waiting-room/waiting-room.service";
import { IdempotencyService } from "../common/idempotency.service";
import { NotificationsService } from "../notifications/notifications.service";
import { destinoDoLinkDeAcesso, issueTicketsForOrder } from "../../../worker/src/issue-tickets";
import { createFixtureEvent, cleanupFixtureEvent } from "./helpers";

// LINK DE ACESSO NO E-MAIL DE OUTRA PESSOA (2026-10-12). O account_claim leva
// um link que verifica e ENTRA na conta. Ele só pode ir para o contactEmail
// quando a conta nasceu do pedido; conta que já existia recebe no e-mail dela.

after(async () => {
  await closeRedisConnection();
});

test("destino do link: contato só quando a conta nasceu do pedido", () => {
  const conta = { email: "dona@borafest.dev" };
  assert.equal(
    destinoDoLinkDeAcesso({ accountCreatedByOrder: true, contactEmail: "dona@borafest.dev", user: conta }),
    "dona@borafest.dev",
    "conta nascida do pedido: o contato é o e-mail da conta",
  );
  assert.equal(
    destinoDoLinkDeAcesso({ accountCreatedByOrder: false, contactEmail: "terceiro@borafest.dev", user: conta }),
    "dona@borafest.dev",
    "conta que já existia: vai para o e-mail da conta, nunca para o contato",
  );
  assert.equal(
    destinoDoLinkDeAcesso({ accountCreatedByOrder: false, contactEmail: "terceiro@borafest.dev", user: { email: null } }),
    null,
    "conta sem e-mail: sem destino seguro",
  );
  assert.equal(
    destinoDoLinkDeAcesso({ accountCreatedByOrder: false, contactEmail: "terceiro@borafest.dev", user: null }),
    null,
    "pedido sem conta: não há link de conta",
  );
});

test("logado e não verificado com e-mail de terceiro no checkout: o terceiro não recebe link da conta", async () => {
  const f = await createFixtureEvent({ lotCapacity: 5, priceCents: 5000, feeCents: 0 });
  const sufixo = Math.random().toString(36).slice(2, 8);
  const emailDona = `dona-${sufixo}@borafest.dev`;
  const emailTerceiro = `terceiro-${sufixo}@borafest.dev`;
  try {
    // produtora com conta por senha: logada, mas e-mail ainda não verificado
    const dona = await prisma.user.create({
      data: { email: emailDona, passwordHash: "hash-falso", name: "Dona da Conta" },
    });

    const reservations = new ReservationsService(new InventoryService(), new WaitingRoomService());
    const orders = new OrdersService(new CouponsService(new OrgAccessService()), new OrgAccessService());
    const payments = new PaymentsService(new IdempotencyService());
    const reservation = await reservations.create(dona.id, {
      eventId: f.event.id,
      items: [{ ticketLotId: f.lot.id, quantity: 1 }],
    });
    const order = await orders.createFromReservation(dona.id, {
      reservationId: reservation.id,
      contactEmail: emailTerceiro,
      contactName: "Pessoa Terceira",
    } as never);
    const payment = await payments.createPix(order.id, {});
    await applyGatewayStatus(payment.id, "PAID");

    const pedido = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    assert.equal(pedido.userId, dona.id, "pedido é da conta logada");
    assert.equal(pedido.accountCreatedByOrder, false, "a conta já existia");

    // emissão: o link vai para o e-mail DA CONTA; o contato não recebe nada
    await issueTicketsForOrder(order.id);
    const naEmissao = await prisma.notification.findMany({ where: { orderId: order.id } });
    const claims = naEmissao.filter((n) => n.template === "account_claim");
    assert.equal(claims.length, 1, "um aviso de acesso");
    assert.equal(claims[0].recipient, emailDona, "o comprador legítimo (dono da conta) recebe o acesso");
    assert.ok(
      !naEmissao.some((n) => n.recipient.toLowerCase() === emailTerceiro),
      "o e-mail de contato digitado não recebe link que entra na conta",
    );
    const payload = claims[0].payload as { contactName?: string | null; claimUrl?: string };
    assert.equal(payload.contactName, "Dona da Conta", "saudação é da dona da conta");
    assert.ok(payload.claimUrl?.includes("/acesso?token="), "aviso carrega o link mágico");

    // reenvio pela página do pedido: mesma regra
    const notifications = new NotificationsService();
    const reenvio = await notifications.resendTickets(pedido.publicToken);
    assert.equal((reenvio as { mode?: string }).mode, "account_claim");
    const aposReenvio = await prisma.notification.findMany({
      where: { orderId: order.id, template: "account_claim" },
    });
    assert.equal(aposReenvio.length, 2);
    assert.ok(
      aposReenvio.every((n) => n.recipient === emailDona),
      "reenvio também vai só para o e-mail da conta",
    );

    // nenhuma conta foi criada para o e-mail do terceiro
    assert.equal(await prisma.user.findUnique({ where: { email: emailTerceiro } }), null);
  } finally {
    await cleanupFixtureEvent(f.organization.id);
    await prisma.user.deleteMany({ where: { email: { in: [emailDona, emailTerceiro] } } });
  }
});

test("conta sem e-mail: reenvio recusa em vez de mandar o link para o contato", async () => {
  const f = await createFixtureEvent({ lotCapacity: 5, priceCents: 5000, feeCents: 0 });
  const emailTerceiro = `terceiro-${Math.random().toString(36).slice(2, 8)}@borafest.dev`;
  let semEmailId: string | undefined;
  try {
    const semEmail = await prisma.user.create({ data: { name: "Conta Sem E-mail" } });
    semEmailId = semEmail.id;
    const reservations = new ReservationsService(new InventoryService(), new WaitingRoomService());
    const orders = new OrdersService(new CouponsService(new OrgAccessService()), new OrgAccessService());
    const payments = new PaymentsService(new IdempotencyService());
    const reservation = await reservations.create(semEmail.id, {
      eventId: f.event.id,
      items: [{ ticketLotId: f.lot.id, quantity: 1 }],
    });
    const order = await orders.createFromReservation(semEmail.id, {
      reservationId: reservation.id,
      contactEmail: emailTerceiro,
      contactName: "Pessoa Terceira",
    } as never);
    const payment = await payments.createPix(order.id, {});
    await applyGatewayStatus(payment.id, "PAID");
    await issueTicketsForOrder(order.id);

    const pedido = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    assert.equal(pedido.status, "FULFILLED", "o ingresso nasce mesmo sem destino para o link");
    const naEmissao = await prisma.notification.findMany({ where: { orderId: order.id } });
    assert.equal(naEmissao.length, 0, "nada sai para o contato: nem link, nem QR");

    await assert.rejects(
      () => new NotificationsService().resendTickets(pedido.publicToken),
      /não tem e-mail cadastrado/,
    );
  } finally {
    await cleanupFixtureEvent(f.organization.id);
    if (semEmailId) await prisma.user.deleteMany({ where: { id: semEmailId } });
    await prisma.user.deleteMany({ where: { email: emailTerceiro } });
  }
});
