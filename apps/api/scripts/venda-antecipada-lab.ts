/**
 * VENDA ANTECIPADA NA PORTA = COMPRA NORMAL (pedido do Arthur, 2026-09-07):
 * "se o cara não entrar agora deveria ser o mesmo processo de compra — se tiver
 * conta manda pra conta e e-mail normal; se não tiver, cria a conta e manda o
 * código normal".
 *
 * Este lab põe os DOIS caminhos lado a lado, com o mesmo cenário, e compara o
 * que o comprador recebe. Se divergirem, é bug; se baterem, está provado.
 *
 * Roda: npx tsx scripts/venda-antecipada-lab.ts
 */
import { prisma } from "@borafest/database";
import { applyGatewayStatus } from "@borafest/payments";
import { closeRedisConnection } from "@borafest/queues";
import { CatalogService } from "../src/catalog/catalog.service";
import { OrgAccessService } from "../src/common/org-access.service";
import { InventoryService } from "../src/inventory/inventory.service";
import { OrdersService } from "../src/orders/orders.service";
import { CouponsService } from "../src/coupons/coupons.service";
import { ReservationsService } from "../src/reservations/reservations.service";
import { WaitingRoomService } from "../src/waiting-room/waiting-room.service";
import { PaymentsService } from "../src/payments/payments.service";
import { IdempotencyService } from "../src/common/idempotency.service";
import { issueTicketsForOrder } from "../../worker/src/issue-tickets";
import { createFixtureEvent, cleanupFixtureEvent } from "../src/__tests__/helpers";

let pass = 0, fail = 0;
function ok(nome: string, cond: boolean, extra?: unknown) {
  if (cond) { pass++; console.log(`  PASS ${nome}`); }
  else { fail++; console.log(`  FAIL ${nome}`, extra ?? ""); }
}
function eq(nome: string, a: unknown, b: unknown) {
  ok(`${nome} — esperado ${JSON.stringify(b)}, veio ${JSON.stringify(a)}`, a === b);
}

/** o que o comprador de fato recebe/vira, seja qual for o caminho */
async function retrato(orderId: string) {
  const o = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
  const n = await prisma.notification.findMany({ where: { orderId }, select: { template: true, recipient: true, channel: true } });
  const conta = o.contactEmail ? await prisma.user.findUnique({ where: { email: o.contactEmail } }) : null;
  return {
    temDono: o.userId !== null,
    contaExiste: !!conta,
    contaVerificada: conta ? conta.emailVerifiedAt !== null : null,
    nascidaDoPedido: o.accountCreatedByOrder,
    templates: n.filter((x) => x.channel === "EMAIL").map((x) => x.template).sort(),
    destinatario: n.find((x) => x.channel === "EMAIL")?.recipient ?? null,
  };
}

async function main() {
  const orgAccess = new OrgAccessService();
  const catalog = new CatalogService(orgAccess, new InventoryService());
  const orders = new OrdersService(new CouponsService(orgAccess), orgAccess);
  const reservations = new ReservationsService(new InventoryService(), new WaitingRoomService());
  const payments = new PaymentsService(new IdempotencyService());
  const suf = Math.random().toString(36).slice(2, 8);

  const f = await createFixtureEvent({ lotCapacity: 50, priceCents: 5000, feeCents: 0 });
  const ev = f.event;
  const lote = f.lot;
  const dono = await prisma.user.create({ data: { email: `dono-${suf}@lab.test`, emailVerifiedAt: new Date() } });
  await prisma.organizationMember.create({
    data: { organizationId: f.organization.id, userId: dono.id, roleId: f.ownerRoleId, status: "ACTIVE" },
  });

  async function comprarOnline(email: string) {
    const r = await reservations.create(undefined, { eventId: ev.id, items: [{ ticketLotId: lote.id, quantity: 1 }] } as never);
    const o = await orders.createFromReservation(undefined, { reservationId: r.id, contactEmail: email, contactName: "Comprador" } as never);
    const pay = await payments.createPix(o.id, {});
    await applyGatewayStatus(pay.id, "PAID");
    await issueTicketsForOrder(o.id);
    return o.id;
  }
  async function venderAntecipado(email: string) {
    const v = await orders.createManualSale(ev.id, dono.id, { ticketLotId: lote.id, quantity: 1, buyerName: "Comprador", buyerEmail: email } as never);
    const id = (v as { orderId: string }).orderId;
    await issueTicketsForOrder(id);
    return id;
  }

  try {
    console.log("\n=== CASO 1: comprador SEM conta ===");
    const onA = await retrato(await comprarOnline(`novo-on-${suf}@lab.test`));
    const pdA = await retrato(await venderAntecipado(`novo-pdv-${suf}@lab.test`));
    console.log("  online:", JSON.stringify(onA));
    console.log("  balcão:", JSON.stringify(pdA));
    ok("online cria a conta", onA.contaExiste);
    ok("balcão cria a conta também", pdA.contaExiste);
    eq("dono do pedido bate", pdA.temDono, onA.temDono);
    eq("marca 'conta nasceu deste pedido' bate", pdA.nascidaDoPedido, onA.nascidaDoPedido);
    eq("conta verificada bate", pdA.contaVerificada, onA.contaVerificada);
    ok("MESMO e-mail nos dois caminhos", JSON.stringify(pdA.templates) === JSON.stringify(onA.templates), `${JSON.stringify(onA.templates)} vs ${JSON.stringify(pdA.templates)}`);

    console.log("\n=== CASO 2: comprador COM conta já existente ===");
    await prisma.user.create({ data: { email: `velho-on-${suf}@lab.test`, emailVerifiedAt: new Date() } });
    await prisma.user.create({ data: { email: `velho-pdv-${suf}@lab.test`, emailVerifiedAt: new Date() } });
    const onB = await retrato(await comprarOnline(`velho-on-${suf}@lab.test`));
    const pdB = await retrato(await venderAntecipado(`velho-pdv-${suf}@lab.test`));
    console.log("  online:", JSON.stringify(onB));
    console.log("  balcão:", JSON.stringify(pdB));
    eq("dono do pedido bate (anti-sequestro nos dois)", pdB.temDono, onB.temDono);
    ok("MESMO e-mail nos dois caminhos", JSON.stringify(pdB.templates) === JSON.stringify(onB.templates), `${JSON.stringify(onB.templates)} vs ${JSON.stringify(pdB.templates)}`);
    ok("e-mail vai para o endereço do comprador", pdB.destinatario === `velho-pdv-${suf}@lab.test`, pdB.destinatario);

    console.log("\n=== CASO 3: o que ainda difere (diagnóstico honesto) ===");
    const contaOnline = await prisma.user.findUniqueOrThrow({ where: { email: `novo-on-${suf}@lab.test` } });
    const contaPdv = await prisma.user.findUniqueOrThrow({ where: { email: `novo-pdv-${suf}@lab.test` } });
    console.log(`  CPF na conta — online: ${contaOnline.cpf ?? "null"} | balcão: ${contaPdv.cpf ?? "null"}`);
    ok("conta do balcão nasce sem CPF (decisão de segurança 2026-09-01, anti-grilagem)", contaPdv.cpf === null);
  } finally {
    await cleanupFixtureEvent(f.organization.id).catch(() => undefined);
    await prisma.$disconnect().catch(() => undefined);
    await closeRedisConnection();
  }

  console.log(`\n${pass} PASS, ${fail} FAIL`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
