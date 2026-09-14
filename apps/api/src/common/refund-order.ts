import { BadRequestException, NotFoundException } from "@nestjs/common";
import { prisma, returnSaleInventory } from "@borafest/database";
import { applyGatewayStatus, getGateway } from "@borafest/payments";
import { assertRefundWithinCap } from "./refund-cap";

export interface ReembolsoInput {
  amountCents?: number;
  reason: string;
}

/**
 * O reembolso em si, SEM checagem de permissão — quem chama já checou.
 *
 * Extraído de `OrdersService.refundOrder` em 2026-08-29 para o cancelamento de
 * evento reembolsar em massa pelo MESMO caminho que o reembolso avulso já
 * usava. Duplicar esta lógica seria pedir para as duas versões divergirem
 * justamente onde não se pode errar: gateway, teto acumulado, devolução de
 * estoque e cancelamento dos ingressos.
 */
export async function executarReembolso(
  orderId: string,
  actorUserId: string | null,
  input: ReembolsoInput,
): Promise<{ organizationId: string; refundedCents: number }> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      event: { select: { organizationId: true } },
      payments: { orderBy: { createdAt: "desc" } },
    },
  });
  if (!order) throw new NotFoundException("Pedido não encontrado");

  // VENDA DE PORTA NÃO TEM REEMBOLSO (decisão do Arthur, 2026-09-14): entrou
  // no evento, o ingresso foi consumido — não existe estorno, nem em dinheiro,
  // nem em Pix, nem parcial, nem no cancelamento do evento (o cancelamento
  // pula pedidos de porta em restantePorPedido). Antes disto o estorno de
  // porta tirava do saldo do produtor o bruto de uma venda que nunca entrou
  // na plataforma.
  if (order.soldByUserId) {
    throw new BadRequestException("Venda de porta não tem reembolso: quem entrou consumiu o ingresso.");
  }

  /*
   * QUAL pagamento estornar — e se existe algum (revisão adversarial 2026-08-29).
   *
   * O `find(status === "PAID")` sobre uma lista ordenada por data DESC pegava o
   * pagamento MAIS NOVO. Num pedido com pagamento duplicado (o comprador paga o
   * mesmo Pix duas vezes) isso estornava o órfão, fechava o pedido e o
   * comprador ficava sem o dinheiro do pagamento verdadeiro. Situação anômala
   * não se resolve no chute: para e pede olho humano.
   */
  const pagos = order.payments.filter((p) => p.status === "PAID");
  if (pagos.length > 1) {
    throw new BadRequestException(
      "Este pedido tem mais de um pagamento aprovado — estorne pelo backoffice para não devolver o errado",
    );
  }
  const payment = pagos[0];
  let refundedCents = input.amountCents ?? 0;
  let feeBackCents = 0;
  let ticketsCanceled = 0;
  let ticketsInside = 0;

  /*
   * E um pagamento que existe mas NÃO está PAID (REFUND_PENDING de uma
   * tentativa que caiu no meio, PENDING, FAILED) caía silenciosamente no ramo
   * do PDV: lançava o estorno no ledger, marcava o pedido REFUNDED e cancelava
   * os ingressos — sem NUNCA mandar o estorno ao gateway. O cartão do comprador
   * não era creditado, e o pedido virava terminal, fora do alcance da
   * reconciliação. O ramo do PDV é só para pedido pago em dinheiro, que não tem
   * pagamento nenhum.
   */
  if (!payment && order.payments.length > 0) {
    throw new BadRequestException(
      "O pagamento deste pedido está em processamento — espere a conciliação e tente de novo",
    );
  }
  if (payment && !payment.externalId) {
    throw new BadRequestException(
      "Pagamento aprovado sem identificador no gateway — estorne pelo backoffice",
    );
  }

  if (payment && payment.externalId) {
    await assertRefundWithinCap(payment, input.amountCents);
    if (!refundedCents) refundedCents = payment.amountCents;

    const marked = await prisma.payment.updateMany({
      where: { id: payment.id, status: "PAID" },
      data: { status: "REFUND_PENDING" },
    });
    if (marked.count === 0) {
      throw new BadRequestException("Estorno já em andamento para este pagamento");
    }

    const gateway = getGateway(payment.provider);
    let result;
    try {
      result = await gateway.refund({
        externalId: payment.externalId,
        amountCents: input.amountCents,
        idempotencyKey: `producer-refund:${payment.id}:${input.amountCents ?? "full"}`,
      });
    } catch (error) {
      await prisma.payment.updateMany({
        where: { id: payment.id, status: "REFUND_PENDING" },
        data: { status: "PAID" },
      });
      throw error;
    }

    if (result.status === "FAILED") {
      await prisma.payment.updateMany({
        where: { id: payment.id, status: "REFUND_PENDING" },
        data: { status: "PAID" },
      });
      throw new BadRequestException("Gateway recusou o estorno");
    }

    // estorno assíncrono aceito (Asaas "PENDING"): aplica a contabilidade
    // agora, com o valor exato — mesma correção do execute-refund.ts
    // (auditoria 2026-08-12), senão o pagamento ficava preso em REFUND_PENDING
    const statusContabil = result.status === "PENDING" ? "REFUNDED" : result.status;
    await applyGatewayStatus(payment.id, statusContabil, undefined, {
      refundAmountCents: input.amountCents,
    });
  } else {
    // venda do PDV (dinheiro) — sem gateway: estorno manual no ledger
    //
    // FULFILLED entrou aqui em 2026-08-29: venda de porta vira FULFILLED assim
    // que o ingresso é emitido, então na prática NENHUMA venda de PDV podia ser
    // estornada — nem avulsa, nem no cancelamento do evento. Um evento com 12
    // vendas na porta travava o cancelamento inteiro.
    if (!["PAID", "FULFILLED", "PARTIALLY_REFUNDED"].includes(order.status)) {
      throw new BadRequestException("Pedido não está pago para estornar");
    }
    const amountCents = input.amountCents ?? order.totalCents;
    if (amountCents <= 0) {
      throw new BadRequestException("Valor do estorno inválido");
    }
    // TETO ACUMULADO (auditoria 2026-08-12): sem gateway não passava pelo
    // refund-cap. A checagem antiga só olhava o estorno ATUAL contra o total,
    // então dois parciais de R$60 num pedido de R$100 devolviam R$120 e
    // jogavam o caixa da casa no negativo. Soma o que já foi devolvido.
    const jaDevolvido = await prisma.ledgerEntry.aggregate({
      where: { referenceType: "order", referenceId: order.id, type: "REFUND_DEBIT" },
      _sum: { amountCents: true },
    });
    const devolvidoAntes = Math.abs(jaDevolvido._sum.amountCents ?? 0);
    if (devolvidoAntes + amountCents > order.totalCents) {
      const restante = ((order.totalCents - devolvidoAntes) / 100).toLocaleString("pt-BR", {
        style: "currency",
        currency: "BRL",
      });
      throw new BadRequestException(
        `Estorno excede o saldo do pedido — disponível para estorno: ${restante}`,
      );
    }
    // VENDA EM DINHEIRO NÃO TEM LASTRO NO LEDGER (bloqueio nº 3, auditoria
    // 2026-09-12). createManualSale grava SÓ a PLATFORM_FEE: o valor do ingresso
    // nunca entrou na plataforma — foi pro bolso de quem vendeu. Este ramo
    // gravava REFUND_DEBIT do BRUTO contra um crédito que não existe, e o
    // débito nascia maduro: cada estorno de porta tirava do saldo SACÁVEL do
    // produtor o ingresso inteiro, dinheiro que voltou em espécie ao comprador.
    // O que a plataforma deve devolver aqui é a TAXA — e `estornarTaxaDaPlataforma`
    // faz isso pelo saldo do pedido, idempotente.
    //
    // PARCIAL EM DINHEIRO: recusado. Sem lançamento não há como acumular o teto
    // (o cálculo acima lê REFUND_DEBIT), e "devolvi metade em espécie" é
    // exatamente o dinheiro sem lastro que a auditoria mandou não criar.
    const restanteCents = order.totalCents - devolvidoAntes;
    if (input.amountCents !== undefined && input.amountCents < restanteCents) {
      throw new BadRequestException(
        "Venda em dinheiro só aceita estorno TOTAL: o valor volta em espécie, fora da plataforma.",
      );
    }
    const amountCash = restanteCents;
    refundedCents = amountCash;

    await prisma.$transaction(async (tx) => {
      await tx.order.update({ where: { id: order.id }, data: { status: "REFUNDED" } });
      // A VAGA DE QUEM ESTÁ DENTRO NÃO VOLTA (agravante do bloqueio nº 3): o
      // ingresso da porta nasce CHECKED_IN. Devolver essa vaga ao balcão
      // revenderia o lugar de alguém que já entrou — capacidade estourada.
      // Só ingresso não usado é cancelado e só ele devolve estoque.
      const naoUsados = await tx.ticket.findMany({
        where: { orderId: order.id, status: { in: ["ISSUED", "ACTIVE"] } },
        select: { id: true, ticketLotId: true },
      });
      ticketsCanceled = naoUsados.length;
      ticketsInside = await tx.ticket.count({ where: { orderId: order.id, status: "CHECKED_IN" } });
      if (naoUsados.length > 0) {
        await tx.ticket.updateMany({
          where: { id: { in: naoUsados.map((t) => t.id) } },
          data: { status: "CANCELED", canceledAt: new Date() },
        });
        const porLote = new Map<string, number>();
        for (const t of naoUsados) porLote.set(t.ticketLotId, (porLote.get(t.ticketLotId) ?? 0) + 1);
        for (const [lotId, qtd] of porLote) await returnSaleInventory(tx, lotId, qtd);
      }
    });
    feeBackCents = await estornarTaxaDaPlataforma(order.id, "Estorno da taxa — venda de porta desfeita");
  }

  await prisma.auditLog.create({
    data: {
      actorUserId,
      organizationId: order.event.organizationId,
      action: "order.producer_refund",
      entityType: "order",
      entityId: order.id,
      metadata: {
        amountCents: input.amountCents,
        reason: input.reason,
        refundedCents,
        feeBackCents,
        ticketsCanceled,
        ticketsInside,
      },
    },
  });

  return { organizationId: order.event.organizationId, refundedCents };
}

