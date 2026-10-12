import {
  confirmSaleInventory,
  returnSaleInventory,
  prisma,
  Prisma,
  type PaymentMethod as DbPaymentMethod,
  type PaymentStatus as DbPaymentStatus,
} from "@borafest/database";
import type { GatewayPaymentStatus, PaymentGateway } from "./types";
import { computePlatformFeeCents } from "./fees";
import { getGateway } from "./registry";

/**
 * Aplica um status vindo do gateway (webhook, cartão síncrono ou reconciliação)
 * ao pagamento e ao pedido, de forma idempotente e tolerante a eventos fora de
 * ordem:
 *
 * - transições usam `updateMany` com guarda de status — quem chegar primeiro
 *   vence; repetição e regressão viram no-op;
 * - PAID: pedido → PAID + estoque reservado vira vendido + outbox `order.paid`
 *   (emissão de ingressos exatamente-uma-vez no worker);
 * - PAID com valor pago MENOR que o cobrado (2026-10-12): nada é faturado — o
 *   pedido fica pendente e sai auditoria + outbox `payment.amount_mismatch`
 *   para o backoffice;
 * - PAID com pedido já expirado/cancelado: outbox `payment.orphaned`
 *   (estorno automático no worker) — caso "pagamento aprovado depois da
 *   reserva expirar" da arquitetura §22;
 * - REFUNDED/CHARGEBACK: pedido acompanha e outbox `order.payment_reversed`
 *   revoga os ingressos;
 * - CHARGEBACK_REVERSED (disputa ganha, 2026-10-12): o crédito do produtor
 *   volta ao ledger; ingresso cancelado NÃO é reemitido — auditoria + outbox
 *   `payment.chargeback_reversed` para o backoffice decidir.
 */

export interface ApplyStatusResult {
  paymentChanged: boolean;
  orderPaid: boolean;
  orphaned: boolean;
  /** o gateway informou valor pago MENOR que o cobrado — nada foi faturado */
  amountMismatch?: boolean;
  /** disputa de chargeback ganha — crédito do produtor restaurado */
  chargebackReversed?: boolean;
}

const PAYABLE_ORDER_STATUSES = ["CREATED", "PAYMENT_PENDING"] as const;
const OPEN_PAYMENT_STATUSES: DbPaymentStatus[] = ["PENDING", "AUTHORIZED"];
/**
 * De onde o PAID pode entrar: o dinheiro se moveu no gateway, então vence
 * qualquer estado local NÃO monetário (webhook atrasado, §22). Estados
 * monetários (PAID, REFUND_PENDING, REFUNDED, CHARGEBACK) nunca regridem por aqui.
 */
const PAID_TRANSITION_FROM: DbPaymentStatus[] = [
  ...OPEN_PAYMENT_STATUSES,
  "EXPIRED",
  "FAILED",
  "CANCELED",
];

/**
 * Descrições que marcam os lançamentos do ledger feitos por um chargeback e os
 * que os desfazem quando a disputa é ganha (2026-10-12). É por elas que a
 * restauração acha EXATAMENTE o que o chargeback tirou — sem confundir com
 * estornos parciais anteriores, que são devoluções de verdade ao comprador.
 */
export const DESCRICAO_CHARGEBACK = "Chargeback (contestação no cartão)";
export const DESCRICAO_CHARGEBACK_REVERTIDO = "Chargeback revertido (disputa ganha)";

export interface ApplyStatusOptions {
  /**
   * Valor estornado quando conhecido (fluxo admin). Menor que o valor do
   * pagamento → estorno PARCIAL: só debita o ledger e marca o pedido como
   * PARTIALLY_REFUNDED — ingressos e estoque ficam intactos. Ausente ou
   * igual ao total → estorno total (comportamento de sempre).
   */
  refundAmountCents?: number;
  /**
   * Valor REALMENTE pago segundo o gateway, em centavos (2026-10-12) — só vale
   * para PAID. Menor que o valor do pagamento → não fatura (ver applyPaid).
   * - número: o chamador já tem o valor (corpo do webhook, resposta do cartão);
   * - null: o chamador consultou e o gateway não informa — segue sem conferir;
   * - ausente: applyGatewayStatus consulta o gateway (getPaymentSnapshot).
   */
  paidAmountCents?: number | null;
}

export async function applyGatewayStatus(
  paymentId: string,
  status: GatewayPaymentStatus,
  occurredAt?: Date,
  options?: ApplyStatusOptions,
): Promise<ApplyStatusResult> {
  const result: ApplyStatusResult = { paymentChanged: false, orderPaid: false, orphaned: false };

  switch (status) {
    case "PENDING":
      return result;

    case "AUTHORIZED": {
      const updated = await prisma.payment.updateMany({
        where: { id: paymentId, status: "PENDING" },
        data: { status: "AUTHORIZED" },
      });
      result.paymentChanged = updated.count > 0;
      return result;
    }

    case "PAID": {
      const paidAmountCents = await resolvePaidAmountCents(paymentId, options?.paidAmountCents);
      return applyPaid(paymentId, occurredAt, paidAmountCents);
    }

    case "FAILED":
    case "CANCELED":
    case "EXPIRED": {
      const updated = await prisma.payment.updateMany({
        where: { id: paymentId, status: { in: OPEN_PAYMENT_STATUSES } },
        data: { status },
      });
      result.paymentChanged = updated.count > 0;
      return result;
    }

    case "REFUNDED": {
      if (options?.refundAmountCents !== undefined) {
        const payment = await prisma.payment.findUnique({ where: { id: paymentId } });
        // o prêmio da proteção não faz parte do ingresso (auditoria 2026-08-30):
        // reembolsar o INGRESSO INTEIRO (paga − prêmio) é reversão TOTAL — reverte
        // crédito + taxa (líquido zero) e mantém o PROTECTION_CREDIT como lucro.
        // Sem isto, o full-ticket caía no parcial e a taxa ficava pendurada.
        const pedido = payment
          ? await prisma.order.findUnique({
              where: { id: payment.orderId },
              select: { protectionFeeCents: true },
            })
          : null;
        const ingressoCents = (payment?.amountCents ?? 0) - (pedido?.protectionFeeCents ?? 0);
        if (payment && options.refundAmountCents < ingressoCents) {
          return applyPartialRefund(paymentId, options.refundAmountCents);
        }
      }
      return applyReversal(paymentId, "REFUNDED", options?.refundAmountCents);
    }
    case "CHARGEBACK":
      return applyReversal(paymentId, status);

    case "CHARGEBACK_REVERSED":
      return applyChargebackReversal(paymentId);

    default:
      return result;
  }
}

