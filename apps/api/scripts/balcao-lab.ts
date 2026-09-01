/**
 * Laboratório do LOTE SÓ-BALCÃO / CORTESIA (2026-08-31).
 * Prova: invisível no site, reserva pública recusada, promoter emite R$0 sem
 * debitar o produtor, placar conta, capacidade respeitada, Pix R$0 recusado.
 */
import { randomUUID } from "node:crypto";
import { prisma } from "@borafest/database";
import { computePlatformFeeCents } from "@borafest/payments";
import { CatalogService } from "../src/catalog/catalog.service";
import { InventoryService } from "../src/inventory/inventory.service";
import { OrdersService } from "../src/orders/orders.service";
import { ReservationsService } from "../src/reservations/reservations.service";
import { OrgAccessService } from "../src/common/org-access.service";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, d = "") => { c ? (pass++, console.log(`  PASS ${n}`)) : (fail++, console.log(`  FAIL ${n} ${d}`)); };
const eq = (n: string, got: number, exp: number) => ok(n, got === exp, `— esperado ${exp}, veio ${got}`);

async function main() {
  const orgAccess = new OrgAccessService();
  const inventory = new InventoryService();
  const catalog = new CatalogService(orgAccess as never, inventory);
  const orders = new OrdersService(null as never, orgAccess as never);
  // sala de espera desativada nos eventos do lab: o serviço só é consultado
  // quando o evento tem waitingRoom ligado — stub que sempre libera
  const waitingRoomStub = { assertAdmitted: async () => undefined, ensureAdmitted: async () => undefined } as never;
  const reservations = new ReservationsService(inventory, waitingRoomStub);

  const suf = randomUUID().slice(0, 8);
  const org = await prisma.organization.create({ data: { name: `b${suf}`, slug: `b-${suf}`, kind: "COMPANY", status: "ACTIVE", document: `d${Date.now()}`.slice(0, 14) } });
  await prisma.ledgerAccount.create({ data: { organizationId: org.id } });
  const dono = await prisma.user.create({ data: { email: `dono-${suf}@lab.test`, emailVerifiedAt: new Date() } });
  const promoter = await prisma.user.create({ data: { email: `prom-${suf}@lab.test`, name: "Promoter Teste", emailVerifiedAt: new Date() } });
  const ownerRole = await prisma.role.findUniqueOrThrow({ where: { key: "owner" } });
  const sellerRole = await prisma.role.findUniqueOrThrow({ where: { key: "seller" } });
  await prisma.organizationMember.create({ data: { organizationId: org.id, userId: dono.id, roleId: ownerRole.id, status: "ACTIVE" } });
  const atletica = await prisma.salesPartner.create({ data: { organizationId: org.id, name: "Atlética Novatos", slug: `atl-${suf}`, active: true, commissionBps: 0 } });
  await prisma.organizationMember.create({ data: { organizationId: org.id, userId: promoter.id, roleId: sellerRole.id, status: "ACTIVE", salesPartnerId: atletica.id } });

  const ev = await prisma.event.create({ data: { organizationId: org.id, title: "Festa Balcão", slug: `balcao-${suf}`, status: "PUBLISHED", startsAt: new Date(Date.now() + 7 * 864e5), endsAt: new Date(Date.now() + 7 * 864e5 + 4 * 3600e3) } });
  const tt = await prisma.ticketType.create({ data: { eventId: ev.id, name: "Pista" } });

  console.log("\n1) Criação: lote pago normal + lote CORTESIA só-balcão (R$0, cap 3)");
  const pago = await catalog.createLot(tt.id, dono.id, { name: "Pago", priceCents: 5000, feeCents: 0, capacity: 100, maxPerOrder: 6 } as never);
  await prisma.ticketLot.update({ where: { id: pago.id }, data: { status: "ACTIVE" } });
  const cortesia = await catalog.createLot(tt.id, dono.id, { name: "Cortesia Novatos", priceCents: 0, feeCents: 0, capacity: 3, maxPerOrder: 6, pdvOnly: true } as never);
  await prisma.ticketLot.update({ where: { id: cortesia.id }, data: { status: "ACTIVE" } });
  ok("cortesia nasce pdvOnly", (await prisma.ticketLot.findUniqueOrThrow({ where: { id: cortesia.id } })).pdvOnly === true);
  eq("cortesia R$0 nasce com taxa de serviço 0", cortesia.feeCents, 0);

  console.log("\n2) SITE não vê o lote só-balcão");
  const publico = await catalog.getPublicEvent(ev.slug);
  const lotesPublicos = publico.ticketTypes.flatMap((t: any) => t.lots.map((l: any) => l.name));
  ok("hotsite lista só o lote pago", lotesPublicos.length === 1 && lotesPublicos[0] === "Pago", JSON.stringify(lotesPublicos));
  const avail = await catalog.getPublicAvailability(ev.slug);
  ok("availability pública sem a cortesia", !avail.some((a: any) => a.lotName === "Cortesia Novatos"));

  console.log("\n3) RESERVA PÚBLICA recusada mesmo sabendo o id do lote");
  let recusou = false;
  try { await reservations.create(undefined, { eventId: ev.id, items: [{ ticketLotId: cortesia.id, quantity: 1 }] } as never); }
  catch (e) { recusou = (e as Error).message.includes("balcão"); }
  ok("reserva do só-balcão recusada", recusou);

  console.log("\n4) BALCÃO vê os dois lotes (endpoint do PDV)");
  const doBalcao = await orders.listPdvLots(ev.id, promoter.id);
  ok("PDV lista pago + cortesia", doBalcao.length === 2 && doBalcao.some((l: any) => l.pdvOnly));

  console.log("\n5) PROMOTER emite a cortesia: ticket sai, produtor NÃO deve nada, placar conta");
  const venda = await orders.createManualSale(ev.id, promoter.id, { ticketLotId: cortesia.id, quantity: 1, buyerName: "Novato Um", buyerEmail: `novato1-${suf}@lab.test` } as never);
  const pedido = await prisma.order.findUniqueOrThrow({ where: { id: (venda as any).orderId ?? (venda as any).id }, include: { tickets: true } }).catch(async () => {
    const o = await prisma.order.findFirstOrThrow({ where: { eventId: ev.id }, include: { tickets: true }, orderBy: { createdAt: "desc" } });
    return o;
  });
  eq("pedido total R$0", pedido.totalCents, 0);
  ok("pedido PAID", pedido.status === "PAID" || pedido.status === "FULFILLED", pedido.status);
  ok("placar: soldByUserId = promoter", pedido.soldByUserId === promoter.id);
  ok("atlética atribuída", pedido.salesPartnerId === atletica.id);
  const conta = await prisma.ledgerAccount.findUniqueOrThrow({ where: { organizationId: org.id } });
  const entradas = await prisma.ledgerEntry.findMany({ where: { ledgerAccountId: conta.id } });
  const liquido = entradas.reduce((s, e) => s + e.amountCents, 0);
  eq("ledger do produtor: líquido 0 (nada de piso de R$1)", liquido, 0);
  ok("nenhuma PLATFORM_FEE negativa lançada", !entradas.some((e) => e.type === "PLATFORM_FEE" && e.amountCents < 0));

  console.log("\n6) CAPACIDADE manda: 3 cortesias esgotam, a 4ª é recusada");
  await orders.createManualSale(ev.id, promoter.id, { ticketLotId: cortesia.id, quantity: 1, buyerName: "Novato Dois" } as never);
  await orders.createManualSale(ev.id, promoter.id, { ticketLotId: cortesia.id, quantity: 1, buyerName: "Novato Três" } as never);
  let esgotou = false;
  try { await orders.createManualSale(ev.id, promoter.id, { ticketLotId: cortesia.id, quantity: 1, buyerName: "Novato Quatro" } as never); }
  catch { esgotou = true; }
  ok("4ª cortesia recusada (capacidade 3)", esgotou);
  const lote = await prisma.ticketLot.findUniqueOrThrow({ where: { id: cortesia.id } });
  eq("soldCount = 3", lote.soldCount, 3);

  console.log("\n7) PIX de R$0 recusado com mensagem clara");
  let pixRecusado = false;
  try { await orders.createManualPixSale(ev.id, promoter.id, { ticketLotId: cortesia.id, quantity: 1, buyerName: "X" } as never); }
  catch (e) { pixRecusado = (e as Error).message.includes("cortesia"); }
  ok("PDV Pix R$0 recusado", pixRecusado);

  console.log("\n8) Taxa da plataforma: R$0 => 0 (direto na função)");
  eq("computePlatformFeeCents(PIX, 0) = 0", computePlatformFeeCents("PIX", 0, {} as never), 0);
  eq("R$50 segue com piso/percentual normal", computePlatformFeeCents("PIX", 5000, {} as never), Math.max(Math.round(5000 * 500 / 10000), 100));

  console.log("\n9) Regressão: lote PAGO segue vendável no site (reserva ok)");
  const r = await reservations.create(undefined, { eventId: ev.id, items: [{ ticketLotId: pago.id, quantity: 1 }] } as never);
  ok("reserva do lote pago criada", !!(r as any).id || !!(r as any).reservationId);

  // limpeza
  await prisma.ticket.deleteMany({ where: { eventId: ev.id } });
  await prisma.order.deleteMany({ where: { eventId: ev.id } });
  await prisma.reservation.deleteMany({ where: { eventId: ev.id } });
  await prisma.ledgerEntry.deleteMany({ where: { ledgerAccountId: conta.id } });
  await prisma.ticketLot.deleteMany({ where: { ticketTypeId: tt.id } });
  await prisma.ticketType.delete({ where: { id: tt.id } });
  await prisma.event.delete({ where: { id: ev.id } });
  await prisma.organizationMember.deleteMany({ where: { organizationId: org.id } });
  await prisma.salesPartner.deleteMany({ where: { organizationId: org.id } });
  await prisma.ledgerAccount.delete({ where: { id: conta.id } });
  await prisma.organization.delete({ where: { id: org.id } });
  await prisma.user.deleteMany({ where: { id: { in: [dono.id, promoter.id] } } });

  console.log(`\n${pass} PASS, ${fail} FAIL\n`);
  await prisma.$disconnect();
  process.exit(fail > 0 ? 1 : 0);
}
main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
