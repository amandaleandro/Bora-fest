/**
 * Laboratório do FUNIL DE RECUPERAÇÃO DE CARRINHO (2026-08-30).
 * Código real (sendAbandonedCartReminders + sendExpiredRescueEmails) contra
 * Postgres real, com sender de e-mail de CAPTURA pra provar destinatários.
 */
import { randomUUID } from "node:crypto";
import { prisma } from "@borafest/database";
import { registerEmailSender } from "@borafest/notifications";
import { sendAbandonedCartReminders, sendExpiredRescueEmails } from "../src/abandoned-cart";

const enviados: Array<{ to: string; subject: string }> = [];
registerEmailSender({
  provider: "labmail",
  async send(m: { to: string; subject: string }) { enviados.push({ to: m.to, subject: m.subject }); },
} as never);
process.env.EMAIL_PROVIDER = "labmail";
process.env.WEB_BASE_URL = "https://borafest.com.br";

let pass = 0, fail = 0;
function ok(nome: string, cond: boolean, det = "") {
  if (cond) { pass++; console.log(`  PASS ${nome}`); }
  else { fail++; console.log(`  FAIL ${nome} ${det}`); }
}
const MIN = 60_000;

async function fixture(opts: { status: string; idadeMin: number; expiraEmMin: number; email: string; startsInDays?: number; eventStatus?: string }) {
  const suf = randomUUID().slice(0, 8);
  const org = await prisma.organization.create({ data: { name: `o${suf}`, slug: `o-${suf}`, kind: "COMPANY", status: "ACTIVE", document: `d${Date.now()}`.slice(0, 14) } });
  const ev = await prisma.event.create({ data: { organizationId: org.id, title: `Festa ${suf}`, slug: `festa-${suf}`, status: (opts.eventStatus ?? "PUBLISHED") as never, startsAt: new Date(Date.now() + (opts.startsInDays ?? 7) * 864e5), endsAt: new Date(Date.now() + (opts.startsInDays ?? 7) * 864e5 + 4 * 3600e3) } });
  const resv = await prisma.reservation.create({ data: { event: { connect: { id: ev.id } }, expiresAt: new Date(Date.now() + 9e5) } });
  const order = await prisma.order.create({ data: {
    event: { connect: { id: ev.id } }, reservation: { connect: { id: resv.id } },
    publicToken: randomUUID(), contactEmail: opts.email, contactName: "Teste", status: opts.status as never,
    totalCents: 5000, createdAt: new Date(Date.now() - opts.idadeMin * MIN), expiresAt: new Date(Date.now() + opts.expiraEmMin * MIN),
  } });
  return { org, ev, order };
}

async function limpa(f: { org: { id: string }; ev: { id: string } }) {
  await prisma.order.deleteMany({ where: { eventId: f.ev.id } });
  await prisma.reservation.deleteMany({ where: { eventId: f.ev.id } });
  await prisma.event.deleteMany({ where: { id: f.ev.id } });
  await prisma.organization.delete({ where: { id: f.org.id } });
}

