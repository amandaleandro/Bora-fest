/**
 * Laboratório dos GANHOS e do CANCELAMENTO (2026-08-29).
 *
 * Roda o código de verdade contra um Postgres de verdade: monta venda, taxa,
 * reembolso e saque no ledger e confere se o que o produtor vê bate com o que
 * é dele. Aqui é onde um erro de sinal ou de proporção aparece antes de virar
 * dinheiro errado na tela de alguém.
 *
 *   DATABASE_URL=... npx tsx scripts/ganhos-lab.ts
 */
import { randomUUID } from "node:crypto";
import { prisma } from "@borafest/database";
import { applyGatewayStatus } from "@borafest/payments";
import {
  getEarningsByEventCents,
  getEventNetCents,
  getOrganizationEarnings,
} from "../src/common/ledger";
import { estornarTaxaDaPlataforma, executarReembolso } from "../src/common/refund-order";
import { agruparExtrato } from "../src/common/extrato";

let passou = 0;
let falhou = 0;

function ok(nome: string, condicao: boolean, detalhe = "") {
  if (condicao) {
    passou++;
    console.log(`  PASS  ${nome}`);
  } else {
    falhou++;
    console.log(`  FAIL  ${nome} ${detalhe}`);
  }
}

/** A identidade que a tela promete: as parcelas somam o total. */
function fecha(g: {
  receivedCents: number; inTransitCents: number; availableCents: number;
  pendingReleaseCents: number; debtCents: number;
}): number {
  return g.receivedCents + g.inTransitCents + g.availableCents + g.pendingReleaseCents - g.debtCents;
}

/** Saldo de um pedido no ledger, nos dois endereços possíveis. */
async function saldoDoPedido(p: {
  pedido: { id: string };
  pagamento: { id: string } | null;
}): Promise<number> {
  const linhas = await prisma.ledgerEntry.findMany({
    where: {
      OR: [
        { referenceType: "order", referenceId: p.pedido.id },
        ...(p.pagamento ? [{ referenceType: "payment", referenceId: p.pagamento.id }] : []),
      ],
    },
    select: { amountCents: true },
  });
  return linhas.reduce((s, l) => s + l.amountCents, 0);
}

function eq(nome: string, recebido: number, esperado: number) {
  ok(nome, recebido === esperado, `— esperado ${esperado}, veio ${recebido}`);
}

