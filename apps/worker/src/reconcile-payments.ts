import { prisma, type VipPaymentRow } from "@borafest/database";
import {
  applyGatewayStatus,
  applyVipGatewayStatus,
  getGateway,
  type GatewayPaymentSnapshot,
} from "@borafest/payments";
import { withContext } from "@borafest/observability";

const log = withContext({ module: "payment-reconciliation" });

/**
 * Revisão dos chargebacks (2026-10-12): disputa de cartão leva semanas, então
 * basta olhar de tempos em tempos — o job roda a cada minuto, a revisão a
 * cada 6 h (por processo; reinício do worker revisa na hora).
 */
const CHARGEBACK_REVIEW_EVERY_MS = 6 * 60 * 60_000;
/** janela de disputa: chargeback mais antigo que isso não é mais consultado */
const CHARGEBACK_REVIEW_WINDOW_DAYS = 180;
let ultimaRevisaoDeChargeback = 0;

export async function reconcilePendingPayments(): Promise<void> {
  const cutoff = new Date(Date.now() - 2 * 60_000);
  const payments = await prisma.payment.findMany({
    where: {
      status: { in: ["PENDING", "AUTHORIZED", "REFUND_PENDING"] },
      externalId: { not: null },
      createdAt: { lt: cutoff },
    },
    take: 100,
  });

  for (const payment of payments) {
    try {
      const gateway = getGateway(payment.provider);
      // a mesma consulta já traz o valor pago (2026-10-12): a conferência de
      // valor do applyGatewayStatus não precisa de uma segunda chamada
      const snapshot: GatewayPaymentSnapshot = gateway.getPaymentSnapshot
        ? await gateway.getPaymentSnapshot(payment.externalId!)
        : { status: await gateway.getStatus(payment.externalId!) };
      const status = snapshot.status;
      if (status !== "PENDING") {
        const result = await applyGatewayStatus(payment.id, status, undefined, {
          paidAmountCents: snapshot.paidAmountCents ?? null,
        });
        if (result.amountMismatch) {
          log.warn(
            { paymentId: payment.id, paidAmountCents: snapshot.paidAmountCents ?? null },
            "valor pago menor que o cobrado — pedido não confirmado, backoffice alertado",
          );
        }
        if (result.paymentChanged) {
          log.info({ paymentId: payment.id, status }, "pagamento corrigido pela reconciliação");
        }
      }
    } catch (error) {
      log.error({ paymentId: payment.id, error: (error as Error).message }, "falha ao reconciliar pagamento");
    }
  }

  await reconcileVipPayments(cutoff);
  await reconcileDriftedRefunds();

  if (Date.now() - ultimaRevisaoDeChargeback >= CHARGEBACK_REVIEW_EVERY_MS) {
    ultimaRevisaoDeChargeback = Date.now();
    await reviewChargebackPayments().catch((error) =>
      log.error({ error: (error as Error).message }, "falha na revisão de chargebacks"),
    );
  }
}

/**
 * Chargeback GANHO que nenhum webhook avisou (2026-10-12). A reconciliação só
 * olhava pagamentos abertos; um pagamento em CHARGEBACK nunca era consultado
 * de novo, então uma disputa vencida sem webhook (ou com o webhook perdido,
 * ou de provedor que não manda esse evento) deixava o produtor sem o valor.
 *
 * Decide pelo status ATUAL no gateway — nunca por evento velho: se a
 * cobrança voltou a "paga" (ou o provedor diz "disputa vencida"), aplica
 * CHARGEBACK_REVERSED, que devolve o crédito ao produtor e alerta o backoffice
 * (ingresso cancelado não é reemitido sozinho).
 */
