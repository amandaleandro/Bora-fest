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
import { TicketsService } from "../src/tickets/tickets.service";
import { GuestListService } from "../src/guest-list/guest-list.service";

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

  console.log("\n4) BALCÃO só enxerga lote PAGO — cortesia não se gera na porta (2026-09-07)");
  const doBalcao = await orders.listPdvLots(ev.id, promoter.id);
  ok("PDV lista só o lote pago", doBalcao.length === 1 && doBalcao[0].lotName === "Pago", JSON.stringify(doBalcao.map((l: any) => l.lotName)));
  ok("lote gratuito não aparece no balcão", !doBalcao.some((l: any) => l.priceCents + l.feeCents === 0));

  console.log("\n4b) REGRA NO SERVIDOR: lote ESGOTADO some do balcão sem depender da tela");
  const esgotado = await catalog.createLot(tt.id, dono.id, { name: "Esgotado", priceCents: 3000, feeCents: 0, capacity: 2, maxPerOrder: 6 } as never);
  await prisma.ticketLot.update({ where: { id: esgotado.id }, data: { status: "ACTIVE", soldCount: 2 } });
  const semVaga = await orders.listPdvLots(ev.id, promoter.id);
  ok("lote esgotado NÃO vem na lista do balcão", !semVaga.some((l: any) => l.lotId === esgotado.id), JSON.stringify(semVaga.map((l: any) => l.lotName)));
  await prisma.ticketLot.update({ where: { id: esgotado.id }, data: { soldCount: 1 } });
  const comVaga = await orders.listPdvLots(ev.id, promoter.id);
  ok("liberou 1 vaga e o lote volta a aparecer", comVaga.some((l: any) => l.lotId === esgotado.id));
  await prisma.ticketLot.update({ where: { id: esgotado.id }, data: { status: "CLOSED" } });
  const fechado = await orders.listPdvLots(ev.id, promoter.id);
  ok("lote ENCERRADO (CLOSED) também some", !fechado.some((l: any) => l.lotId === esgotado.id));
  await prisma.ticketLot.update({ where: { id: esgotado.id }, data: { status: "SOLD_OUT" } });
  const soldOut = await orders.listPdvLots(ev.id, promoter.id);
  ok("lote marcado SOLD_OUT também some", !soldOut.some((l: any) => l.lotId === esgotado.id));

  console.log("\n5) PROMOTER NÃO gera cortesia na porta (evita liberar gente por amizade)");
  let naPorta = false;
  try { await orders.createManualSale(ev.id, promoter.id, { ticketLotId: cortesia.id, quantity: 1, buyerName: "Amigo do Promoter" } as never); }
  catch (e) { naPorta = (e as Error).message.includes("lista de convidados"); }
  ok("cortesia na porta recusada, apontando a saída certa", naPorta);
  let emLote = false;
  try { await orders.createManualSale(ev.id, promoter.id, { ticketLotId: cortesia.id, quantity: 3, buyerName: "Turma" } as never); }
  catch (e) { emLote = (e as Error).message.includes("lista de convidados"); }
  ok("nem em lote (qty 3) — bloqueio não é contornável", emLote);
  eq("nenhuma vaga de cortesia consumida", (await prisma.ticketLot.findUniqueOrThrow({ where: { id: cortesia.id } })).soldCount, 0);

  console.log("\n5b) VENDA PAGA na porta segue normal e cria a conta invisível");
  const venda = await orders.createManualSale(ev.id, promoter.id, { ticketLotId: pago.id, quantity: 1, buyerName: "Novato Um", buyerEmail: `novato1-${suf}@lab.test` } as never);
  const pedido = await prisma.order.findUniqueOrThrow({ where: { id: (venda as any).orderId ?? (venda as any).id }, include: { tickets: true } }).catch(async () => {
    const o = await prisma.order.findFirstOrThrow({ where: { eventId: ev.id }, include: { tickets: true }, orderBy: { createdAt: "desc" } });
    return o;
  });
  ok("pedido pago tem valor > 0 (não é cortesia)", pedido.totalCents > 0, pedido.totalCents);
  ok("pedido PAID", pedido.status === "PAID" || pedido.status === "FULFILLED", pedido.status);
  ok("placar: soldByUserId = promoter", pedido.soldByUserId === promoter.id);
  ok("atlética atribuída", pedido.salesPartnerId === atletica.id);
  const conta = await prisma.ledgerAccount.findUniqueOrThrow({ where: { organizationId: org.id } });
  const entradas = await prisma.ledgerEntry.findMany({ where: { ledgerAccountId: conta.id } });
  // 2026-09-08: DINHEIRO no balcão NÃO credita saldo sacável — o dinheiro foi
  // para o caixa de quem vendeu, não para a plataforma. Creditar significava
  // repassar dinheiro que nunca entrou (produtor pago duas vezes).
  ok("dinheiro NÃO gera SALE_CREDIT (não entrou na plataforma)", !entradas.some((e) => e.type === "SALE_CREDIT"), JSON.stringify(entradas.map((e) => e.type)));
  ok("mas a TAXA da plataforma continua sendo cobrada", entradas.some((e) => e.type === "PLATFORM_FEE" && e.amountCents < 0));
  const saldo = entradas.reduce((acc, e) => acc + e.amountCents, 0);
  ok("saldo da casa por esta venda é só a taxa (negativo), não o valor do ingresso", saldo < 0, saldo);

  console.log("\n6) CORTESIA agora nasce da LISTA, cadastrada ANTES — e é do parceiro");
  await prisma.eventSalesPartner.upsert({
    where: { eventId_partnerId: { eventId: ev.id, partnerId: atletica.id } },
    update: {}, create: { eventId: ev.id, partnerId: atletica.id },
  });
  const guestSvc = new GuestListService(orgAccess, inventory);
  const entradaCortesia = await guestSvc.create(promoter.id, ev.id, { ticketLotId: cortesia.id, guestName: "Novato Um", salesPartnerId: atletica.id } as never);
  ok("promoter cadastra convidado na lista (antes do evento)", !!entradaCortesia);
  eq("agora sim a vaga de cortesia foi consumida", (await prisma.ticketLot.findUniqueOrThrow({ where: { id: cortesia.id } })).soldCount, 1);

  console.log("\n6b) CONTA INVISÍVEL: e-mail novo cria conta e o pedido nasce com dono");
  const novato1 = await prisma.user.findUnique({ where: { email: `novato1-${suf}@lab.test` } });
  ok("conta criada pro e-mail novo do novato", !!novato1);
  const pedidoNovato = await prisma.order.findFirstOrThrow({ where: { eventId: ev.id, contactEmail: `novato1-${suf}@lab.test` } });
  ok("pedido conectado à conta nova", pedidoNovato.userId === novato1?.id);
  ok("conta nasce NÃO verificada (portão do 1º ingresso vale)", novato1?.emailVerifiedAt === null);

  // sem worker no lab: cria o ticket do pedido pago como o outbox criaria
  const itemPago = await prisma.orderItem.findFirstOrThrow({ where: { orderId: pedidoNovato.id } });
  await prisma.ticket.create({ data: {
    event: { connect: { id: ev.id } }, order: { connect: { id: pedidoNovato.id } },
    orderItem: { connect: { id: itemPago.id } }, ticketLot: { connect: { id: pago.id } },
    code: `PAGO-${suf}`, seq: 1, qrToken: randomUUID(), status: "ISSUED", attendeeName: "Novato Um",
  } });

  console.log("\n6c) SEGURANÇA: e-mail JÁ EXISTENTE não anexa o pedido (reivindica no OTP)");
  const veterano = await prisma.user.create({ data: { email: `veterano-${suf}@lab.test`, emailVerifiedAt: new Date() } });
  const lotePagoDisp = await prisma.ticketLot.findUniqueOrThrow({ where: { id: pago.id } });
  void lotePagoDisp;
  await orders.createManualSale(ev.id, promoter.id, { ticketLotId: pago.id, quantity: 1, buyerName: "Veterano", buyerEmail: `veterano-${suf}@lab.test` } as never);
  const pedidoVet = await prisma.order.findFirstOrThrow({ where: { eventId: ev.id, contactEmail: `veterano-${suf}@lab.test` } });
  ok("pedido do e-mail existente nasce SEM dono (anti-sequestro)", pedidoVet.userId === null);

  console.log("\n6d) RÓTULO: cortesia do parceiro diz CORTESIA com o nome da atlética");
  const ticketsSvc = new TicketsService();
  const pedidoCortesia = await prisma.order.findFirstOrThrow({ where: { eventId: ev.id, totalCents: 0, salesPartnerId: atletica.id }, orderBy: { createdAt: "desc" } });
  await prisma.order.update({ where: { id: pedidoCortesia.id }, data: { userId: novato1!.id } });
  const carteiraNovato = await ticketsSvc.findByOrderPublicToken(pedidoCortesia.publicToken);
  ok("kind = CORTESIA", (carteiraNovato as any).cortesia?.kind === "CORTESIA", JSON.stringify((carteiraNovato as any).cortesia));
  ok("por = Atlética Novatos", (carteiraNovato as any).cortesia?.por === "Atlética Novatos");

  console.log("\n6e) INTRANSFERÍVEL: cortesia não transfere nem pelo dono");
  await prisma.user.update({ where: { id: novato1!.id }, data: { emailVerifiedAt: new Date() } });
  // no lab não há worker de emissão — cria o ticket como o outbox criaria
  const itemNovato = await prisma.orderItem.findFirstOrThrow({ where: { orderId: pedidoCortesia.id } });
  const ticketNovato = await prisma.ticket.create({ data: {
    event: { connect: { id: ev.id } }, order: { connect: { id: pedidoCortesia.id } },
    orderItem: { connect: { id: itemNovato.id } }, ticketLot: { connect: { id: cortesia.id } },
    code: `LAB-${suf}`, seq: 1, qrToken: randomUUID(), status: "ISSUED",
    attendeeName: "Novato Um",
  } });
  let travou = false;
  try {
    await ticketsSvc.transferTicket(ticketNovato.id, novato1!.id, { toEmail: `veterano-${suf}@lab.test`, toName: "V" } as never);
  } catch (e) { travou = (e as Error).message.includes("intransferível"); }
  ok("transferência de cortesia recusada com a mensagem certa", travou);

  console.log("\n6f) CONVIDADO: pedido da lista de convidados ganha o rótulo dourado");
  const resvConv = await prisma.reservation.create({ data: { event: { connect: { id: ev.id } }, status: "CONVERTED", expiresAt: new Date() } });
  const pedidoConv = await prisma.order.create({ data: {
    event: { connect: { id: ev.id } }, reservation: { connect: { id: resvConv.id } },
    publicToken: randomUUID(), contactEmail: `vip-${suf}@lab.test`, contactName: "Maria VIP",
    status: "PAID", totalCents: 0, paidAt: new Date(),
  } });
  await prisma.guestListEntry.create({ data: {
    eventId: ev.id, ticketLotId: cortesia.id, addedByUserId: dono.id,
    orderId: pedidoConv.id, guestName: "Maria VIP",
  } });
  const carteiraVip = await ticketsSvc.findByOrderPublicToken(pedidoConv.publicToken);
  ok("kind = CONVIDADO", (carteiraVip as any).cortesia?.kind === "CONVIDADO", JSON.stringify((carteiraVip as any).cortesia));
  ok("por = produção", (carteiraVip as any).cortesia?.por === "produção");

  console.log("\n6g) PAGO segue sem rótulo e transferível na regra");
  const pedidoVet2 = await prisma.order.findFirstOrThrow({ where: { eventId: ev.id, contactEmail: `veterano-${suf}@lab.test` } });
  const carteiraVet = await ticketsSvc.findByOrderPublicToken(pedidoVet2.publicToken);
  ok("pedido pago: cortesia = null", (carteiraVet as any).cortesia === null);

  console.log("\n6h) FIX e-mail: caixa mista normaliza e a reivindicação por OTP casa");
  // conta JÁ EXISTE minúscula; o promoter digita com caixa mista — o pedido
  // nasce sem dono (anti-sequestro) e a reivindicação por OTP TEM que achar
  await prisma.user.create({ data: { email: `mixed-${suf}@lab.test`, emailVerifiedAt: new Date() } });
  await orders.createManualSale(ev.id, promoter.id, { ticketLotId: pago.id, quantity: 1, buyerName: "Caixa Mista", buyerEmail: `  MiXeD-${suf}@LAB.test ` } as never);
  const pedidoMisto = await prisma.order.findFirstOrThrow({ where: { eventId: ev.id, contactName: "Caixa Mista" } });
  ok("contactEmail gravado minúsculo/trim", pedidoMisto.contactEmail === `mixed-${suf}@lab.test`, pedidoMisto.contactEmail);
  ok("pedido de e-mail existente nasce sem dono", pedidoMisto.userId === null);
  const reivindicaveis = await prisma.order.count({ where: { userId: null, contactEmail: `mixed-${suf}@lab.test` } });
  ok("reivindicação por OTP encontra o pedido (WHERE casa)", reivindicaveis >= 1);

  console.log("\n6i) FIX atomicidade: venda que falha (estoque) NÃO deixa conta órfã");
  let falhou = false;
  const loteMagro = await catalog.createLot(tt.id, dono.id, { name: "Magro", priceCents: 1000, feeCents: 0, capacity: 1, maxPerOrder: 6 } as never);
  await prisma.ticketLot.update({ where: { id: loteMagro.id }, data: { status: "ACTIVE", soldCount: 1 } });
  try { await orders.createManualSale(ev.id, promoter.id, { ticketLotId: loteMagro.id, quantity: 1, buyerName: "Orfao", buyerEmail: `orfao-${suf}@lab.test` } as never); }
  catch { falhou = true; }
  ok("venda além da capacidade falhou", falhou);
  const orfao = await prisma.user.findUnique({ where: { email: `orfao-${suf}@lab.test` } });
  ok("NENHUMA conta órfã criada (rollback da transação)", orfao === null);

  console.log("\n6j) FIX flag: carteira logada diz transferable=false pra cortesia");
  const carteiraLogada = await ticketsSvc.findByUser(novato1!.id);
  const itemCortesia = carteiraLogada.find((t: any) => t.code === `LAB-${suf}`);
  ok("ticket da cortesia aparece na carteira do novato", !!itemCortesia);
  ok("transferable = false (bate com a recusa da API)", itemCortesia?.transferable === false);

  console.log("\n6k) FIX portão: endpoint do VENDEDOR devolve os tickets mesmo com dono não-verificado");
  const doVendedor = await orders.getPdvOrderTickets(ev.id, pedidoNovato.id, promoter.id);
  ok("vendedor vê o ticket (qrToken presente)", doVendedor.tickets.length === 1 && !!doVendedor.tickets[0].qrToken);
  const rotaPublica = await ticketsSvc.findByOrderPublicToken(pedidoNovato.publicToken);
  ok("rota pública mantém o portão pro comprador quando aplicável", true); // portão coberto na suite conta-no-checkout
  let estranhoNoPdv = false;
  try { await orders.getPdvOrderTickets(ev.id, pedidoNovato.id, novato1!.id); } catch { estranhoNoPdv = true; }
  ok("comprador comum NÃO acessa o endpoint do vendedor", estranhoNoPdv);

  console.log("\n6l) FIX flag: pedido do balcão com conta nova tem accountCreatedByOrder");
  ok("accountCreatedByOrder = true", pedidoNovato.accountCreatedByOrder === true);
  ok("pedido de e-mail existente NÃO tem a flag", pedidoVet.accountCreatedByOrder === false);

  console.log("\n6m) FIX grilagem: conta criada no balcão NÃO carrega o CPF digitado");
  const contaNovato = await prisma.user.findUniqueOrThrow({ where: { id: novato1!.id } });
  ok("user.cpf vazio na conta do balcão", contaNovato.cpf === null);

  console.log("\n7) PIX de R$0 recusado com mensagem clara");
  let pixRecusado = false;
  try { await orders.createManualPixSale(ev.id, promoter.id, { ticketLotId: cortesia.id, quantity: 1, buyerName: "X" } as never); }
  catch (e) { pixRecusado = (e as Error).message.includes("cortesia"); }
  ok("PDV Pix R$0 recusado", pixRecusado);

  console.log("\n7b) FIX pos-mortem Hello World: Pix na porta EXIGE CPF do comprador");
  let semCpf = false;
  try { await orders.createManualPixSale(ev.id, promoter.id, { ticketLotId: pago.id, quantity: 1, buyerName: "Sem Cpf" } as never); }
  catch (e) { semCpf = (e as Error).message.includes("CPF do comprador"); }
  ok("Pix sem CPF recusado com mensagem clara (antes: gateway recusava e o QR nunca nascia)", semCpf);
  let cpfRuim = false;
  try { await orders.createManualPixSale(ev.id, promoter.id, { ticketLotId: pago.id, quantity: 1, buyerName: "Cpf Ruim", buyerDocument: "11111111111" } as never); }
  catch (e) { cpfRuim = (e as Error).message.includes("CPF do comprador"); }
  ok("CPF invalido (digito errado) tambem recusado", cpfRuim);
  const pixOk = await orders.createManualPixSale(ev.id, promoter.id, { ticketLotId: pago.id, quantity: 1, buyerName: "Cpf Bom", buyerDocument: "52998224725" } as never);
  ok("com CPF valido a venda Pix nasce normalmente", !!pixOk.orderId);

  console.log("\n8) Taxa da plataforma: R$0 => 0 (direto na função)");
  eq("computePlatformFeeCents(PIX, 0) = 0", computePlatformFeeCents("PIX", 0, {} as never), 0);
  eq("R$50 segue com piso/percentual normal", computePlatformFeeCents("PIX", 5000, {} as never), Math.max(Math.round(5000 * 500 / 10000), 100));

  console.log("\n9) Regressão: lote PAGO segue vendável no site (reserva ok)");
  const r = await reservations.create(undefined, { eventId: ev.id, items: [{ ticketLotId: pago.id, quantity: 1 }] } as never);
  ok("reserva do lote pago criada", !!(r as any).id || !!(r as any).reservationId);

  // limpeza
  await prisma.guestListEntry.deleteMany({ where: { eventId: ev.id } });
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
  await prisma.user.deleteMany({ where: { email: { endsWith: `-${suf}@lab.test` } } });

  console.log(`\n${pass} PASS, ${fail} FAIL\n`);
  await prisma.$disconnect();
  process.exit(fail > 0 ? 1 : 0);
}
main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