async function cenario() {
  const sufixo = Math.random().toString(36).slice(2, 10);
  const org = await prisma.organization.create({
    data: { name: `Lab ${sufixo}`, slug: `lab-${sufixo}`, kind: "COMPANY", status: "ACTIVE", document: `000${sufixo}` },
  });
  const evento = await prisma.event.create({
    data: {
      organizationId: org.id,
      title: `Lab ${sufixo}`,
      slug: `lab-${sufixo}`,
      status: "PUBLISHED",
      startsAt: new Date(Date.now() - 86_400_000),
      endsAt: new Date(Date.now() - 82_800_000),
    },
  });
  const conta = await prisma.ledgerAccount.create({ data: { organizationId: org.id } });
  const ator = await prisma.user.create({
    data: { email: `lab-${sufixo}@borafest.test`, name: "Lab" },
  });

  /**
   * Uma venda como o sistema realmente lança:
   *  - online: crédito e taxa apontam para o PAGAMENTO
   *  - PDV (dinheiro): apontam para o PEDIDO
   * Os dois caminhos precisam dar o mesmo resultado pro produtor.
   */
  async function novoPedido(totalCents: number, feeCents: number, online: boolean) {
    const pedido = await prisma.order.create({
      data: {
        event: { connect: { id: evento.id } },
        reservation: {
          create: {
            event: { connect: { id: evento.id } },
            expiresAt: new Date(Date.now() + 15 * 60_000),
          },
        },
        publicToken: randomUUID(),
        contactEmail: `lab-${sufixo}@borafest.test`,
        status: "PAID",
        totalCents,
      },
    });
    let pagamento: { id: string } | null = null;
    if (online) {
      pagamento = await prisma.payment.create({
        data: {
          orderId: pedido.id, provider: "lab", method: "PIX",
          amountCents: totalCents, status: "PAID",
          externalId: `ext-${randomUUID().slice(0, 8)}`,
        },
      });
    }
    const endereco = online
      ? { referenceType: "payment", referenceId: pagamento!.id }
      : { referenceType: "order", referenceId: pedido.id };
    // venda madura (evento já passou) para o saldo contar como disponível
    const maduro = new Date(Date.now() - 3_600_000);
    await prisma.ledgerEntry.createMany({
      data: [
        { ledgerAccountId: conta.id, type: "SALE_CREDIT", amountCents: totalCents, availableAt: maduro, ...endereco },
        { ledgerAccountId: conta.id, type: "PLATFORM_FEE", amountCents: -feeCents, availableAt: maduro, ...endereco },
      ],
    });
    return { pedido, pagamento, endereco };
  }

  console.log("\n1) Venda simples (PDV) — o produtor vê o líquido, não o bruto");
  const a = await novoPedido(5500, 500, false);
  let ganhos = await getOrganizationEarnings(org.id);
  eq("total é o líquido (5500 bruto − 500 taxa)", ganhos.totalCents, 5000);
  eq("líquido do evento", await getEventNetCents(evento.id), 5000);
  const porEvento = await getEarningsByEventCents(org.id);
  eq("líquido por evento (mapa)", porEvento.get(evento.id) ?? 0, 5000);

  console.log("\n2) As quatro parcelas somam o total, sempre");
  eq("recebido + a caminho + disponível + a liberar − em aberto = total", fecha(ganhos), ganhos.totalCents);

  console.log("\n3) Reembolso TOTAL online pelo caminho REAL do gateway");
  const b = await novoPedido(10000, 1000, true);
  // applyGatewayStatus é o que roda em producao — nao grava o bruto: o
  // reverseOrganizationLedgerAndStock ja devolve a taxa junto (−credito −taxa).
  // A primeira versao deste lab gravava −10000 na mao e escondia o bug.
  await applyGatewayStatus(b.pagamento!.id, "REFUNDED", undefined, { refundAmountCents: 10000 });
  const debitoReal = await prisma.ledgerEntry.findFirst({
    where: { ...b.endereco, type: "REFUND_DEBIT" },
    select: { amountCents: true },
  });
  eq("o estorno total grava o LÍQUIDO, não o bruto", debitoReal?.amountCents ?? 0, -9000);
  eq("saldo do pedido ja fecha em zero sozinho", await saldoDoPedido(b), 0);
  eq("evento volta ao que era antes daquela venda", await getEventNetCents(evento.id), 5000);

  console.log("\n4) Evento cancelado: NÃO pode devolver a taxa duas vezes");
  eq("nada a estornar — a taxa ja voltou no proprio estorno", await estornarTaxaDaPlataforma(b.pedido.id), 0);
  eq("saldo do pedido segue zero", await saldoDoPedido(b), 0);
  ok(
    "plataforma nao paga do proprio bolso",
    (await getOrganizationEarnings(org.id)).totalCents === 5000,
    `— veio ${(await getOrganizationEarnings(org.id)).totalCents}`,
  );

  console.log("\n5) PDV (dinheiro): aí a taxa FICA presa e precisa voltar");
  const p2 = await novoPedido(3300, 300, false);
  await prisma.ledgerEntry.create({
    data: {
      ledgerAccountId: conta.id, type: "REFUND_DEBIT", amountCents: -3300,
      referenceType: "order", referenceId: p2.pedido.id,
    },
  });
  eq("pedido fica devendo exatamente a taxa", await saldoDoPedido(p2), -300);
  eq("estorno devolve a taxa cheia", await estornarTaxaDaPlataforma(p2.pedido.id), 300);
  eq("e o pedido fecha em zero", await saldoDoPedido(p2), 0);

  console.log("\n6) Rodar de novo não devolve duas vezes");
  eq("segunda passada credita zero", await estornarTaxaDaPlataforma(p2.pedido.id), 0);
  eq("saldo intacto", await saldoDoPedido(p2), 0);

  console.log("\n7) Parcial online e depois o resto: fecha em zero, sem sobra");
  const c = await novoPedido(20000, 2000, true);
  // 25% primeiro — o caminho parcial grava o BRUTO
  await applyGatewayStatus(c.pagamento!.id, "REFUNDED", undefined, { refundAmountCents: 5000 });
  eq("parcial grava o bruto (taxa fica retida)", await saldoDoPedido(c), 13000);
  eq("estorno proporcional da taxa nao passa do buraco", await estornarTaxaDaPlataforma(c.pedido.id), 0);
  // agora o cancelamento devolve o restante
  await prisma.payment.update({ where: { id: c.pagamento!.id }, data: { status: "PAID" } });
  await applyGatewayStatus(c.pagamento!.id, "REFUNDED", undefined, { refundAmountCents: 15000 });
  const sobra = await saldoDoPedido(c);
  ok("depois do resto, o buraco é no máximo a taxa", sobra <= 0 && sobra >= -2000, `— saldo ${sobra}`);
  const devolvidoC = await estornarTaxaDaPlataforma(c.pedido.id);
  eq("estorno fecha o pedido em zero", await saldoDoPedido(c), 0);
  ok("e nunca devolve mais que a taxa cobrada", devolvidoC <= 2000, `— devolveu ${devolvidoC}`);

  console.log("\n8) Saque: sai do disponível e entra em 'já recebido'");
  const antes = await getOrganizationEarnings(org.id);
  const saque = await prisma.payout.create({
    data: { organizationId: org.id, amountCents: 1000, status: "PAID", paidAt: new Date() },
  });
  await prisma.ledgerEntry.create({
    data: {
      ledgerAccountId: conta.id, type: "PAYOUT_DEBIT", amountCents: -1000,
      referenceType: "payout", referenceId: saque.id,
    },
  });
  const depois = await getOrganizationEarnings(org.id);
  eq("total não muda: sacar não é ganhar menos", depois.totalCents, antes.totalCents);
  eq("já recebido sobe", depois.receivedCents, antes.receivedCents + 1000);
  eq("as parcelas continuam somando o total", fecha(depois), depois.totalCents);

  console.log("\n9) Saque pedido e não pago fica em 'a caminho', não em 'disponível'");
  await prisma.payout.create({
    data: { organizationId: org.id, amountCents: 500, status: "PENDING" },
  });
  const comTransito = await getOrganizationEarnings(org.id);
  eq("a caminho", comTransito.inTransitCents, 500);
  eq("disponível já desconta o pedido", comTransito.availableCents, depois.availableCents - 500);
  eq("e a conta ainda fecha", fecha(comTransito), comTransito.totalCents);

  console.log("\n10) Venda que ainda não liberou não entra em 'disponível'");
  const futuro = await prisma.event.create({
    data: {
      organizationId: org.id, title: `Futuro ${sufixo}`, slug: `futuro-${sufixo}`,
      status: "PUBLISHED",
      startsAt: new Date(Date.now() + 7 * 86_400_000),
      endsAt: new Date(Date.now() + 7 * 86_400_000 + 3_600_000),
    },
  });
  const pedidoFuturo = await prisma.order.create({
    data: {
      event: { connect: { id: futuro.id } },
      reservation: {
        create: {
          event: { connect: { id: futuro.id } },
          expiresAt: new Date(Date.now() + 15 * 60_000),
        },
      },
      publicToken: randomUUID(),
      contactEmail: `lab-${sufixo}@borafest.test`,
      status: "PAID",
      totalCents: 3300,
    },
  });
  const liberaDepois = new Date(Date.now() + 9 * 86_400_000);
  await prisma.ledgerEntry.createMany({
    data: [
      {
        ledgerAccountId: conta.id, type: "SALE_CREDIT", amountCents: 3300,
        referenceType: "order", referenceId: pedidoFuturo.id, availableAt: liberaDepois,
      },
      {
        ledgerAccountId: conta.id, type: "PLATFORM_FEE", amountCents: -300,
        referenceType: "order", referenceId: pedidoFuturo.id, availableAt: liberaDepois,
      },
    ],
  });
  const comFuturo = await getOrganizationEarnings(org.id);
  eq("total já conta a venda nova", comFuturo.totalCents, comTransito.totalCents + 3000);
  eq("mas ela está em 'a liberar'", comFuturo.pendingReleaseCents, 3000);
  eq("disponível não mexeu", comFuturo.availableCents, comTransito.availableCents);
  eq("conta fecha com dinheiro preso e em trânsito juntos", fecha(comFuturo), comFuturo.totalCents);

  console.log("\n11) A taxa da plataforma nunca aparece como linha própria pro produtor");
  const doEvento = await getEarningsByEventCents(org.id);
  eq("evento do passado", doEvento.get(evento.id) ?? 0, await getEventNetCents(evento.id));
  eq("evento futuro", doEvento.get(futuro.id) ?? 0, 3000);

  console.log("\n12) Extrato: uma linha por venda e uma por estorno, ambas líquidas");
  const brutas = await prisma.ledgerEntry.findMany({
    where: { ledgerAccountId: conta.id },
    orderBy: { createdAt: "desc" },
    select: { type: true, amountCents: true, referenceType: true, referenceId: true },
  });
  const agrupadas = agruparExtrato(brutas);
  eq(
    "somar as linhas agrupadas dá o mesmo saldo de antes",
    agrupadas.reduce((s, l) => s + l.amountCents, 0),
    brutas.reduce((s, l) => s + l.amountCents, 0),
  );
  ok(
    "nenhuma linha de taxa sobrou visível",
    agrupadas.every((l) => l.type !== "PLATFORM_FEE"),
  );
  ok("agrupou de fato (menos linhas que o ledger cru)", agrupadas.length < brutas.length);
  const vendaPdv = agrupadas.find(
    (l) => l.type === "SALE_CREDIT" && l.referenceId === a.pedido.id,
  );
  eq("a venda de 5500 com taxa 500 lê 5000", vendaPdv?.amountCents ?? -1, 5000);
  const estornoOnline = agrupadas.find(
    (l) => l.type === "REFUND_DEBIT" && l.referenceId === b.pagamento!.id,
  );
  eq("e o estorno dela lê o líquido, simétrico", estornoOnline?.amountCents ?? 0, -9000);

  console.log("\n13) Sacou tudo e depois cancelou: a conta AINDA fecha, com a dívida à vista");
  const antesDaDivida = await getOrganizationEarnings(org.id);
  // saca todo o disponivel
  if (antesDaDivida.availableCents > 0) {
    const saqueTudo = await prisma.payout.create({
      data: { organizationId: org.id, amountCents: antesDaDivida.availableCents, status: "PAID", paidAt: new Date() },
    });
    await prisma.ledgerEntry.create({
      data: {
        ledgerAccountId: conta.id, type: "PAYOUT_DEBIT", amountCents: -antesDaDivida.availableCents,
        referenceType: "payout", referenceId: saqueTudo.id,
      },
    });
  }
  // e agora estorna uma venda que ja estava madura — o dinheiro ja saiu
  const d = await novoPedido(50000, 5000, false);
  await prisma.ledgerEntry.create({
    data: {
      ledgerAccountId: conta.id, type: "REFUND_DEBIT", amountCents: -50000,
      referenceType: "order", referenceId: d.pedido.id,
    },
  });
  const comDivida = await getOrganizationEarnings(org.id);
  ok("o saldo ficou devedor", comDivida.debtCents > 0, `— divida ${comDivida.debtCents}`);
  eq("disponível não fica negativo na tela", Math.min(comDivida.availableCents, 0), 0);
  eq("a liberar não fica negativo na tela", Math.min(comDivida.pendingReleaseCents, 0), 0);
  eq("e a identidade AINDA fecha com a dívida", fecha(comDivida), comDivida.totalCents);

  console.log("\n14) Comissão de promoter NÃO pode inflar o ganho do evento");
  // o crédito da comissão vive na carteira do PROMOTER (outra conta), com o
  // MESMO referenceId do débito na casa — somar as duas anula o desconto
  const promoter = await prisma.organization.create({
    data: {
      name: `Promoter ${sufixo}`, slug: `promoter-${sufixo}`, kind: "INDIVIDUAL",
      status: "ACTIVE", document: `999${sufixo}`,
    },
  });
  const contaPromoter = await prisma.ledgerAccount.create({ data: { organizationId: promoter.id } });
  const ganhoAntes = await getEventNetCents(evento.id);
  const e = await novoPedido(10000, 1000, true);
  await prisma.ledgerEntry.create({
    data: {
      ledgerAccountId: conta.id, type: "COMMISSION_DEBIT", amountCents: -1500,
      referenceType: "payment", referenceId: e.pagamento!.id,
    },
  });
  await prisma.ledgerEntry.create({
    data: {
      ledgerAccountId: contaPromoter.id, type: "COMMISSION_CREDIT", amountCents: 1500,
      referenceType: "payment", referenceId: e.pagamento!.id,
    },
  });
  const noEvento = await getEventNetCents(evento.id);
  const noResumo = (await getEarningsByEventCents(org.id)).get(evento.id) ?? 0;
  eq("dashboard do evento e Resumo dizem o MESMO número", noEvento, noResumo);
  eq("o ganho sobe só o líquido MENOS a comissão", noEvento - ganhoAntes, 10000 - 1000 - 1500);

  console.log("\n15) Venda de PDV com ingresso emitido (FULFILLED) é reembolsável");
  const f = await novoPedido(4000, 400, false);
  await prisma.order.update({ where: { id: f.pedido.id }, data: { status: "FULFILLED" } });
  let deuCerto = true;
  let erroPdv = "";
  try {
    await executarReembolso(f.pedido.id, ator.id, { amountCents: 4000, reason: "evento cancelado" });
  } catch (err) {
    deuCerto = false;
    erroPdv = (err as Error).message;
  }
  ok("PDV FULFILLED nao trava mais o cancelamento", deuCerto, `— ${erroPdv}`);
  eq("estorno devolve a taxa e fecha o pedido", await estornarTaxaDaPlataforma(f.pedido.id), 400);
  eq("pedido em zero", await saldoDoPedido(f), 0);

  console.log("\n16) Pedido com DOIS pagamentos aprovados nao e adivinhado");
  const g = await novoPedido(7000, 700, true);
  await prisma.payment.create({
    data: {
      orderId: g.pedido.id, provider: "lab", method: "PIX", amountCents: 7000,
      status: "PAID", externalId: `ext-dup-${randomUUID().slice(0, 8)}`,
    },
  });
  let recusou = false;
  try {
    await executarReembolso(g.pedido.id, ator.id, { amountCents: 7000, reason: "teste" });
  } catch {
    recusou = true;
  }
  ok("recusa e pede olho humano em vez de estornar o errado", recusou);

  // limpeza
  await prisma.ledgerEntry.deleteMany({ where: { ledgerAccountId: conta.id } });
  await prisma.payout.deleteMany({ where: { organizationId: org.id } });
  await prisma.payment.deleteMany({
    where: { order: { event: { organizationId: org.id } } },
  });
  await prisma.order.deleteMany({ where: { event: { organizationId: org.id } } });
  await prisma.reservation.deleteMany({ where: { event: { organizationId: org.id } } });
  await prisma.ledgerAccount.delete({ where: { id: conta.id } });
  await prisma.event.deleteMany({ where: { organizationId: org.id } });
  await prisma.ledgerEntry.deleteMany({ where: { ledgerAccount: { organization: { slug: { startsWith: `promoter-${sufixo}` } } } } });
  await prisma.ledgerAccount.deleteMany({ where: { organization: { slug: { startsWith: `promoter-${sufixo}` } } } });
  await prisma.organization.deleteMany({ where: { slug: { startsWith: `promoter-${sufixo}` } } });
  await prisma.auditLog.deleteMany({ where: { actorUserId: ator.id } });
  await prisma.organization.delete({ where: { id: org.id } });
  await prisma.user.delete({ where: { id: ator.id } });
  void a;
}

cenario()
  .then(async () => {
    console.log(`\n${passou} PASS, ${falhou} FAIL\n`);
    await prisma.$disconnect();
    process.exit(falhou > 0 ? 1 : 0);
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