export async function reviewChargebackPayments(
  /** só para teste: restringe a estes pagamentos (nunca consultar PSP real por linhas alheias) */
  filtro?: { paymentIds?: string[] },
): Promise<number> {
  const desde = new Date(Date.now() - CHARGEBACK_REVIEW_WINDOW_DAYS * 86_400_000);
  const payments = await prisma.payment.findMany({
    where: {
      status: "CHARGEBACK",
      externalId: { not: null },
      updatedAt: { gte: desde },
      ...(filtro?.paymentIds ? { id: { in: filtro.paymentIds } } : {}),
    },
    orderBy: { updatedAt: "desc" },
    take: 50,
    select: { id: true, provider: true, externalId: true },
  });

  let revertidos = 0;
  for (const payment of payments) {
    try {
      const gateway = getGateway(payment.provider);
      const status = await gateway.getStatus(payment.externalId!);
      if (status !== "PAID" && status !== "CHARGEBACK_REVERSED") continue;
      const result = await applyGatewayStatus(payment.id, "CHARGEBACK_REVERSED");
      if (result.chargebackReversed) {
        revertidos += 1;
        log.warn(
          { paymentId: payment.id, gatewayStatus: status },
          "chargeback revertido (disputa ganha) — crédito do produtor restaurado; backoffice alertado",
        );
      }
    } catch (error) {
      log.error({ paymentId: payment.id, error: (error as Error).message }, "falha ao revisar chargeback");
    }
  }
  return revertidos;
}

async function reconcileVipPayments(cutoff: Date): Promise<void> {
  const payments = await prisma.$queryRaw<VipPaymentRow[]>`
    SELECT
      id,
      vip_reservation_id AS "vipReservationId",
      provider,
      method,
      status,
      amount_cents AS "amountCents",
      external_id AS "externalId",
      pix_qr_code_text AS "pixQrCodeText",
      fail_reason AS "failReason",
      expires_at AS "expiresAt",
      paid_at AS "paidAt",
      metadata,
      created_at AS "createdAt",
      updated_at AS "updatedAt"
    FROM vip_payments
    WHERE status IN (
      'PENDING'::"PaymentStatus",
      'AUTHORIZED'::"PaymentStatus",
      'REFUND_PENDING'::"PaymentStatus"
    )
      AND external_id IS NOT NULL
      AND created_at < (${cutoff}::timestamptz AT TIME ZONE 'UTC')
    ORDER BY created_at ASC
    LIMIT 100
  `;

  for (const payment of payments) {
    try {
      const gateway = getGateway(payment.provider);
      // mesma consulta com o valor pago (conferência de valor, 2026-10-12)
      const snapshot: GatewayPaymentSnapshot = gateway.getPaymentSnapshot
        ? await gateway.getPaymentSnapshot(payment.externalId!)
        : { status: await gateway.getStatus(payment.externalId!) };
      const status = snapshot.status;
      if (status === "PENDING") continue;
      const result = await applyVipGatewayStatus(payment.id, status, undefined, {
        paidAmountCents: snapshot.paidAmountCents ?? null,
      });
      if (result.amountMismatch) {
        log.warn(
          { vipPaymentId: payment.id, paidAmountCents: snapshot.paidAmountCents ?? null },
          "VIP pago a menor — reserva não confirmada, backoffice alertado",
        );
      }
      if (result.paymentChanged) {
        log.info({ vipPaymentId: payment.id, status }, "pagamento VIP corrigido pela reconciliação");
      }
    } catch (error) {
      log.error({ vipPaymentId: payment.id, error: (error as Error).message }, "falha ao reconciliar pagamento VIP");
    }
  }
}

/** Aprovação "reservada" há mais que isto, com o pedido ainda pago, é estorno que não saiu. */
const APROVACAO_PRESA_MS = 10 * 60_000;