/**
 * Zera o que o CANCELAMENTO custou ao produtor em taxa de plataforma.
 *
 * Sem isto o produtor PAGA pela festa que não aconteceu: a venda credita o
 * bruto e debita a taxa, e há caminhos em que o estorno debita o bruto INTEIRO
 * de volta — sobrando um débito do tamanho exato da taxa. Decisão do Arthur em
 * 2026-08-29: evento cancelado não é culpa do comprador nem do produtor, então
 * a plataforma devolve a parte dela.
 *
 * O QUE ESTA FUNÇÃO OLHA É O SALDO DO PEDIDO, não uma proporção — e a razão é
 * que os três caminhos de estorno debitam valores diferentes (revisão
 * adversarial 2026-08-29, que pegou a primeira versão devolvendo em dobro):
 *
 *   - reembolso TOTAL online  → `reverseOrganizationLedgerAndStock` já grava o
 *     LÍQUIDO (−crédito −taxa), então a taxa JÁ voltou e não há nada a fazer;
 *   - reembolso PARCIAL online → grava o BRUTO, a taxa fica retida;
 *   - PDV (dinheiro)          → grava o BRUTO, idem.
 *
 * Uma conta proporcional não distingue os três e credita em cima do primeiro.
 * O saldo distingue sozinho: se depois de devolver tudo o pedido ficou
 * negativo, aquele buraco é a taxa presa — e é exatamente ele que se preenche.
 * O teto pela taxa cobrada impede que um buraco de outra origem (comissão de
 * promoter não recuperada, por exemplo) seja pago com dinheiro da plataforma.
 *
 * Idempotente por construção: na segunda passada o saldo já é zero.
 */