/**
 * Valor pago a conferir no PAID (2026-10-12). Quando o chamador não informou,
 * consulta o gateway do pagamento — assim a conferência vale em TODA entrada
 * (webhook, cartão síncrono, sync da tela do Pix, reconciliação) mesmo antes de
 * cada chamador repassar o valor que já tem em mãos.
 *
 * Só consulta se o PAID ainda vai mudar alguma coisa (duplicata não custa
 * chamada). Falha na consulta NÃO trava a venda: segue sem conferência e
 * registra no log — o risco aqui é cobrança alterada/rateada a menos, não um
 * atacante controlando a disponibilidade do gateway.
 */
async function resolvePaidAmountCents(
  paymentId: string,
  informado: number | null | undefined,
): Promise<number | undefined> {
  if (informado === null) return undefined;
  if (informado !== undefined) return informado;

  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
    select: { provider: true, externalId: true, status: true },
  });
  if (!payment?.externalId || !PAID_TRANSITION_FROM.includes(payment.status)) return undefined;
  return lookupGatewayPaidAmountCents(payment.provider, payment.externalId, paymentId);
}

/**
 * Pergunta ao gateway quanto foi pago (getPaymentSnapshot). undefined quando o
 * provedor não tem adapter/consulta, a cobrança não está paga ou a consulta
 * falhou (logado). Compartilhado com o fluxo VIP (2026-10-12).
 */
export async function lookupGatewayPaidAmountCents(
  provider: string,
  externalId: string,
  referencia: string,
): Promise<number | undefined> {
  let gateway: PaymentGateway;
  try {
    gateway = getGateway(provider);
  } catch {
    return undefined; // provedor sem adapter (ex.: venda manual) — nada a conferir
  }
  if (!gateway.getPaymentSnapshot) return undefined;

  try {
    const snapshot = await gateway.getPaymentSnapshot(externalId);
    return snapshot.status === "PAID" ? snapshot.paidAmountCents : undefined;
  } catch (error) {
    console.warn(
      `[payments] conferência de valor indisponível para o pagamento ${referencia} (${provider}): ${(error as Error).message}`,
    );
    return undefined;
  }
}

async function applyPaid(
  paymentId: string,
  occurredAt?: Date,
  /** valor pago segundo o gateway; undefined = o gateway não informa (sem conferência) */
  paidAmountCents?: number,
): Promise<ApplyStatusResult> {
  return prisma.$transaction(async (tx) => {
    const result: ApplyStatusResult = { paymentChanged: false, orderPaid: false, orphaned: false };

    const paidAt = occurredAt ?? new Date();
    const payment = await tx.payment.findUnique({ where: { id: paymentId } });
    if (!payment) return result;

    // CONFERÊNCIA DE VALOR (2026-10-12; era o follow-up da auditoria
    // 2026-08-30): compara o valor REAL que o gateway diz ter recebido com o
    // valor cobrado — não amountCents vs totalCents, que nascem iguais. Entrou
    // menos (cobrança editada no painel do PSP, pagamento a menor, arredonda-
    // mento) → NÃO fatura: pagamento e pedido ficam como estão (o pedido segue
    // pendente e expira na janela normal) e o backoffice recebe o alerta para
    // decidir entre cobrar a diferença ou devolver o que entrou.
    if (
      paidAmountCents !== undefined &&
      Number.isFinite(paidAmountCents) &&
      paidAmountCents < payment.amountCents
    ) {
      // estado monetário (PAID/REFUND_*/CHARGEBACK) é no-op, como sempre
      if (!PAID_TRANSITION_FROM.includes(payment.status)) return result;
      result.amountMismatch = true;
      await registerAmountMismatch(tx, payment, paidAmountCents);
      return result;
    }

    // O dinheiro se moveu no gateway: PAID vence qualquer estado local
    // não-monetário — inclusive EXPIRED/FAILED/CANCELED (webhook atrasado,
    // §22 "pagamento aprovado depois da reserva expirar"). Só não regride
    // estados monetários (PAID/REFUND_*/CHARGEBACK).
    const updatedPayment = await tx.payment.updateMany({
      where: {
        id: paymentId,
        status: { in: PAID_TRANSITION_FROM },
      },
      data: { status: "PAID", paidAt },
    });
    result.paymentChanged = updatedPayment.count > 0;
    if (!result.paymentChanged) {
      // já estava PAID (webhook duplicado) ou em estado monetário — no-op
      return result;
    }

    const updatedOrder = await tx.order.updateMany({
      where: { id: payment.orderId, status: { in: [...PAYABLE_ORDER_STATUSES] } },
      data: { status: "PAID", paidAt },
    });

    if (updatedOrder.count === 0) {
      // pedido expirou/cancelou (ou já foi pago por outro pagamento):
      // não há como honrar — estorno automático via worker
      result.orphaned = true;
      await tx.outboxEvent.create({
        data: {
          aggregateType: "payment",
          aggregateId: paymentId,
          eventType: "payment.orphaned",
          payload: { paymentId, orderId: payment.orderId },
        },
      });
      return result;
    }

    const items = await tx.orderItem.findMany({ where: { orderId: payment.orderId } });
    for (const item of items) {
      await confirmSaleInventory(tx, item.ticketLotId, item.quantity);
    }

    await creditOrganizationLedger(tx, payment);
    await splitPromoterCommission(tx, payment);

    await tx.outboxEvent.create({
      data: {
        aggregateType: "order",
        aggregateId: payment.orderId,
        eventType: "order.paid",
        payload: { orderId: payment.orderId, paymentId },
      },
    });

    result.orderPaid = true;
    return result;
  });
}

function asJsonObject(value: Prisma.JsonValue | null | undefined): Prisma.JsonObject {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Prisma.JsonObject)
    : {};
}