async function reconcileDriftedRefunds(): Promise<void> {
  await fecharPedidosDeReembolsoJaEstornados();
  await devolverAprovacoesPresas();

  const openRequests = await prisma.refundRequest.findMany({
    where: { status: "PENDING" },
    take: 50,
    select: {
      id: true,
      order: {
        select: {
          id: true,
          payments: {
            where: { status: "PAID", externalId: { not: null } },
            orderBy: { createdAt: "desc" },
            take: 1,
            select: { id: true, provider: true, externalId: true },
          },
        },
      },
    },
  });

  for (const request of openRequests) {
    const payment = request.order.payments[0];
    if (!payment) continue;
    try {
      const gateway = getGateway(payment.provider);
      const status = await gateway.getStatus(payment.externalId!);
      if (status !== "REFUNDED" && status !== "CHARGEBACK") continue;
      await applyGatewayStatus(payment.id, status);
      // só se ainda pendente (revisão 2026-10-13): uma recusa no meio-tempo
      // não é sobrescrita — e o estorno de verdade fecha o pedido acima, na
      // próxima rodada, se ele voltar à fila
      const fechado = await prisma.refundRequest.updateMany({
        where: { id: request.id, status: "PENDING" },
        data: { status: "APPROVED", resolvedAt: new Date() },
      });
      if (fechado.count === 0) continue;
      await prisma.auditLog.create({
        data: {
          action: "system.refund_request.auto_reconciled",
          entityType: "refund_request",
          entityId: request.id,
          metadata: { orderId: request.order.id, paymentId: payment.id, gatewayStatus: status },
        },
      });
      log.info({ refundRequestId: request.id, status }, "reembolso conciliado automaticamente");
    } catch (error) {
      log.error({ refundRequestId: request.id, error: (error as Error).message }, "falha ao conciliar reembolso");
    }
  }
}

/**
 * Pedido de reembolso PENDENTE cujo pedido já teve o dinheiro devolvido
 * (estorno direto pelo backoffice, ou aprovação em que o gateway estornou e a
 * baixa local falhou): fecha como aprovado. Antes ficava pendente para sempre
 * — a varredura de baixo só olha pagamento PAID (revisão 2026-10-13).
 */
async function fecharPedidosDeReembolsoJaEstornados(): Promise<void> {
  const resolvidos = await prisma.refundRequest.findMany({
    where: { status: "PENDING", order: { status: { in: ["REFUNDED", "CHARGEBACK"] } } },
    select: { id: true, orderId: true },
    take: 50,
  });
  for (const request of resolvidos) {
    const fechado = await prisma.refundRequest.updateMany({
      where: { id: request.id, status: "PENDING" },
      data: { status: "APPROVED", resolvedAt: new Date() },
    });
    if (fechado.count === 0) continue;
    await prisma.auditLog.create({
      data: {
        action: "system.refund_request.auto_reconciled",
        entityType: "refund_request",
        entityId: request.id,
        metadata: { orderId: request.orderId, motivo: "pedido já estornado" },
      },
    });
    log.info({ refundRequestId: request.id }, "pedido de reembolso fechado: o pedido já estava estornado");
  }
}

/**
 * Aprovação reservada (PENDING → APPROVED antes do estorno) cujo estorno não
 * saiu — a API caiu entre reservar e o gateway responder: o pedido segue pago
 * e nenhuma fila mostrava o pedido de reembolso. Volta para a fila depois de
 * 10 min (só as do último dia: histórico antigo não é mexido).
 */
async function devolverAprovacoesPresas(): Promise<void> {
  const agora = Date.now();
  const presos = await prisma.refundRequest.findMany({
    where: {
      status: "APPROVED",
      resolvedAt: { lt: new Date(agora - APROVACAO_PRESA_MS), gt: new Date(agora - 24 * 60 * 60_000) },
      order: {
        status: { in: ["PAID", "FULFILLED"] },
        payments: { none: { status: { in: ["REFUND_PENDING", "REFUNDED", "CHARGEBACK"] } } },
      },
    },
    select: { id: true, orderId: true, resolvedByUserId: true },
    take: 50,
  });
  for (const request of presos) {
    const devolvido = await prisma.refundRequest.updateMany({
      where: { id: request.id, status: "APPROVED" },
      data: { status: "PENDING", resolvedAt: null, resolvedByUserId: null },
    });
    if (devolvido.count === 0) continue;
    await prisma.auditLog.create({
      data: {
        action: "system.refund_request.requeued",
        entityType: "refund_request",
        entityId: request.id,
        metadata: { orderId: request.orderId, aprovadoPor: request.resolvedByUserId, motivo: "estorno não saiu" },
      },
    });
    log.warn({ refundRequestId: request.id }, "aprovação de reembolso sem estorno voltou para a fila");
  }
}
