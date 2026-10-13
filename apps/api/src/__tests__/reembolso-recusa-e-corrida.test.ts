// Pedido de reembolso do comprador (2026-10-13):
//  - duas abas pedindo ao mesmo tempo geram UM pedido pendente (linha do pedido travada);
//  - a recusa é atômica e avisa o comprador por e-mail, com o motivo;
//  - "Minhas compras" (/v1/me/orders) diz "recusado" e o motivo;
//  - checkout não aceita e-mail sem caixa (conta apagada, porta, lista).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@borafest/database";
import { closeRedisConnection } from "@borafest/queues";
import { applyGatewayStatus } from "@borafest/payments";
import { ReservationsService } from "../reservations/reservations.service";
import { CouponsService } from "../coupons/coupons.service";
import { OrgAccessService } from "../common/org-access.service";
import { OrdersService } from "../orders/orders.service";
import { PaymentsService } from "../payments/payments.service";
import { InventoryService } from "../inventory/inventory.service";
import { WaitingRoomService } from "../waiting-room/waiting-room.service";
import { IdempotencyService } from "../common/idempotency.service";
import { RefundRequestsService } from "../refund-requests/refund-requests.service";
import { recusarPedidoDeReembolso, TEMPLATE_REEMBOLSO_RECUSADO } from "../common/recusar-reembolso";
import { MeService } from "../me/me.service";
import { createFixtureEvent, cleanupFixtureEvent } from "./helpers";

after(async () => {
  await closeRedisConnection();
});

async function pedidoPago(eventId: string, lotId: string, email: string) {
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
    contactName: "Comprador Teste",
  });
  const payment = await payments.createPix(order.id, {});
  await applyGatewayStatus(payment.id, "PAID");
  return order;
}

test("reembolso: duas abas ao mesmo tempo criam um pedido pendente só", async () => {
  const { organization, event, lot } = await createFixtureEvent({ lotCapacity: 5 });
  const email = `reembolso-corrida-${Date.now()}@example.com`;
  try {
    const order = await pedidoPago(event.id, lot.id, email);
    const service = new RefundRequestsService(new OrgAccessService());

    const resultados = await Promise.allSettled([
      service.create(order.publicToken, { reason: "Não vou poder ir mais" }),
      service.create(order.publicToken, { reason: "Não vou poder ir mais" }),
      service.create(order.publicToken, { reason: "Não vou poder ir mais" }),
    ]);
    assert.equal(resultados.filter((r) => r.status === "fulfilled").length, 1, "uma aba cria");
    for (const r of resultados.filter((r) => r.status === "rejected")) {
      assert.match(String((r as PromiseRejectedResult).reason?.message), /pendente/i);
    }
    assert.equal(
      await prisma.refundRequest.count({ where: { orderId: order.id, status: "PENDING" } }),
      1,
    );
  } finally {
    await prisma.notification.deleteMany({ where: { recipient: email } });
    await cleanupFixtureEvent(organization.id);
    await prisma.user.deleteMany({ where: { email } });
  }
});

test("reembolso recusado: atômico, avisa o comprador com o motivo e aparece em Minhas compras", async () => {
  const { organization, event, lot } = await createFixtureEvent({ lotCapacity: 5 });
  const email = `reembolso-recusa-${Date.now()}@example.com`;
  try {
    const order = await pedidoPago(event.id, lot.id, email);
    const service = new RefundRequestsService(new OrgAccessService());
    const pedido = await service.create(order.publicToken, { reason: "Não vou poder ir mais" });

    // casa e BoraFest (ou dois cliques) ao mesmo tempo: uma recusa só
    const autor = await donoQualquer();
    const motivo = "Política: sem reembolso a 48 h do evento";
    const [a, b] = await Promise.allSettled([
      recusarPedidoDeReembolso(pedido.id, autor, motivo, "casa"),
      recusarPedidoDeReembolso(pedido.id, autor, motivo, "BoraFest"),
    ]);
    const ok = [a, b].filter((r) => r.status === "fulfilled");
    const falhou = [a, b].filter((r) => r.status === "rejected") as PromiseRejectedResult[];
    assert.equal(ok.length, 1);
    assert.equal(falhou.length, 1);
    assert.match(String(falhou[0]!.reason?.message), /já foi resolvido/i);

    const salvo = await prisma.refundRequest.findUniqueOrThrow({ where: { id: pedido.id } });
    assert.equal(salvo.status, "REJECTED");
    assert.equal(salvo.resolutionNote, "Política: sem reembolso a 48 h do evento");

    const avisos = await prisma.notification.findMany({
      where: { orderId: order.id, template: TEMPLATE_REEMBOLSO_RECUSADO },
    });
    assert.equal(avisos.length, 1, "um e-mail só");
    assert.equal(avisos[0]!.recipient, email);
    assert.equal(avisos[0]!.channel, "EMAIL");
    const payload = avisos[0]!.payload as Record<string, unknown>;
    assert.equal(payload.motivo, "Política: sem reembolso a 48 h do evento");
    assert.equal(payload.eventTitle, event.title);
    assert.ok(typeof payload.casa === "string" && payload.casa.length > 0);

    // Minhas compras: recusado, com o motivo; pode pedir de novo
    const dono = await prisma.order.findUniqueOrThrow({ where: { id: order.id }, select: { userId: true } });
    assert.ok(dono.userId, "a conta nasceu do pedido");
    const lista = await new MeService().orders(dono.userId!);
    const linha = lista.find((o) => o.id === order.id)!;
    assert.equal(linha.refundRequested, false);
    assert.equal(linha.refundRequestStatus, "REJECTED");
    assert.equal(linha.refundRequestNote, "Política: sem reembolso a 48 h do evento");

    // recusa de pedido que não existe: 404, não erro do banco
    await assert.rejects(
      () => recusarPedidoDeReembolso("00000000-0000-0000-0000-000000000000", dono.userId!, "x", "casa"),
      /não encontrado/i,
    );
  } finally {
    await prisma.notification.deleteMany({ where: { recipient: email } });
    await cleanupFixtureEvent(organization.id);
    await prisma.user.deleteMany({ where: { email } });
  }
});

test("checkout: e-mail sem caixa (conta apagada, porta, lista) é recusado", async () => {
  const { organization, event, lot } = await createFixtureEvent({ lotCapacity: 5 });
  try {
    const reservations = new ReservationsService(new InventoryService(), new WaitingRoomService());
    const orders = new OrdersService(new CouponsService(new OrgAccessService()), new OrgAccessService());
    for (const contactEmail of [
      "apagado-123@anon.borafest.invalid",
      "pdv-123@borafest.local",
      "guest-list+abc@borafest.app",
    ]) {
      const reservation = await reservations.create(undefined, {
        eventId: event.id,
        items: [{ ticketLotId: lot.id, quantity: 1 }],
      });
      await assert.rejects(
        () => orders.createFromReservation(undefined, { reservationId: reservation.id, contactEmail }),
        /e-mail válido/i,
        contactEmail,
      );
    }
    assert.equal(await prisma.order.count({ where: { eventId: event.id } }), 0);
  } finally {
    await cleanupFixtureEvent(organization.id);
  }
});

/** qualquer usuário existente serve de autor da recusa (a função não confere permissão) */
async function donoQualquer(): Promise<string> {
  const u = await prisma.user.findFirstOrThrow({ select: { id: true } });
  return u.id;
}