/**
 * Registra "pagou menos que o cobrado" (2026-10-12): marca no metadata do
 * pagamento, audita no pedido (aparece na Auditoria do backoffice) e solta o
 * outbox `payment.amount_mismatch`. Idempotente sob a trava da linha: webhook,
 * reconciliação e sync da tela repetindo o MESMO valor não duplicam o alerta.
 */
async function registerAmountMismatch(
  tx: Prisma.TransactionClient,
  payment: { id: string; orderId: string; provider: string; externalId: string | null; amountCents: number },
  paidAmountCents: number,
): Promise<void> {
  await tx.$queryRaw`SELECT id FROM payments WHERE id = ${payment.id}::uuid FOR UPDATE`;
  const atual = await tx.payment.findUnique({
    where: { id: payment.id },
    select: { metadata: true },
  });
  const metadata = asJsonObject(atual?.metadata);
  const anterior = asJsonObject(metadata.amountMismatch);
  if (anterior.paidCents === paidAmountCents) return; // já alertado com este valor

  const detectedAt = new Date().toISOString();
  const diferencaCents = payment.amountCents - paidAmountCents;
  await tx.payment.update({
    where: { id: payment.id },
    data: {
      metadata: {
        ...metadata,
        amountMismatch: {
          expectedCents: payment.amountCents,
          paidCents: paidAmountCents,
          detectedAt,
        },
      } as Prisma.InputJsonObject,
    },
  });

  const order = await tx.order.findUnique({
    where: { id: payment.orderId },
    select: { event: { select: { organizationId: true } } },
  });
  await tx.auditLog.create({
    data: {
      action: "payment.amount_mismatch",
      entityType: "order",
      entityId: payment.orderId,
      organizationId: order?.event.organizationId ?? null,
      metadata: {
        paymentId: payment.id,
        provider: payment.provider,
        externalId: payment.externalId,
        expectedCents: payment.amountCents,
        paidCents: paidAmountCents,
        diferencaCents,
        resumo:
          "O gateway informou um valor pago menor que o cobrado. O pedido NÃO foi confirmado: cobre a diferença ou devolva o valor recebido.",
      },
    },
  });
  await tx.outboxEvent.create({
    data: {
      aggregateType: "payment",
      aggregateId: payment.id,
      eventType: "payment.amount_mismatch",
      payload: {
        paymentId: payment.id,
        orderId: payment.orderId,
        expectedCents: payment.amountCents,
        paidCents: paidAmountCents,
      },
    },
  });
  console.warn(
    `[payments] valor pago menor que o cobrado — pedido ${payment.orderId} NÃO confirmado (pagamento ${payment.id}: cobrado ${payment.amountCents}, pago ${paidAmountCents} centavos)`,
  );
}

/** SALE_CREDIT (bruto) + PLATFORM_FEE (comissão) no ledger da organização do evento. */
async function creditOrganizationLedger(
  tx: Prisma.TransactionClient,
  payment: { id: string; orderId: string; amountCents: number; method: DbPaymentMethod },
): Promise<void> {
  const order = await tx.order.findUnique({
    where: { id: payment.orderId },
    select: { protectionFeeCents: true, event: { select: { organizationId: true, endsAt: true } } },
  });
  if (!order) return;

  const organizationId = order.event.organizationId;
  const organization = await tx.organization.findUniqueOrThrow({ where: { id: organizationId } });

  const ledgerAccount = await tx.ledgerAccount.upsert({
    where: { organizationId },
    update: {},
    create: { organizationId },
  });

  // comissão = a taxa de serviço efetivamente definida nos itens do pedido
  // (decisão 2026-08-01): o que o comprador viu é o que o caixa lança — nos
  // dois meios de pagamento. computePlatformFeeCents segue sendo a fonte do
  // VALOR, mas na criação do lote (catalog), não aqui.
  const items = await tx.orderItem.findMany({
    where: { orderId: payment.orderId },
    select: { quantity: true, feeCents: true },
  });
  const feeCents = items.reduce((sum, item) => sum + item.feeCents * item.quantity, 0);

  // Molde de saque v2 (decisão 2026-08-09, padrão de mercado): o crédito da
  // venda LIBERA D+N úteis DEPOIS DO EVENTO — o maior risco de ticketeria é
  // o evento não acontecer, e aí todo mundo tem reembolso. INSTANT (casas de
  // confiança) continua sacando antes, pagando antecipação sobre o que ainda
  // não liberou; a data em si é fato imutável do lançamento.
  const availableAt = addBusinessDays(
    order.event.endsAt,
    Number(process.env.RELEASE_BUSINESS_DAYS_AFTER_EVENT ?? 2),
  );

  // PROTEÇÃO DE REEMBOLSO (upsell 2026-08-30): o prêmio NÃO entra no SALE_CREDIT
  // do ingresso — vira um crédito PROTECTION_CREDIT separado, que o produtor
  // embolsa e que NUNCA é reembolsado. Assim, quando o comprador pede o
  // reembolso protegido, revertemos só o ingresso (crédito + taxa, líquido
  // zero) e o prêmio fica como lucro. Sem isto, um reembolso parcial deixaria a
  // taxa da plataforma pendurada e o produtor no negativo.
  const protectionFeeCents = order.protectionFeeCents ?? 0;
  const ingressoCents = payment.amountCents - protectionFeeCents;

  const linhas: Prisma.LedgerEntryCreateManyInput[] = [
    {
      ledgerAccountId: ledgerAccount.id,
      type: "SALE_CREDIT",
      amountCents: ingressoCents,
      referenceType: "payment",
      referenceId: payment.id,
      availableAt,
    },
    {
      ledgerAccountId: ledgerAccount.id,
      type: "PLATFORM_FEE",
      amountCents: -feeCents,
      referenceType: "payment",
      referenceId: payment.id,
      // MESMA data do crédito (correção 2026-08-19): a taxa nascia madura
      // enquanto o crédito esperava o evento — o painel mostrava o BRUTO
      // "a liberar" e a taxa comia saldo maduro de outros eventos.
      availableAt,
    },
  ];
  if (protectionFeeCents > 0) {
    linhas.push({
      ledgerAccountId: ledgerAccount.id,
      type: "PROTECTION_CREDIT",
      amountCents: protectionFeeCents,
      referenceType: "payment",
      referenceId: payment.id,
      availableAt,
    });
  }

  await tx.ledgerEntry.createMany({ data: linhas });
}