export async function estornarTaxaDaPlataforma(
  orderId: string,
  descricao = "Estorno da taxa — evento cancelado",
): Promise<number> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      totalCents: true,
      event: { select: { organizationId: true } },
      payments: { select: { id: true } },
    },
  });
  if (!order || order.totalCents <= 0) return 0;

  // ONDE a venda foi lançada depende de como foi paga: online, o crédito e a
  // taxa apontam para o PAGAMENTO; no PDV (dinheiro), para o PEDIDO. Olhar só
  // um dos dois faria a taxa da venda online nunca voltar.
  const idsDePagamento = order.payments.map((p) => p.id);
  const ondeEstaODinheiro = [
    { referenceType: "order", referenceId: { in: [order.id] } },
    ...(idsDePagamento.length > 0
      ? [{ referenceType: "payment", referenceId: { in: idsDePagamento } }]
      : []),
  ];

  const lancamentos = await prisma.ledgerEntry.findMany({
    where: { OR: ondeEstaODinheiro },
    select: { amountCents: true, type: true, referenceType: true, referenceId: true },
  });

  // saque e antecipação apontam para `payout` e não entram aqui por construção
  const saldoDoPedido = lancamentos.reduce((soma, l) => soma + l.amountCents, 0);
  if (saldoDoPedido >= 0) return 0; // nada preso: ou já voltou, ou nunca saiu

  const taxas = lancamentos.filter((l) => l.type === "PLATFORM_FEE");
  const cobradas = taxas.filter((t) => t.amountCents < 0);
  const taxaCobrada = cobradas.reduce((soma, t) => soma + Math.abs(t.amountCents), 0);
  const taxaJaEstornada = taxas
    .filter((t) => t.amountCents > 0)
    .reduce((soma, t) => soma + t.amountCents, 0);

  const aDevolver = Math.min(-saldoDoPedido, taxaCobrada - taxaJaEstornada);
  if (aDevolver <= 0) return 0;

  const ledgerAccount = await prisma.ledgerAccount.upsert({
    where: { organizationId: order.event.organizationId },
    update: {},
    create: { organizationId: order.event.organizationId },
  });
  // no MESMO endereço da taxa original, para o extrato juntar o estorno da
  // taxa com o estorno da venda numa linha só — o produtor lê "−R$ 50", o
  // líquido que de fato saiu dele, e a taxa segue invisível
  const destino = cobradas[0];
  await prisma.ledgerEntry.create({
    data: {
      ledgerAccountId: ledgerAccount.id,
      type: "PLATFORM_FEE",
      amountCents: aDevolver,
      referenceType: destino.referenceType,
      referenceId: destino.referenceId,
      description: descricao,
    },
  });
  return aDevolver;
}
