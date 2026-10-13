import { after, test } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@borafest/database";
import { closeRedisConnection } from "@borafest/queues";
import { generateTicketCode } from "@borafest/tickets";
import {
  registerWhatsAppSender,
  type TicketDeliveryPayload,
  type WhatsAppImageMessage,
  type WhatsAppMessage,
  type WhatsAppTextMessage,
} from "@borafest/notifications";
import {
  NotificationsService,
  TODOS_OS_INGRESSOS_TRANSFERIDOS,
  ingressosDoComprador,
} from "../notifications/notifications.service";
import { cleanupFixtureEvent, createFixtureEvent } from "./helpers";

// FRENTE SERVIDOR (2026-10-12): "Receber no WhatsApp" e "Reenviar ingressos"
// mandavam TODOS os ingressos do pedido — inclusive os que o comprador já
// tinha transferido para outra pessoa (código e QR de um ingresso que não é
// mais dele). Agora vale a mesma regra da página do pedido: só os que ainda
// são de quem comprou.

after(async () => {
  await closeRedisConnection();
});

const enviadas: WhatsAppMessage[] = [];
registerWhatsAppSender({
  provider: "capture-reenvio-transferidos",
  async send(message) {
    enviadas.push(message);
  },
});
process.env.WHATSAPP_PROVIDER = "capture-reenvio-transferidos";

const rand = () => Math.random().toString(36).slice(2, 10);
const TELEFONE = "5511912345678";

async function montar() {
  const fx = await createFixtureEvent({ lotCapacity: 10 });
  const comprador = await prisma.user.create({
    data: { email: `comprador-${rand()}@borafest.dev`, emailVerifiedAt: new Date() },
  });
  const amigo = await prisma.user.create({
    data: { email: `amigo-${rand()}@borafest.dev`, emailVerifiedAt: new Date() },
  });
  const reserva = await prisma.reservation.create({
    data: { eventId: fx.event.id, userId: comprador.id, status: "CONVERTED", expiresAt: new Date(Date.now() + 60_000) },
  });
  const pedido = await prisma.order.create({
    data: {
      eventId: fx.event.id,
      reservationId: reserva.id,
      userId: comprador.id,
      contactEmail: comprador.email!,
      contactPhone: TELEFONE,
      status: "FULFILLED",
      totalCents: 16_500,
      paidAt: new Date(),
    },
  });
  const item = await prisma.orderItem.create({
    data: { orderId: pedido.id, ticketLotId: fx.lot.id, quantity: 3, priceCents: 5000, feeCents: 500 },
  });
  const ingresso = (seq: number, ownerUserId: string | null) =>
    prisma.ticket.create({
      data: {
        orderId: pedido.id,
        orderItemId: item.id,
        eventId: fx.event.id,
        ticketLotId: fx.lot.id,
        seq,
        code: generateTicketCode(),
        qrToken: `qr-${rand()}`,
        status: "ISSUED",
        ownerUserId,
      },
    });
  // 1: nunca transferido · 2: passado ao amigo · 3: está na conta do próprio comprador
  const nunca = await ingresso(1, null);
  const doAmigo = await ingresso(2, amigo.id);
  const voltou = await ingresso(3, comprador.id);
  return { fx, comprador, amigo, pedido, nunca, doAmigo, voltou, service: new NotificationsService() };
}

type Ctx = Awaited<ReturnType<typeof montar>>;

async function desmontar(ctx: Ctx) {
  await prisma.notification.deleteMany({ where: { orderId: ctx.pedido.id } });
  await cleanupFixtureEvent(ctx.fx.organization.id);
  await prisma.user.deleteMany({ where: { id: { in: [ctx.comprador.id, ctx.amigo.id] } } });
}

test("regra pura: fica o nunca transferido e o que está na conta do comprador", () => {
  const ingressos = [
    { id: "a", ownerUserId: null },
    { id: "b", ownerUserId: "amigo" },
    { id: "c", ownerUserId: "comprador" },
  ];
  assert.deepEqual(
    ingressosDoComprador(ingressos, { userId: "comprador" }).map((i) => i.id),
    ["a", "c"],
  );
  // pedido sem conta: só o nunca transferido é de quem tem o link
  assert.deepEqual(
    ingressosDoComprador(ingressos, { userId: null }).map((i) => i.id),
    ["a"],
  );
});

test("WhatsApp: só manda os ingressos que ainda são do comprador", async () => {
  const ctx = await montar();
  try {
    enviadas.length = 0;
    const r = await ctx.service.sendTicketsToWhatsApp(ctx.pedido.publicToken);
    assert.equal(r.sent, true);
    assert.equal(r.tickets, 2, "o transferido não conta");
    assert.equal(enviadas.length, 4, "texto + QR por ingresso, só dos dois");

    const textos = enviadas.filter((m): m is WhatsAppTextMessage => "text" in m).map((m) => m.text).join("\n");
    assert.ok(textos.includes(ctx.nunca.code));
    assert.ok(textos.includes(ctx.voltou.code));
    assert.ok(!textos.includes(ctx.doAmigo.code), "o código do ingresso do amigo não vai para o comprador");
    const imagens = enviadas.filter((m): m is WhatsAppImageMessage => "imageUrl" in m).map((m) => m.imageUrl);
    assert.equal(imagens.length, 2);
    assert.ok(imagens.every((url) => !url.includes(ctx.doAmigo.id)), "nem o QR dele");

    // tudo transferido: recusa clara e nada sai
    await prisma.ticket.updateMany({ where: { orderId: ctx.pedido.id }, data: { ownerUserId: ctx.amigo.id } });
    enviadas.length = 0;
    await assert.rejects(
      () => ctx.service.sendTicketsToWhatsApp(ctx.pedido.publicToken),
      (error: any) => error.status === 409 && error.message === TODOS_OS_INGRESSOS_TRANSFERIDOS,
    );
    assert.equal(enviadas.length, 0);
  } finally {
    await desmontar(ctx);
  }
});

test("reenviar ingressos: o e-mail lista só os do comprador; tudo transferido recusa", async () => {
  const ctx = await montar();
  try {
    const r = await ctx.service.resendTickets(ctx.pedido.publicToken);
    assert.equal(r.queued, true);

    const fila = await prisma.notification.findMany({
      where: { orderId: ctx.pedido.id, template: "ticket_delivery" },
    });
    const email = fila.find((n) => n.channel === "EMAIL");
    assert.ok(email, "o e-mail entrou na fila");
    const codigos = (email.payload as unknown as TicketDeliveryPayload).tickets.map((t) => t.code).sort();
    assert.deepEqual(codigos, [ctx.nunca.code, ctx.voltou.code].sort());
    // o WhatsApp da fila leva o mesmo conteúdo
    for (const linha of fila) {
      const lista = (linha.payload as unknown as TicketDeliveryPayload).tickets.map((t) => t.code);
      assert.ok(!lista.includes(ctx.doAmigo.code), `${linha.channel} sem o ingresso do amigo`);
    }

    await prisma.ticket.updateMany({ where: { orderId: ctx.pedido.id }, data: { ownerUserId: ctx.amigo.id } });
    const antes = await prisma.notification.count({ where: { orderId: ctx.pedido.id } });
    await assert.rejects(
      () => ctx.service.resendTickets(ctx.pedido.publicToken),
      (error: any) => error.status === 400 && error.message === TODOS_OS_INGRESSOS_TRANSFERIDOS,
    );
    assert.equal(await prisma.notification.count({ where: { orderId: ctx.pedido.id } }), antes, "nada novo na fila");
  } finally {
    await desmontar(ctx);
  }
});