/**
 * Estorno PARCIAL: debita só o valor devolvido no ledger da organização e
 * marca o pedido como PARTIALLY_REFUNDED. Ingressos continuam válidos e o
 * estoque vendido não volta — a comissão da plataforma não é ajustada
 * (decisão registrada: taxa é sobre a transação original).
 */
async function applyPartialRefund(
  paymentId: string,
  amountCents: number,
): Promise<ApplyStatusResult> {
  return prisma.$transaction(async (tx) => {
    const result: ApplyStatusResult = { paymentChanged: false, orderPaid: false, orphaned: false };

    const payment = await tx.payment.findUnique({ where: { id: paymentId } });
    if (!payment) return result;

    // o dinheiro parcial voltou; o pagamento permanece PAID (não é terminal)
    const normalized = await tx.payment.updateMany({
      where: { id: paymentId, status: { in: ["PAID", "REFUND_PENDING"] } },
      data: { status: "PAID" },
    });
    result.paymentChanged = normalized.count > 0;
    if (!result.paymentChanged) return result;

    await tx.order.updateMany({
      where: {
        id: payment.orderId,
        status: { in: ["PAID", "FULFILLED", "PARTIALLY_REFUNDED"] },
      },
      data: { status: "PARTIALLY_REFUNDED" },
    });

    const order = await tx.order.findUnique({
      where: { id: payment.orderId },
      select: { protectionFeeCents: true, event: { select: { organizationId: true } } },
    });
    if (order) {
      const ledgerAccount = await tx.ledgerAccount.upsert({
        where: { organizationId: order.event.organizationId },
        update: {},
        create: { organizationId: order.event.organizationId },
      });
      await tx.ledgerEntry.create({
        data: {
          ledgerAccountId: ledgerAccount.id,
          type: "REFUND_DEBIT",
          amountCents: -amountCents,
          referenceType: "payment",
          referenceId: payment.id,
        },
      });

      // Auditoria 2026-08-10: dois estornos parciais somando o total deixavam
      // os ingressos VÁLIDOS e a comissão do promoter no bolso dele. Quando o
      // acumulado alcança o valor pago, o pedido vira reembolso TOTAL de fato.
      const debitos = await tx.ledgerEntry.aggregate({
        where: { referenceType: "payment", referenceId: payment.id, type: "REFUND_DEBIT" },
        _sum: { amountCents: true },
      });
      const devolvido = Math.abs(debitos._sum.amountCents ?? 0);
      // o "cheio" do ingresso desconta o prêmio da proteção (auditoria
      // 2026-08-30): senão parciais que somam o ingresso inteiro num pedido
      // protegido nunca revogavam os tickets nem fechavam o pedido
      const limiteIngresso = payment.amountCents - (order.protectionFeeCents ?? 0);

      // A comissão volta na MESMA proporção do que foi devolvido ao comprador.
      // Antes só voltava no estorno de 100% — num reembolso grande a casa
      // devolvia o bruto e continuava pagando a comissão inteira, ficando
      // negativa (revisão adversarial 2026-08-11).
      await clawbackPromoterCommission(tx, payment, Math.min(1, devolvido / Math.max(1, limiteIngresso)));

      if (devolvido >= limiteIngresso) {
        // ingresso 100% devolvido via PARCIAIS: estorna a TAXA da plataforma
        // (auditoria 2026-08-30) — o applyPartialRefund só debita o valor do
        // ingresso, sem reverter a taxa; sem isto o produtor termina devendo a
        // taxa (líquido negativo). Idempotente: só reverte enquanto houver taxa
        // cobrada em aberto. Vale para pedido protegido E comum.
        const taxa = await tx.ledgerEntry.aggregate({
          where: { referenceType: "payment", referenceId: payment.id, type: "PLATFORM_FEE" },
          _sum: { amountCents: true },
        });
        const taxaSaldo = taxa._sum.amountCents ?? 0; // negativo = cobrada
        if (taxaSaldo < 0) {
          await tx.ledgerEntry.create({
            data: {
              ledgerAccountId: ledgerAccount.id,
              type: "PLATFORM_FEE",
              amountCents: -taxaSaldo,
              referenceType: "payment",
              referenceId: payment.id,
              description: "Estorno da taxa — ingresso 100% reembolsado em parciais",
            },
          });
        }
        await tx.order.updateMany({
          where: { id: payment.orderId },
          data: { status: "REFUNDED" },
        });
        await tx.ticket.updateMany({
          where: { orderId: payment.orderId, status: { in: ["ISSUED", "ACTIVE"] } },
          data: { status: "REFUNDED", canceledAt: new Date() },
        });
        // o ingresso foi 100% devolvido: o PAGAMENTO também é terminal
        // (auditoria 2026-08-30) — sem isto ele ficava PAID e um segundo estorno
        // ainda via saldo "reembolsável" (o prêmio), podendo devolver o prêmio.
        await tx.payment.updateMany({
          where: { id: payment.id, status: { in: ["PAID", "REFUND_PENDING"] } },
          data: { status: "REFUNDED" },
        });
      }
    }

    return result;
  });
}

