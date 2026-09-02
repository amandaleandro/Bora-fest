/**
 * Laboratório do e-mail de compra (queixa da Ana, 2026-09-02): prova a máquina
 * de ponta a ponta — pedido pago -> emissão cria a linha certa em `notifications`
 * -> o worker de entrega REALMENTE chama o sender e marca SENT; e que uma recusa
 * do provedor (Resend 4xx/5xx) NÃO some: vira retry e, no teto, FAILED com erro.
 *
 * Usa um sender que captura no lugar do Resend real (registrado sob o MESMO nome
 * "resend", com EMAIL_PROVIDER=resend) — mesma trilha da produção, sem enviar
 * e-mail de verdade.
 */
import assert from "node:assert/strict";
import { prisma } from "@borafest/database";
import { applyGatewayStatus } from "@borafest/payments";
import { closeRedisConnection } from "@borafest/queues";
import { registerEmailSender, type EmailMessage } from "@borafest/notifications";
import { ReservationsService } from "../src/reservations/reservations.service";
import { CouponsService } from "../src/coupons/coupons.service";
import { OrgAccessService } from "../src/common/org-access.service";
import { OrdersService } from "../src/orders/orders.service";
import { PaymentsService } from "../src/payments/payments.service";
import { InventoryService } from "../src/inventory/inventory.service";
import { WaitingRoomService } from "../src/waiting-room/waiting-room.service";
import { IdempotencyService } from "../src/common/idempotency.service";
import { createFixtureEvent, cleanupFixtureEvent } from "../src/__tests__/helpers";
import { issueTicketsForOrder } from "../../worker/src/issue-tickets";
import { deliverPendingNotifications } from "../../worker/src/deliver-notifications";

let pass = 0;
let fail = 0;
function ok(nome: string, cond: boolean, extra?: unknown) {
  if (cond) { pass++; console.log(`  PASS ${nome}`); }
  else { fail++; console.log(`  FAIL ${nome}`, extra ?? ""); }
}

// --- sender que finge ser o Resend: captura ou explode conforme o modo ---
const enviados: EmailMessage[] = [];
let modo: "aceita" | "recusa" = "aceita";
registerEmailSender({
  provider: "resend",
  async send(message: EmailMessage) {
    if (modo === "recusa") {
      // espelha o ResendEmailSender: erro pro worker reagendar/contar tentativa
      throw new Error("Resend respondeu 422: dominio nao verificado (simulado)");
    }
    enviados.push(message);
  },
});
process.env.EMAIL_PROVIDER = "resend";

async function comprar(eventId: string, lotId: string, email: string) {
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
    contactName: "Ana Carolina (lab)",
    contactPhone: undefined,
    contactCpf: `${Math.floor(10000000000 + Math.random() * 8e10)}`,
  } as never);
  const payment = await payments.createPix(order.id, {});
  await applyGatewayStatus(payment.id, "PAID");
  return order;
}

