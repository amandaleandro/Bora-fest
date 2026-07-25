import { test, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@borafest/database";
import { closeRedisConnection } from "@borafest/queues";
import { generateTicketCode } from "@borafest/tickets";
import {
  registerWhatsAppSender,
  type WhatsAppImageMessage,
  type WhatsAppMessage,
  type WhatsAppTextMessage,
} from "@borafest/notifications";
import { ReservationsService } from "../reservations/reservations.service";
import { CouponsService } from "../coupons/coupons.service";
import { OrgAccessService } from "../common/org-access.service";
import { OrdersService } from "../orders/orders.service";
import { InventoryService } from "../inventory/inventory.service";
import { NotificationsService } from "../notifications/notifications.service";
import { createFixtureEvent, cleanupFixtureEvent } from "./helpers";

after(async () => {
  await closeRedisConnection();
});

// sender de captura registrado no registry (mesmo caminho do devlog em dev):
// prova que o endpoint resolve o provider via getWhatsAppSender() e envia
const sentMessages: WhatsAppMessage[] = [];
registerWhatsAppSender({
  provider: "capture",
  async send(message) {
    sentMessages.push(message);
  },
});
process.env.WHATSAPP_PROVIDER = "capture";

test("receber ingressos no WhatsApp: 409 sem pagamento, telefone inválido rejeitado, envio por ingresso", async () => {
  const fixture = await createFixtureEvent({ lotCapacity: 5 });

  try {
    const reservations = new ReservationsService(new InventoryService());
    const orders = new OrdersService(new CouponsService(new OrgAccessService()), new OrgAccessService());
    const notifications = new NotificationsService();

    const reservation = await reservations.create(undefined, {
      eventId: fixture.event.id,
      items: [{ ticketLotId: fixture.lot.id, quantity: 1 }],
    });
    const order = await orders.createFromReservation(undefined, {
      reservationId: reservation.id,
      contactEmail: "whats@test.dev",
    });

    // pedido inexistente → 404
    await assert.rejects(
      notifications.sendTicketsToWhatsApp("token-que-nao-existe"),
      (error: any) => error.status === 404,
    );

    // pedido ainda não pago (sem ingressos) → 409
    await assert.rejects(
      notifications.sendTicketsToWhatsApp(order.publicToken, { phone: "11912345678" }),
      (error: any) => error.status === 409,
    );

    // simula pagamento aprovado + emissão do ingresso
    await prisma.order.update({
      where: { id: order.id },
      data: { status: "FULFILLED", paidAt: new Date() },
    });
    const ticket = await prisma.ticket.create({
      data: {
        orderId: order.id,
        orderItemId: order.items[0].id,
        eventId: fixture.event.id,
        ticketLotId: fixture.lot.id,
        seq: 1,
        code: generateTicketCode(),
        qrToken: "qr-token-de-teste",
        status: "ISSUED",
      },
    });

    // telefone inválido (sem o 9, DDD errado etc.) → 400
    await assert.rejects(
      notifications.sendTicketsToWhatsApp(order.publicToken, { phone: "1112345678" }),
      /inválido/i,
    );
    // pedido sem contactPhone e sem phone no corpo → 400
    await assert.rejects(
      notifications.sendTicketsToWhatsApp(order.publicToken),
      /Informe/i,
    );
    assert.equal(sentMessages.length, 0, "nada deveria ter sido enviado até aqui");

    // telefone válido com +55 e máscara → normaliza, envia texto + QR e grava no pedido
    const result = await notifications.sendTicketsToWhatsApp(order.publicToken, {
      phone: "+55 (11) 91234-5678",
    });
    assert.equal(result.sent, true);
    assert.equal(result.tickets, 1);
    assert.equal(result.phone, "5511912345678");

    assert.equal(sentMessages.length, 2, "1 texto + 1 imagem por ingresso");
    const text = sentMessages[0] as WhatsAppTextMessage;
    assert.equal(text.to, "5511912345678");
    assert.ok(text.text.includes(fixture.event.title));
    assert.ok(text.text.includes(ticket.code));
    assert.ok(text.text.includes(`/pedido/${order.publicToken}`));

    const image = sentMessages[1] as WhatsAppImageMessage;
    assert.ok(
      image.imageUrl.endsWith(`/v1/orders/${order.publicToken}/tickets/${ticket.id}/qr.png`),
      "imagem deve apontar para o qr.png público do ingresso",
    );

    const updated = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    assert.equal(updated.contactPhone, "5511912345678", "phone novo atualiza o contato do pedido");
  } finally {
    await cleanupFixtureEvent(fixture.organization.id);
  }
});