/** Reverte SALE_CREDIT + PLATFORM_FEE (líquido zero) e devolve o estoque vendido. */
async function reverseOrganizationLedgerAndStock(
  tx: Prisma.TransactionClient,
  payment: { id: string; orderId: string; amountCents: number },
  /** quanto foi devolvido ao comprador no gateway; undefined = reembolso TOTAL */
  refundAmountCents?: number,
  opcoes: {
    /** reversão por CHARGEBACK: lançamentos marcados com DESCRICAO_CHARGEBACK (2026-10-12) */
    chargeback?: boolean;
    /** false = não mexe no estoque (ele já voltou num chargeback anterior) */
    devolverEstoque?: boolean;
  } = {},
): Promise<void> {
  // marca os lançamentos do chargeback para a disputa ganha achá-los (2026-10-12)
  const descricaoChargeback = opcoes.chargeback ? DESCRICAO_CHARGEBACK : undefined;
  const order = await tx.order.findUnique({
    where: { id: payment.orderId },
    select: { protectionFeeCents: true, event: { select: { organizationId: true, endsAt: true } } },
  });
  if (!order) return;

  const ledgerAccount = await tx.ledgerAccount.findUnique({
    where: { organizationId: order.event.organizationId },
  });

  if (ledgerAccount) {
    const [previousCredit, previousFee, partialDebits] = await Promise.all([
      tx.ledgerEntry.findFirst({
        where: { referenceType: "payment", referenceId: payment.id, type: "SALE_CREDIT" },
      }),
      tx.ledgerEntry.findFirst({
        where: { referenceType: "payment", referenceId: payment.id, type: "PLATFORM_FEE" },
      }),
      // estornos parciais anteriores deste pagamento já debitados
      tx.ledgerEntry.aggregate({
        where: { referenceType: "payment", referenceId: payment.id, type: "REFUND_DEBIT" },
        _sum: { amountCents: true },
      }),
    ]);

    const alreadyDebited = partialDebits._sum.amountCents ?? 0; // negativo
    const remaining =
      -(previousCredit?.amountCents ?? payment.amountCents) -
      (previousFee?.amountCents ?? 0) -
      alreadyDebited;

    if (remaining !== 0) {
      await tx.ledgerEntry.create({
        data: {
          ledgerAccountId: ledgerAccount.id,
          type: "REFUND_DEBIT",
          amountCents: remaining,
          referenceType: "payment",
          referenceId: payment.id,
          ...(descricaoChargeback ? { description: descricaoChargeback } : {}),
        },
      });
    }

    // PRÊMIO DA PROTEÇÃO (auditoria 2026-08-30): o prêmio é lucro do produtor
    // e o PROTECTION_CREDIT fica no ledger. MAS quando o comprador recebe o
    // prêmio de volta — reembolso INTEGRAL do produtor, cancelamento de evento
    // ou chargeback (o banco reverte tudo) — o crédito precisa ser revertido,
    // senão vira crédito FANTASMA (a plataforma pagaria o prêmio duas vezes).
    // No self-service o comprador recebe só o INGRESSO (premio fica), então o
    // crédito NÃO é revertido. O sinal é o valor devolvido: > ingresso => o
    // prêmio voltou. É idempotente pelo saldo atual do PROTECTION_CREDIT.
    const premio = order.protectionFeeCents ?? 0;
    if (premio > 0) {
      const ingressoCents = payment.amountCents - premio;
      // quanto do PRÊMIO de fato voltou ao comprador (auditoria 2026-08-30):
      //  - reversão total (undefined) / cancelamento / chargeback: o prêmio todo
      //  - reembolso explícito ACIMA do ingresso: só a parte acima do ingresso
      //    (antes revertia os 150 inteiros e realocava o resíduo pra plataforma)
      //  - reembolso <= ingresso (self-service): nada — o prêmio é lucro do produtor
      const premioQueVoltou =
        refundAmountCents === undefined
          ? premio
          : Math.max(0, refundAmountCents - ingressoCents);
      if (premioQueVoltou > 0) {
        const atual = await tx.ledgerEntry.aggregate({
          where: { referenceType: "payment", referenceId: payment.id, type: "PROTECTION_CREDIT" },
          _sum: { amountCents: true },
        });
        const saldoPremio = atual._sum.amountCents ?? 0;
        // idempotente e proporcional: nunca reverte mais do que voltou nem do
        // que ainda resta de prêmio no ledger
        const jaRevertido = premio - saldoPremio;
        const aReverter = Math.min(saldoPremio, Math.max(0, premioQueVoltou - jaRevertido));
        if (aReverter > 0) {
          await tx.ledgerEntry.create({
            data: {
              ledgerAccountId: ledgerAccount.id,
              type: "PROTECTION_CREDIT",
              amountCents: -aReverter,
              referenceType: "payment",
              referenceId: payment.id,
              description:
                descricaoChargeback ??
                "Estorno do prêmio da proteção — parte devolvida ao comprador",
            },
          });
        }
      }
    }
  }

  // comissão de promoter volta junto (idempotente)
  await clawbackPromoterCommission(tx, payment, 1, descricaoChargeback);

  if (opcoes.devolverEstoque === false) return;
  const items = await tx.orderItem.findMany({ where: { orderId: payment.orderId } });
  for (const item of items) {
    await returnSaleInventory(tx, item.ticketLotId, item.quantity);
  }
}

/**
 * Reverte qualquer saldo de PROTECTION_CREDIT ainda pendurado num pagamento —
 * usado quando um CHARGEBACK chega sobre um pagamento JÁ reembolsado (o fluxo
 * normal de reversão não roda porque pagamento/pedido já são terminais, então o
 * prêmio ficaria como crédito FANTASMA). Idempotente pelo saldo do prêmio.
 */
async function reverseProtectionPremiumOnly(
  tx: Prisma.TransactionClient,
  payment: { id: string; orderId: string },
): Promise<void> {
  const order = await tx.order.findUnique({
    where: { id: payment.orderId },
    select: { protectionFeeCents: true, event: { select: { organizationId: true } } },
  });
  if (!order || (order.protectionFeeCents ?? 0) <= 0) return;
  const ledgerAccount = await tx.ledgerAccount.findUnique({
    where: { organizationId: order.event.organizationId },
  });
  if (!ledgerAccount) return;
  const atual = await tx.ledgerEntry.aggregate({
    where: { referenceType: "payment", referenceId: payment.id, type: "PROTECTION_CREDIT" },
    _sum: { amountCents: true },
  });
  const saldoPremio = atual._sum.amountCents ?? 0;
  if (saldoPremio > 0) {
    await tx.ledgerEntry.create({
      data: {
        ledgerAccountId: ledgerAccount.id,
        type: "PROTECTION_CREDIT",
        amountCents: -saldoPremio,
        referenceType: "payment",
        referenceId: payment.id,
        // era "Estorno do prêmio da proteção — chargeback após reembolso": agora
        // com a marca do chargeback, para a disputa ganha devolver o prêmio (2026-10-12)
        description: DESCRICAO_CHARGEBACK,
      },
    });
  }
}