async function main() {
  const f = await createFixtureEvent({ lotCapacity: 10, priceCents: 1100, feeCents: 0 });
  const suf = Math.random().toString(36).slice(2, 8);
  // isolamento: o banco de teste é compartilhado com outras baterias e pode ter
  // linhas PENDING antigas; a fila entrega em lotes de 20 por ordem de criação,
  // então lixo velho roubaria o lote e mascararia o resultado. Zera a fila.
  await prisma.notification.deleteMany({});
  try {
    console.log("\n1) Compra online (conta NÃO verificada, como a Ana): nasce o aviso account_claim");
    const emailAna = `ana-${suf}@ufu.br`;
    const pedidoAna = await comprar(f.event.id, f.lot.id, emailAna);
    await issueTicketsForOrder(pedidoAna.id);
    const nAna = await prisma.notification.findMany({ where: { orderId: pedidoAna.id } });
    ok("exatamente 1 notificação criada", nAna.length === 1, nAna.map((n) => n.template));
    ok("template = account_claim (link mágico, não QR)", nAna[0]?.template === "account_claim");
    ok("canal = EMAIL", nAna[0]?.channel === "EMAIL");
    ok("destinatário = e-mail da compra", nAna[0]?.recipient === emailAna);
    ok("nasce PENDING (na fila, ainda não enviada)", nAna[0]?.status === "PENDING");

    console.log("\n2) O worker de entrega REALMENTE envia e marca SENT");
    enviados.length = 0; modo = "aceita";
    const entregues = await deliverPendingNotifications();
    ok("worker relatou ≥1 entregue", entregues >= 1, entregues);
    const nAna2 = await prisma.notification.findUniqueOrThrow({ where: { id: nAna[0].id } });
    ok("linha virou SENT", nAna2.status === "SENT", nAna2.status);
    ok("sentAt gravado", !!nAna2.sentAt);
    ok("sender foi chamado com o e-mail da Ana", enviados.some((e) => e.to === emailAna));
    ok("assunto não vazio", !!enviados.find((e) => e.to === emailAna)?.subject);

    console.log("\n3) Conta VERIFICADA: aí sim vai o ingresso com QR (ticket_delivery)");
    const emailVer = `verif-${suf}@gmail.com`;
    await prisma.user.create({ data: { email: emailVer, emailVerifiedAt: new Date() } });
    const pedidoVer = await comprar(f.event.id, f.lot.id, emailVer);
    await issueTicketsForOrder(pedidoVer.id);
    const nVer = await prisma.notification.findMany({ where: { orderId: pedidoVer.id, channel: "EMAIL" } });
    ok("template = ticket_delivery", nVer[0]?.template === "ticket_delivery", nVer.map((n) => n.template));
    enviados.length = 0;
    await deliverPendingNotifications();
    const nVer2 = await prisma.notification.findFirstOrThrow({ where: { orderId: pedidoVer.id, channel: "EMAIL" } });
    ok("ticket_delivery marcado SENT", nVer2.status === "SENT");

    console.log("\n4) Recusa do provedor (domínio não verificado) NÃO some — vira retry e depois FAILED");
    const emailRej = `rejeita-${suf}@ufu.br`;
    const pedidoRej = await comprar(f.event.id, f.lot.id, emailRej);
    await issueTicketsForOrder(pedidoRej.id);
    const idRej = (await prisma.notification.findFirstOrThrow({ where: { orderId: pedidoRej.id } })).id;
    modo = "recusa";
    // 1ª tentativa: fica PENDING com erro e availableAt no futuro (backoff)
    await deliverPendingNotifications();
    let r = await prisma.notification.findUniqueOrThrow({ where: { id: idRej } });
    ok("após falhar continua PENDING (retry agendado)", r.status === "PENDING", r.status);
    ok("erro do provedor foi gravado", (r.error ?? "").includes("dominio nao verificado"), r.error);
    ok("tentativa contabilizada", r.attempts === 1, r.attempts);
    // força o teto de tentativas
    for (let i = 0; i < 6; i++) {
      await prisma.notification.update({ where: { id: idRej }, data: { availableAt: new Date(Date.now() - 1000) } });
      await deliverPendingNotifications();
    }
    r = await prisma.notification.findUniqueOrThrow({ where: { id: idRej } });
    ok("no teto de 5 tentativas vira FAILED (visível no backoffice)", r.status === "FAILED", `${r.status}/${r.attempts}`);
    ok("FAILED preserva o motivo", !!r.error);

    console.log("\n5) Idempotência: reprocessar não duplica nem reenvia o que já foi SENT");
    enviados.length = 0; modo = "aceita";
    await deliverPendingNotifications();
    ok("nada reenviado (SENT/FAILED ficam quietos)", enviados.length === 0, enviados.length);
    const totalAna = await prisma.notification.count({ where: { orderId: pedidoAna.id } });
    ok("continua 1 notificação para a Ana (sem duplicar)", totalAna === 1, totalAna);
  } finally {
    if (!process.env.KEEP) await cleanupFixtureEvent(f.event.organizationId);
    else console.log(`\n(KEEP=1 — fixtures preservadas; e-mail da Ana: ana-${suf}@ufu.br)`);
    await closeRedisConnection();
    await prisma.$disconnect();
  }

  console.log(`\n${pass} PASS, ${fail} FAIL`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
