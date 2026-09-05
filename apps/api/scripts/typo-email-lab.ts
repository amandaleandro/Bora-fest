/**
 * Laboratório do TYPO DE E-MAIL NO CHECKOUT (incidente 2026-09-02, Maycon).
 *
 * Ele digitou "@gmail.comm", pagou R$11, e o ingresso foi para uma conta-
 * fantasma inalcançável: o e-mail de acesso quicou, a carteira da conta real
 * dele ficou VAZIA e não havia saída — correctEmail recusa (e-mail certo já tem
 * conta) e a reivindicação por OTP só pega pedido SEM dono. Evento abrindo às 17h.
 *
 * Prova aqui: (1) o typo agora é BARRADO na entrada; (2) quem já caiu no
 * buraco tem saída pelo "este pedido é meu"; (3) o resgate não vira ferramenta
 * de roubo de pedido alheio.
 */
import assert from "node:assert/strict";
import { prisma } from "@borafest/database";
import { applyGatewayStatus } from "@borafest/payments";
import { closeRedisConnection } from "@borafest/queues";
import { createOrderSchema } from "@borafest/contracts";
import { sugerirCorrecaoEmail } from "@borafest/contracts";
import { ReservationsService } from "../src/reservations/reservations.service";
import { CouponsService } from "../src/coupons/coupons.service";
import { OrgAccessService } from "../src/common/org-access.service";
import { OrdersService } from "../src/orders/orders.service";
import { PaymentsService } from "../src/payments/payments.service";
import { InventoryService } from "../src/inventory/inventory.service";
import { WaitingRoomService } from "../src/waiting-room/waiting-room.service";
import { IdempotencyService } from "../src/common/idempotency.service";
import { TicketsService } from "../src/tickets/tickets.service";
import { createFixtureEvent, cleanupFixtureEvent } from "../src/__tests__/helpers";
import { issueTicketsForOrder } from "../../worker/src/issue-tickets";

let pass = 0, fail = 0;
function ok(nome: string, cond: boolean, extra?: unknown) {
  if (cond) { pass++; console.log(`  PASS ${nome}`); }
  else { fail++; console.log(`  FAIL ${nome}`, extra ?? ""); }
}

const orders = new OrdersService(new CouponsService(new OrgAccessService()), new OrgAccessService());

async function comprar(eventId: string, lotId: string, email: string) {
  const reservations = new ReservationsService(new InventoryService(), new WaitingRoomService());
  const payments = new PaymentsService(new IdempotencyService());
  const r = await reservations.create(undefined, { eventId, items: [{ ticketLotId: lotId, quantity: 1 }] });
  const order = await orders.createFromReservation(undefined, {
    reservationId: r.id, contactEmail: email, contactName: "Maycon (lab)",
  } as never);
  const p = await payments.createPix(order.id, {});
  await applyGatewayStatus(p.id, "PAID");
  return order;
}