async function applyReversal(
  paymentId: string,
  status: Extract<GatewayPaymentStatus, "REFUNDED" | "CHARGEBACK">,
  /** valor devolvido no gateway; undefined = total (inclui o prêmio) */
  refundAmountCents?: number,
): Promise<ApplyStatusResult> {
  return prisma.$transaction(async (tx) => {
    const result: ApplyStatusResult = { paymentChanged: false, orderPaid: false, orphaned: false };

    const payment = await tx.payment.findUnique({ where: { id: paymentId } });
    if (!payment) return result;

    const updatedPayment = await tx.payment.updateMany({
      where: { id: paymentId, status: { in: ["PAID", "REFUND_PENDING"] } },
      data: { status },
    });
    result.paymentChanged = updatedPayment.count > 0;
    if (!result.paymentChanged) {
      // CHARGEBACK sobre pagamento JÁ terminal (comprador usou o self-service e
      // DEPOIS abriu chargeback): o banco reverte tudo, inclusive o prêmio, mas o
      // fluxo abaixo não roda. Reverte o prêmio à parte, idempotente pelo saldo.
      if (status === "CHARGEBACK") {
        await reverseProtectionPremiumOnly(tx, payment);
      }
      return result;
    }

    const updatedOrder = await tx.order.updateMany({
      where: {
        id: payment.orderId,
        // PARTIALLY_REFUNDED entra: estorno total depois de parciais completa a reversão
        status: { in: ["PAID", "FULFILLED", "REFUND_PENDING", "PARTIALLY_REFUNDED"] },
      },
      data: { status: status === "CHARGEBACK" ? "CHARGEBACK" : "REFUNDED" },
    });

    if (updatedOrder.count > 0) {
      await reverseOrganizationLedgerAndStock(tx, payment, refundAmountCents, {
        chargeback: status === "CHARGEBACK",
      });

      await tx.outboxEvent.create({
        data: {
          aggregateType: "order",
          aggregateId: payment.orderId,
          eventType: "order.payment_reversed",
          payload: { orderId: payment.orderId, paymentId, status },
        },
      });
    } else if (await chargebackRestorationInForce(tx, payment.id)) {
      // DISPUTA GANHA E DINHEIRO SAINDO DE NOVO (2026-10-12): depois da disputa
      // ganha o pagamento volta a PAID, mas o pedido fica em CHARGEBACK
      // (ingressos cancelados, sem reemissão automática). Um estorno feito pelo
      // backoffice ou um novo chargeback caía aqui sem reverter nada e o
      // produtor ficava com o crédito restaurado de um dinheiro que saiu. Desfaz
      // a restauração pelo caminho normal, SEM devolver estoque (já voltou no
      // primeiro chargeback) e sem reenviar `order.payment_reversed` (os
      // ingressos já foram revogados).
      await reverseOrganizationLedgerAndStock(tx, payment, refundAmountCents, {
        chargeback: status === "CHARGEBACK",
        devolverEstoque: false,
      });
      if (status === "REFUNDED") {
        await tx.order.updateMany({
          where: { id: payment.orderId, status: "CHARGEBACK" },
          data: { status: "REFUNDED" },
        });
      }
    }

    return result;
  });
}

/** Há restauração de chargeback em vigor neste pagamento (disputa ganha antes)? */
async function chargebackRestorationInForce(
  tx: Prisma.TransactionClient,
  paymentId: string,
): Promise<boolean> {
  const restaurado = await tx.ledgerEntry.findFirst({
    where: {
      referenceType: "payment",
      referenceId: paymentId,
      description: DESCRICAO_CHARGEBACK_REVERTIDO,
    },
    select: { id: true },
  });
  return restaurado !== null;
}

/**
 * Desfaz no ledger exatamente o que os chargebacks deste pagamento tiraram
 * (2026-10-12): por conta e tipo, soma os lançamentos marcados com
 * DESCRICAO_CHARGEBACK e os que já os desfizeram, e lança a diferença com
 * DESCRICAO_CHARGEBACK_REVERTIDO. Por soma, é idempotente e aguenta ciclos
 * chargeback → disputa ganha → novo chargeback → disputa ganha.
 *
 * O availableAt é o do lançamento desfeito: o débito do chargeback valeu na
 * hora, então a devolução também vale na hora — o saldo volta a ser o de antes
 * (o crédito da venda continua liberando em D+N do evento, como sempre).
 */
async function restoreChargebackLedger(
  tx: Prisma.TransactionClient,
  paymentId: string,
): Promise<{ lancamentos: number; centavosRestaurados: number; marcados: boolean }> {
  const entradas = await tx.ledgerEntry.findMany({
    where: {
      referenceType: "payment",
      referenceId: paymentId,
      description: { in: [DESCRICAO_CHARGEBACK, DESCRICAO_CHARGEBACK_REVERTIDO] },
    },
    select: {
      ledgerAccountId: true,
      type: true,
      amountCents: true,
      description: true,
      availableAt: true,
    },
    orderBy: { createdAt: "asc" },
  });

  const grupos = new Map<
    string,
    { ledgerAccountId: string; type: Prisma.LedgerEntryCreateManyInput["type"]; soma: number; availableAt?: Date }
  >();
  for (const entrada of entradas) {
    const chave = `${entrada.ledgerAccountId}:${entrada.type}`;
    const grupo = grupos.get(chave) ?? {
      ledgerAccountId: entrada.ledgerAccountId,
      type: entrada.type,
      soma: 0,
    };
    grupo.soma += entrada.amountCents;
    if (entrada.description === DESCRICAO_CHARGEBACK) grupo.availableAt = entrada.availableAt;
    grupos.set(chave, grupo);
  }

  const novas: Prisma.LedgerEntryCreateManyInput[] = [];
  for (const grupo of grupos.values()) {
    if (grupo.soma === 0) continue;
    novas.push({
      ledgerAccountId: grupo.ledgerAccountId,
      type: grupo.type,
      amountCents: -grupo.soma,
      referenceType: "payment",
      referenceId: paymentId,
      description: DESCRICAO_CHARGEBACK_REVERTIDO,
      ...(grupo.availableAt ? { availableAt: grupo.availableAt } : {}),
    });
  }
  if (novas.length > 0) await tx.ledgerEntry.createMany({ data: novas });

  return {
    lancamentos: novas.length,
    // total devolvido aos saldos (casa + promoter; a comissão só muda de lado)
    centavosRestaurados: novas.reduce((soma, linha) => soma + linha.amountCents, 0),
    marcados: entradas.some((entrada) => entrada.description === DESCRICAO_CHARGEBACK),
  };
}

