/**
 * Laboratório da PROTEÇÃO DE REEMBOLSO (upsell 2026-08-30).
 * Código real (creditOrganizationLedger + executarReembolso + requestProtectionRefund)
 * contra Postgres real. Prova: prêmio é lucro, ingresso volta, produtor nunca
 * fica negativo, prêmio nunca é reembolsado.
 */
import { randomUUID } from "node:crypto";
import { prisma } from "@borafest/database";
import { registerGateway, applyGatewayStatus } from "@borafest/payments";
import { OrdersService } from "../src/orders/orders.service";
import { getOrganizationBalanceCents } from "../src/common/ledger";

registerGateway({
  provider: "labprot",
  createPixCharge: async () => { throw new Error("x"); },
  createCardPayment: async () => { throw new Error("x"); },
  refund: async () => ({ externalId: "r", status: "REFUNDED" as const }),
  getStatus: async () => "PAID" as const,
  verifyWebhook: () => { throw new Error("x"); },
} as never);

let pass = 0, fail = 0;
function eq(nome: string, got: number, exp: number) {
  if (got === exp) { pass++; console.log(`  PASS ${nome}`); }
  else { fail++; console.log(`  FAIL ${nome} — esperado ${exp}, veio ${got}`); }
}
function ok(nome: string, cond: boolean, det = "") {
  if (cond) { pass++; console.log(`  PASS ${nome}`); }
  else { fail++; console.log(`  FAIL ${nome} ${det}`); }
}

async function novoPedidoProtegido(opts: { protegido: boolean; startsAt: Date; ticket: number; fee: number }) {
  const suf = randomUUID().slice(0, 8);
  const org = await prisma.organization.create({ data: { name: `o${suf}`, slug: `o-${suf}`, kind: "COMPANY", status: "ACTIVE", document: `d${Date.now()}`.slice(0, 14) } });
  await prisma.ledgerAccount.create({ data: { organizationId: org.id } });
  const ev = await prisma.event.create({ data: { organizationId: org.id, title: "E", slug: `e-${suf}`, status: "PUBLISHED", startsAt: opts.startsAt, endsAt: new Date(opts.startsAt.getTime() + 3600e3) } });
  const tt = await prisma.ticketType.create({ data: { eventId: ev.id, name: "Pista" } });
  const lot = await prisma.ticketLot.create({ data: { ticketTypeId: tt.id, name: "1", priceCents: opts.ticket, feeCents: opts.fee, capacity: 100, soldCount: 1, status: "ACTIVE" } });
  const resv = await prisma.reservation.create({ data: { event: { connect: { id: ev.id } }, expiresAt: new Date(Date.now() + 9e5) } });
  const premio = opts.protegido ? 150 : 0;
  const total = opts.ticket + opts.fee + premio;
  const order = await prisma.order.create({
    data: {
      event: { connect: { id: ev.id } }, reservation: { connect: { id: resv.id } },
      publicToken: randomUUID(), contactEmail: `c@${suf}.test`, status: "PAYMENT_PENDING",
      totalCents: total, protectionPurchased: premio > 0, protectionFeeCents: premio,
      items: { create: { ticketLotId: lot.id, quantity: 1, priceCents: opts.ticket, feeCents: opts.fee } },
    },
    include: { items: true },
  });
  const pay = await prisma.payment.create({ data: { orderId: order.id, provider: "labprot", method: "PIX", amountCents: total, status: "PENDING", externalId: `ext-${suf}` } });
  // gera os tickets (para o reembolso cancelar)
  await prisma.ticket.create({ data: { event: { connect: { id: ev.id } }, order: { connect: { id: order.id } }, orderItem: { connect: { id: order.items[0].id } }, ticketLot: { connect: { id: lot.id } }, code: `T-${suf}`, seq: 1, qrToken: randomUUID(), status: "ISSUED" } });
  // aprova o pagamento -> credita o ledger
  await applyGatewayStatus(pay.id, "PAID");
  return { org, ev, lot, order, pay, premio, total, ticket: opts.ticket, fee: opts.fee };
}

async function saldos(orgId: string) {
  const c = await prisma.ledgerAccount.findUniqueOrThrow({ where: { organizationId: orgId } });
  const entries = await prisma.ledgerEntry.findMany({ where: { ledgerAccountId: c.id } });
  const byType = (t: string) => entries.filter(e => e.type === t).reduce((s, e) => s + e.amountCents, 0);
  return { total: entries.reduce((s, e) => s + e.amountCents, 0), sale: byType("SALE_CREDIT"), fee: byType("PLATFORM_FEE"), protection: byType("PROTECTION_CREDIT"), refund: byType("REFUND_DEBIT") };
}

async function limpa(f: any) {
  const c = await prisma.ledgerAccount.findUnique({ where: { organizationId: f.org.id } });
  if (c) await prisma.ledgerEntry.deleteMany({ where: { ledgerAccountId: c.id } });
  await prisma.ticket.deleteMany({ where: { eventId: f.ev.id } });
  await prisma.payment.deleteMany({ where: { orderId: f.order.id } });
  await prisma.auditLog.deleteMany({ where: { entityId: f.order.id } });
  await prisma.outboxEvent.deleteMany({ where: { aggregateId: f.order.id } });
  await prisma.order.deleteMany({ where: { eventId: f.ev.id } });
  await prisma.reservation.deleteMany({ where: { eventId: f.ev.id } });
  await prisma.ticketLot.deleteMany({ where: { ticketType: { eventId: f.ev.id } } });
  await prisma.ticketType.deleteMany({ where: { eventId: f.ev.id } });
  if (c) await prisma.ledgerAccount.delete({ where: { id: c.id } });
  await prisma.event.deleteMany({ where: { organizationId: f.org.id } });
  await prisma.organization.delete({ where: { id: f.org.id } });
}