async function main() {
  const fixtures: Array<{ org: { id: string }; ev: { id: string } }> = [];
  const F = async (o: Parameters<typeof fixture>[0]) => { const f = await fixture(o); fixtures.push(f); return f; };

  console.log("\n1) TOQUE 1 — pedido pendente há 16min (janela 30): lembra UMA vez");
  const f1 = await F({ status: "PAYMENT_PENDING", idadeMin: 16, expiraEmMin: 14, email: "t1@lab.test" });
  await sendAbandonedCartReminders();
  ok("e-mail 'Pix expira em breve' enviado pro t1", enviados.some(e => e.to === "t1@lab.test" && e.subject.includes("expira em breve")));
  const antes = enviados.length;
  await sendAbandonedCartReminders();
  ok("segunda varredura NÃO repete o e-mail", enviados.length === antes);

  console.log("\n2) TOQUE 1 — pedido novo (5min): ainda NÃO lembra");
  await F({ status: "PAYMENT_PENDING", idadeMin: 5, expiraEmMin: 25, email: "t2@lab.test" });
  await sendAbandonedCartReminders();
  ok("t2 não recebeu nada", !enviados.some(e => e.to === "t2@lab.test"));

  console.log("\n3) TOQUE 2 — pedido EXPIRADO há 2h: resgate pro hotsite, UMA vez");
  const f3 = await F({ status: "EXPIRED", idadeMin: 150, expiraEmMin: -120, email: "t3@lab.test" });
  await sendExpiredRescueEmails();
  ok("e-mail 'Ainda dá tempo' enviado pro t3", enviados.some(e => e.to === "t3@lab.test" && e.subject.startsWith("Ainda dá tempo")));
  const antes3 = enviados.length;
  await sendExpiredRescueEmails();
  ok("segunda varredura NÃO repete", enviados.length === antes3);
  const marcado = await prisma.order.findFirstOrThrow({ where: { eventId: f3.ev.id } });
  ok("rescueReminderSentAt marcado", marcado.rescueReminderSentAt !== null);

  console.log("\n4) TOQUE 2 — expirou há só 30min: cedo demais, espera 1h");
  await F({ status: "EXPIRED", idadeMin: 60, expiraEmMin: -30, email: "t4@lab.test" });
  await sendExpiredRescueEmails();
  ok("t4 não recebeu (ainda)", !enviados.some(e => e.to === "t4@lab.test"));

  console.log("\n5) TOQUE 2 — backlog: expirado há 3 DIAS não recebe (teto de 6h)");
  await F({ status: "EXPIRED", idadeMin: 4400, expiraEmMin: -4320, email: "t5@lab.test" });
  await sendExpiredRescueEmails();
  ok("t5 (backlog antigo) não recebeu", !enviados.some(e => e.to === "t5@lab.test"));

  console.log("\n6) TOQUE 2 — quem JÁ COMPROU o evento por outro pedido não recebe resgate");
  const f6 = await F({ status: "EXPIRED", idadeMin: 150, expiraEmMin: -120, email: "t6@lab.test" });
  const resv6 = await prisma.reservation.create({ data: { event: { connect: { id: f6.ev.id } }, expiresAt: new Date(Date.now() + 9e5) } });
  await prisma.order.create({ data: { event: { connect: { id: f6.ev.id } }, reservation: { connect: { id: resv6.id } }, publicToken: randomUUID(), contactEmail: "t6@lab.test", status: "PAID", totalCents: 5000 } });
  await sendExpiredRescueEmails();
  ok("t6 não recebeu (já comprou)", !enviados.some(e => e.to === "t6@lab.test"));
  const m6 = await prisma.order.findFirstOrThrow({ where: { eventId: f6.ev.id, status: "EXPIRED" } });
  ok("t6 marcado mesmo assim (não reavalia toda varredura)", m6.rescueReminderSentAt !== null);

  console.log("\n7) TOQUE 2 — evento que JÁ COMEÇOU não recebe resgate");
  await F({ status: "EXPIRED", idadeMin: 150, expiraEmMin: -120, email: "t7@lab.test", startsInDays: -1 });
  await sendExpiredRescueEmails();
  ok("t7 não recebeu (evento já passou)", !enviados.some(e => e.to === "t7@lab.test"));

  console.log("\n8) TOQUE 2 — evento FORA DO AR (DRAFT) não recebe resgate");
  await F({ status: "EXPIRED", idadeMin: 150, expiraEmMin: -120, email: "t8@lab.test", eventStatus: "DRAFT" });
  await sendExpiredRescueEmails();
  ok("t8 não recebeu (evento fora do ar)", !enviados.some(e => e.to === "t8@lab.test"));

  for (const f of fixtures) await limpa(f);
  console.log(`\n${pass} PASS, ${fail} FAIL\n`);
  await prisma.$disconnect();
  process.exit(fail > 0 ? 1 : 0);
}
main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