/**
 * Disputa de chargeback GANHA (2026-10-12). Antes nenhum evento desfazia o
 * chargeback: o produtor ficava sem o valor de uma venda que, no fim, foi
 * mantida pelo banco.
 *
 * - pagamento CHARGEBACK → PAID (o dinheiro voltou para a plataforma); a
 *   guarda de status torna repetição no-op;
 * - ledger: devolve o que o chargeback tirou (venda líquida, prêmio da
 *   proteção e comissão do promoter) — ver restoreChargebackLedger;
 * - pedido FICA em CHARGEBACK e os ingressos cancelados NÃO são reemitidos:
 *   reemitir é decisão do backoffice (o evento pode já ter passado, o lugar
 *   pode ter sido revendido). Auditoria + outbox `payment.chargeback_reversed`.
 *
 * Chargeback anterior a 2026-10-12 não tem os lançamentos marcados: o
 * pagamento volta a PAID, mas o saldo NÃO é mexido — a auditoria pede o ajuste
 * manual em vez de adivinhar valores.
 */
async function applyChargebackReversal(paymentId: string): Promise<ApplyStatusResult> {
  return prisma.$transaction(async (tx) => {
    const result: ApplyStatusResult = { paymentChanged: false, orderPaid: false, orphaned: false };

    const payment = await tx.payment.findUnique({ where: { id: paymentId } });
    if (!payment) return result;

    const updated = await tx.payment.updateMany({
      where: { id: paymentId, status: "CHARGEBACK" },
      data: { status: "PAID" },
    });
    result.paymentChanged = updated.count > 0;

    if (!result.paymentChanged) {
      // Chargeback sobre pagamento JÁ reembolsado (self-service e depois
      // contestação): só o prêmio da proteção tinha sido estornado
      // (reverseProtectionPremiumOnly). Ganha a disputa, o prêmio volta; o
      // pagamento segue REFUNDED. Qualquer outro estado: no-op.
      if (payment.status !== "REFUNDED") return result;
      // sem transição de status para serializar: trava a linha, senão dois
      // avisos simultâneos devolveriam o prêmio duas vezes
      await tx.$queryRaw`SELECT id FROM payments WHERE id = ${payment.id}::uuid FOR UPDATE`;
      const restauracao = await restoreChargebackLedger(tx, payment.id);
      if (restauracao.lancamentos === 0) return result;
      result.chargebackReversed = true;
      await registerChargebackReversal(tx, payment, restauracao, 0);
      return result;
    }

    result.chargebackReversed = true;
    const restauracao = await restoreChargebackLedger(tx, payment.id);
    const ingressosCancelados = await tx.ticket.count({
      where: { orderId: payment.orderId, status: { in: ["CANCELED", "REFUNDED"] } },
    });
    await registerChargebackReversal(tx, payment, restauracao, ingressosCancelados);
    return result;
  });
}

async function registerChargebackReversal(
  tx: Prisma.TransactionClient,
  payment: { id: string; orderId: string; provider: string; externalId: string | null; metadata: Prisma.JsonValue | null },
  restauracao: { lancamentos: number; centavosRestaurados: number; marcados: boolean },
  ingressosCancelados: number,
): Promise<void> {
  const ledgerRestaurado = restauracao.lancamentos > 0;
  const order = await tx.order.findUnique({
    where: { id: payment.orderId },
    select: { status: true, event: { select: { organizationId: true } } },
  });
  const reversedAt = new Date().toISOString();

  await tx.payment.update({
    where: { id: payment.id },
    data: {
      metadata: {
        ...asJsonObject(payment.metadata),
        chargebackReversal: { reversedAt, ledgerRestaurado, ingressosCancelados },
      } as Prisma.InputJsonObject,
    },
  });

  const resumo = ledgerRestaurado
    ? "Disputa de chargeback ganha: o valor voltou ao saldo do produtor. Os ingressos cancelados pelo chargeback NÃO foram reemitidos — decida se reemite ou devolve o valor ao comprador."
    : restauracao.marcados
      ? "Disputa de chargeback ganha: o saldo do produtor já estava restaurado."
      : order?.status === "CHARGEBACK"
        ? "Disputa de chargeback ganha, mas os lançamentos deste chargeback são anteriores à marcação automática (2026-10-12): ajuste o saldo do produtor manualmente."
        : "Disputa de chargeback ganha: o chargeback não tinha tirado nada do saldo do produtor (o pedido não estava faturado) — nada a restaurar.";

  await tx.auditLog.create({
    data: {
      action: "payment.chargeback_reversed",
      entityType: "order",
      entityId: payment.orderId,
      organizationId: order?.event.organizationId ?? null,
      metadata: {
        paymentId: payment.id,
        provider: payment.provider,
        externalId: payment.externalId,
        orderStatus: order?.status ?? null,
        ledgerRestaurado,
        lancamentosRestaurados: restauracao.lancamentos,
        valorRestauradoCents: restauracao.centavosRestaurados,
        ingressosCancelados,
        resumo,
      },
    },
  });
  await tx.outboxEvent.create({
    data: {
      aggregateType: "payment",
      aggregateId: payment.id,
      eventType: "payment.chargeback_reversed",
      payload: {
        paymentId: payment.id,
        orderId: payment.orderId,
        ledgerRestaurado,
        ingressosCancelados,
      },
    },
  });
  console.warn(
    `[payments] chargeback revertido (disputa ganha) — pedido ${payment.orderId}, pagamento ${payment.id}: ${resumo}`,
  );
}

/** Soma N dias ÚTEIS (sábado/domingo pulam; feriado não é considerado). */
export function addBusinessDays(from: Date, businessDays: number): Date {
  const date = new Date(from);
  let remaining = businessDays;
  while (remaining > 0) {
    date.setDate(date.getDate() + 1);
    const dow = date.getDay();
    if (dow !== 0 && dow !== 6) remaining -= 1;
  }
  return date;
}