async function main() {
  const f = await createFixtureEvent({ lotCapacity: 10, priceCents: 1100, feeCents: 0 });
  const suf = Math.random().toString(36).slice(2, 8);
  try {
    console.log("\n1) O TYPO É BARRADO NA ENTRADA (o que teria salvado o Maycon)");
    const casos: Array<[string, string]> = [
      [`maycon-${suf}@gmail.comm`, "gmail.comm (o caso real)"],
      [`maycon-${suf}@gmail.con`, "gmail.con"],
      [`maycon-${suf}@gmial.com`, "gmial.com"],
      [`maycon-${suf}@hotmail.co`, "hotmail.co"],
    ];
    for (const [ruim, rotulo] of casos) {
      const r = createOrderSchema.safeParse({
        reservationId: "00000000-0000-4000-8000-000000000000", contactEmail: ruim,
      });
      const barrou = !r.success && JSON.stringify(r.error.issues).includes("erro de digitação");
      ok(`recusa ${rotulo}`, barrou);
    }
    const sug = sugerirCorrecaoEmail(`maycon-${suf}@gmail.comm`);
    ok("sugere a correção certa", sug?.sugestao === `maycon-${suf}@gmail.com`, sug?.sugestao);

    console.log("\n1b) E-mail BOM continua passando (sem falso positivo)");
    for (const bom of [`ana-${suf}@gmail.com`, `x-${suf}@ufu.br`, `y-${suf}@empresa.com.br`, `z-${suf}@outlook.com`]) {
      const r = createOrderSchema.safeParse({ reservationId: "00000000-0000-4000-8000-000000000000", contactEmail: bom });
      const passou = r.success || !JSON.stringify(r.error.issues).includes("erro de digitação");
      ok(`aceita ${bom.split("@")[1]}`, passou);
    }
    const norm = createOrderSchema.safeParse({
      reservationId: "00000000-0000-4000-8000-000000000000", contactEmail: `  MAYCON-${suf}@Gmail.Com  `,
    });
    ok("normaliza (trim + minúsculas)", norm.success && norm.data.contactEmail === `maycon-${suf}@gmail.com`,
      norm.success ? norm.data.contactEmail : norm.error.issues[0]?.message);

    console.log("\n2) QUEM JÁ CAIU NO BURACO TEM SAÍDA ('este pedido é meu')");
    // reproduz o estado do Maycon: pedido presoem conta-fantasma do e-mail errado
    const errado = `maycon-${suf}@gmail.comm`;
    const certo = `maycon-${suf}@gmail.com`;
    const pedido = await comprar(f.event.id, f.lot.id, errado); // via service, sem o schema
    await issueTicketsForOrder(pedido.id);
    const fantasma = await prisma.user.findUniqueOrThrow({ where: { email: errado } });
    ok("pedido nasceu preso na conta-fantasma", (await prisma.order.findUniqueOrThrow({ where: { id: pedido.id } })).userId === fantasma.id);

    // a conta REAL dele existe (entrou por OTP) e está vazia
    const real = await prisma.user.create({ data: { email: certo, emailVerifiedAt: new Date() } });
    const tickets = new TicketsService();
    ok("carteira da conta real está VAZIA (o print do Maycon)", (await tickets.findByUser(real.id)).length === 0);

    // o correctEmail não salva: o e-mail certo já tem conta
    let recusou = false;
    try { await orders.correctEmail(pedido.publicToken, certo); } catch { recusou = true; }
    ok("correctEmail continua recusando (e-mail certo já tem conta)", recusou);

    // ... mas o claim resolve
    const resultado = await orders.claimOrder(pedido.publicToken, real.id);
    ok("claim aceito", resultado.ok === true);
    const depois = await prisma.order.findUniqueOrThrow({ where: { id: pedido.id } });
    ok("pedido migrou para a conta real", depois.userId === real.id);
    ok("contactEmail corrigido", depois.contactEmail === certo);
    ok("INGRESSO APARECE na carteira da conta real", (await tickets.findByUser(real.id)).length === 1);
    ok("accountCreatedByOrder desligado (não renomeia conta real depois)", depois.accountCreatedByOrder === false);

    console.log("\n3) O RESGATE NÃO VIRA ROUBO DE PEDIDO ALHEIO");
    const ladrao = await prisma.user.create({ data: { email: `ladrao-${suf}@x.com`, emailVerifiedAt: new Date() } });
    let barrado = false;
    try { await orders.claimOrder(pedido.publicToken, ladrao.id); } catch { barrado = true; }
    ok("pedido de conta CONFIRMADA não pode ser reivindicado", barrado);

    // pedido de conta verificada desde o início também é intocável
    const verificada = await prisma.user.create({ data: { email: `dono-${suf}@gmail.com`, emailVerifiedAt: new Date() } });
    const pedido2 = await comprar(f.event.id, f.lot.id, `dono-${suf}@gmail.com`);
    let barrado2 = false;
    try { await orders.claimOrder(pedido2.publicToken, ladrao.id); } catch { barrado2 = true; }
    ok("pedido de conta verificada é intocável", barrado2, verificada.id);
  } finally {
    await cleanupFixtureEvent(f.event.organizationId);
    await closeRedisConnection();
    await prisma.$disconnect();
  }
  console.log(`\n${pass} PASS, ${fail} FAIL`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