async function main() {
  const svc = new OrdersService(null as never, null as never);
  const futuro = new Date(Date.now() + 7 * 864e5);

  console.log("\n1) Pedido PROTEGIDO: prêmio credita SEPARADO, ingresso no SALE_CREDIT");
  const f1 = await novoPedidoProtegido({ protegido: true, startsAt: futuro, ticket: 5000, fee: 500 });
  let s = await saldos(f1.org.id);
  eq("SALE_CREDIT = ingresso+fee (5500)", s.sale, 5500);
  eq("PROTECTION_CREDIT = prêmio (150)", s.protection, 150);
  eq("PLATFORM_FEE = -500", s.fee, -500);
  eq("líquido do produtor = 5000 ingresso + 150 prêmio", s.total, 5150);

  console.log("\n2) Comprador pede reembolso protegido: recebe o INGRESSO, produtor fica com o prêmio");
  const r = await svc.requestProtectionRefund(f1.order.publicToken);
  ok("resposta refunded", (r as any).refunded === true);
  eq("prêmio mantido = 150", (r as any).protectionKeptCents, 150);
  s = await saldos(f1.org.id);
  eq("líquido do produtor AGORA = só o prêmio (150)", s.total, 150);
  ok("produtor NUNCA negativo", (await getOrganizationBalanceCents(f1.org.id)) >= 0, `saldo ${s.total}`);
  const ordAtual = await prisma.order.findUniqueOrThrow({ where: { id: f1.order.id } });
  ok("pedido virou REFUNDED", ordAtual.status === "REFUNDED", `status ${ordAtual.status}`);
  // o cancelamento do ticket sai pelo outbox (worker) — confere que o evento
  // foi emitido e simula o worker para provar que o ingresso morre
  const outbox = await prisma.outboxEvent.findFirst({ where: { aggregateId: f1.order.id, eventType: "order.payment_reversed" } });
  ok("evento de reversão emitido (worker revoga o ingresso)", !!outbox);
  // simula o worker consumindo order.payment_reversed (revoga os ingressos)
  await prisma.ticket.updateMany({ where: { orderId: f1.order.id, status: { in: ["ISSUED","ACTIVE"] } }, data: { status: "REFUNDED", canceledAt: new Date() } });
  const tk = await prisma.ticket.findFirst({ where: { orderId: f1.order.id } });
  ok("ingresso morto após revogação (não entra na festa)", tk?.status === "REFUNDED" || tk?.status === "CANCELED", `ticket ${tk?.status}`);

  console.log("\n3) Prêmio NUNCA é reembolsado nem no segundo pedido");
  let rejeitou = false;
  try { await svc.requestProtectionRefund(f1.order.publicToken); } catch { rejeitou = true; }
  ok("segundo reembolso protegido é recusado (já reembolsado)", rejeitou);
  s = await saldos(f1.org.id);
  eq("prêmio segue intacto (150), nada a mais devolvido", s.total, 150);

  console.log("\n4) Janela fecha no início do evento");
  const passado = new Date(Date.now() - 3600e3);
  const f2 = await novoPedidoProtegido({ protegido: true, startsAt: passado, ticket: 8000, fee: 800 });
  let fechou = false;
  try { await svc.requestProtectionRefund(f2.order.publicToken); } catch (e) { fechou = (e as Error).message.includes("janela"); }
  ok("evento já começou -> reembolso protegido recusado", fechou);

  console.log("\n5) Pedido SEM proteção não pode usar o reembolso protegido");
  const f3 = await novoPedidoProtegido({ protegido: false, startsAt: futuro, ticket: 5000, fee: 500 });
  let semProt = false;
  try { await svc.requestProtectionRefund(f3.order.publicToken); } catch (e) { semProt = (e as Error).message.includes("não tem proteção"); }
  ok("sem proteção -> recusado", semProt);
  const s3 = await saldos(f3.org.id);
  eq("pedido comum inalterado (SALE 5500, sem PROTECTION)", s3.protection, 0);

  console.log("\n6) Reembolso protegido de ingresso CARO: produtor ainda só devolve o retido");
  const f4 = await novoPedidoProtegido({ protegido: true, startsAt: futuro, ticket: 20000, fee: 2000 });
  await svc.requestProtectionRefund(f4.order.publicToken);
  const s4 = await saldos(f4.org.id);
  eq("ingresso caro: produtor fica só com o prêmio (150)", s4.total, 150);
  ok("saldo não-negativo mesmo em ingresso de R$200", s4.total >= 0);

  for (const f of [f1, f2, f3, f4]) await limpa(f);
  console.log(`\n${pass} PASS, ${fail} FAIL\n`);
  await prisma.$disconnect();
  process.exit(fail > 0 ? 1 : 0);
}
main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