/**
 * Carteira do promoter — UMA fonte de verdade para split e clawback.
 *
 * O promoter começa com carteira de PESSOA; quando completa o cadastro, ela
 * migra para a organização dele. Se split e clawback procurassem de formas
 * diferentes, o estorno não acharia a carteira migrada (a casa nunca
 * recuperaria a comissão) e comissões novas cairiam numa carteira órfã
 * insacável. Ordem: carteira da organização que ele é DONO → carteira
 * pessoal. (revisão adversarial 2026-08-11)
 */
async function resolvePromoterWallet(
  tx: Prisma.TransactionClient,
  promoterUserId: string,
  create: boolean,
): Promise<{ id: string } | null> {
  const membership = await tx.organizationMember.findFirst({
    where: { userId: promoterUserId, status: "ACTIVE", role: { key: "owner" } },
    select: { organizationId: true },
    orderBy: { joinedAt: "asc" },
  });
  if (membership) {
    const daOrg = await tx.ledgerAccount.findUnique({
      where: { organizationId: membership.organizationId },
    });
    if (daOrg) return daOrg;
    if (create) {
      return tx.ledgerAccount.create({ data: { organizationId: membership.organizationId } });
    }
  }
  const pessoal = await tx.ledgerAccount.findUnique({ where: { userId: promoterUserId } });
  if (pessoal) return pessoal;
  return create ? tx.ledgerAccount.create({ data: { userId: promoterUserId } }) : null;
}

/**
 * Split de comissão do promoter (Promoter v2, 2026-08-10): débito na org do
 * evento + crédito no CAIXA da org do promoter — que saca pelas regras
 * gerais. O crédito amadurece na MESMA data da venda (D+N úteis pós-evento):
 * comissão não pode ser sacável antes do dinheiro que a gerou.
 */
async function splitPromoterCommission(
  tx: Prisma.TransactionClient,
  payment: { id: string; orderId: string },
): Promise<void> {
  const order = await tx.order.findUnique({
    where: { id: payment.orderId },
    select: {
      promoterCommissionCents: true,
      promoterLink: { select: { promoterUserId: true } },
      event: { select: { organizationId: true, endsAt: true } },
    },
  });
  if (!order?.promoterLink || order.promoterCommissionCents <= 0) return;

  const hostAccount = await tx.ledgerAccount.upsert({
    where: { organizationId: order.event.organizationId },
    update: {},
    create: { organizationId: order.event.organizationId },
  });
  // carteira do promoter (pessoa ou organização dele, se já virou produtor)
  const promoterAccount = await resolvePromoterWallet(tx, order.promoterLink.promoterUserId, true);
  if (!promoterAccount) return;
  const availableAt = addBusinessDays(
    order.event.endsAt,
    Number(process.env.RELEASE_BUSINESS_DAYS_AFTER_EVENT ?? 2),
  );
  await tx.ledgerEntry.createMany({
    data: [
      {
        ledgerAccountId: hostAccount.id,
        type: "COMMISSION_DEBIT",
        amountCents: -order.promoterCommissionCents,
        referenceType: "payment",
        referenceId: payment.id,
        // matura junto com o crédito da venda (correção 2026-08-19)
        availableAt,
        description: "Comissão de promoter",
      },
      {
        ledgerAccountId: promoterAccount.id,
        type: "COMMISSION_CREDIT",
        amountCents: order.promoterCommissionCents,
        referenceType: "payment",
        referenceId: payment.id,
        availableAt,
        description: "Comissão de promoter",
      },
    ],
  });
}

/**
 * Devolve a comissão do promoter no estorno: debita a carteira dele e credita
 * a casa. `fraction` = quanto do pagamento foi devolvido (1 = total), então o
 * estorno parcial devolve a comissão pro-rata. Idempotente por acumulado.
 */
export async function clawbackPromoterCommission(
  tx: Prisma.TransactionClient,
  payment: { id: string; orderId: string },
  fraction = 1,
  /** descrição dos lançamentos (chargeback usa DESCRICAO_CHARGEBACK, 2026-10-12) */
  description = "Estorno de comissão (reembolso)",
): Promise<void> {
  const order = await tx.order.findUnique({
    where: { id: payment.orderId },
    select: {
      promoterCommissionCents: true,
      promoterLink: { select: { promoterUserId: true } },
      event: { select: { organizationId: true } },
    },
  });
  if (!order?.promoterLink || order.promoterCommissionCents <= 0) return;

  // quanto da comissão JÁ voltou (estornos parciais anteriores)
  const devolvidoAntes = await tx.ledgerEntry.aggregate({
    where: {
      referenceType: "payment",
      referenceId: payment.id,
      type: "COMMISSION_DEBIT",
      amountCents: { gt: 0 },
    },
    _sum: { amountCents: true },
  });
  // disputa de chargeback ganha DEVOLVE a comissão ao promoter (2026-10-12):
  // o que foi restaurado deixa de contar como "já devolvido" — senão um
  // estorno depois da disputa ganha nunca recuperava a comissão de novo
  const restauradoDepois = await tx.ledgerEntry.aggregate({
    where: {
      referenceType: "payment",
      referenceId: payment.id,
      type: "COMMISSION_DEBIT",
      description: DESCRICAO_CHARGEBACK_REVERTIDO,
    },
    _sum: { amountCents: true },
  });
  const jaDevolvido =
    (devolvidoAntes._sum.amountCents ?? 0) + (restauradoDepois._sum.amountCents ?? 0);
  const alvo = Math.min(
    Math.round(order.promoterCommissionCents * Math.max(0, Math.min(1, fraction))),
    order.promoterCommissionCents,
  );
  const valor = alvo - jaDevolvido;
  if (valor <= 0) return; // nada novo a devolver (idempotente)

  const hostAccount = await tx.ledgerAccount.findUnique({
    where: { organizationId: order.event.organizationId },
  });
  const promoterAccount = await resolvePromoterWallet(tx, order.promoterLink.promoterUserId, false);
  if (!hostAccount || !promoterAccount) return;
  await tx.ledgerEntry.createMany({
    data: [
      {
        ledgerAccountId: promoterAccount.id,
        type: "COMMISSION_CREDIT",
        amountCents: -valor,
        referenceType: "payment",
        referenceId: payment.id,
        description,
      },
      {
        ledgerAccountId: hostAccount.id,
        type: "COMMISSION_DEBIT",
        amountCents: valor,
        referenceType: "payment",
        referenceId: payment.id,
        description,
      },
    ],
  });
}
