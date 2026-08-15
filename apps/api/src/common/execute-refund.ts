import { BadRequestException, InternalServerErrorException, NotFoundException } from "@nestjs/common";
import { prisma } from "@borafest/database";
import { assertRefundWithinCap } from "./refund-cap";
import { applyGatewayStatus, getGateway } from "@borafest/payments";

/**
 * Executor único de estorno (usado pelo backoffice e pela casa no modo
 * INSTANTÂNEO): marca REFUND_PENDING, chama o gateway, aplica o status e
 * reverte a marcação se o gateway falhar. O débito no ledger da organização
 * acontece dentro do applyGatewayStatus — o dinheiro sai do saldo do produtor.
 */
export async function executeOrderRefund(
  publicToken: string,
  input: { amountCents?: number; idempotencyPrefix: string },
): Promise<{ order: { id: string }; payment: { id: string }; gatewayStatus: string }> {
  const order = await prisma.order.findUnique({
    where: { publicToken },
    include: { payments: { orderBy: { createdAt: "desc" } } },
  });
  if (!order) throw new NotFoundException("Pedido não encontrado");

  // Já estornado de ponta a ponta (ex.: a reconciliação do worker aplicou
  // antes do clique): aprovar vira só a baixa do request — sem novo estorno.
  if (order.status === "REFUNDED" || order.status === "CHARGEBACK") {
    const done = order.payments.find((p) => p.status === "REFUNDED" || p.status === "CHARGEBACK");
    if (done) {
      return { order: { id: order.id }, payment: { id: done.id }, gatewayStatus: done.status };
    }
  }

  // RECUPERAÇÃO (incidente 2026-08-14, pedido da Marcela): um erro DEPOIS do
  // gateway deixa o pagamento preso em REFUND_PENDING com o dinheiro JÁ
  // devolvido ao comprador. No clique seguinte, em vez de recusar, conferimos
  // no gateway: se o estorno consta lá, aplicamos a contabilidade agora — sem
  // estornar de novo (zero risco de estorno em dobro).
  const preso = order.payments.find((p) => p.status === "REFUND_PENDING" && p.externalId);
  if (preso) {
    const gateway = getGateway(preso.provider);
    const statusNoGateway = await gateway.getStatus(preso.externalId!);
    if (statusNoGateway === "REFUNDED" || statusNoGateway === "CHARGEBACK") {
      await applyGatewayStatus(preso.id, statusNoGateway, undefined, {
        refundAmountCents: input.amountCents,
      });
      return { order: { id: order.id }, payment: { id: preso.id }, gatewayStatus: statusNoGateway };
    }
    throw new BadRequestException(
      "Estorno anterior ainda em processamento no gateway — tente de novo em instantes",
    );
  }

  const payment = order.payments.find((p) => p.status === "PAID");
  if (!payment || !payment.externalId) {
    throw new BadRequestException("Pedido não tem pagamento aprovado para estornar");
  }
  await assertRefundWithinCap(payment, input.amountCents);

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
      idempotencyKey: `${input.idempotencyPrefix}:${payment.id}:${input.amountCents ?? "full"}`,
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

  // ESTORNO ASSÍNCRONO (auditoria 2026-08-12): Asaas (cartão e Pix) ACEITA o
  // estorno e devolve "PENDING". A chamada antiga applyGatewayStatus("PENDING")
  // era no-op → o dinheiro saía, mas o ledger não era debitado, a comissão do
  // promoter não sofria clawback e o pagamento ficava preso em REFUND_PENDING
  // (o refund-cap achava que nada tinha sido devolvido, liberando estorno em
  // dobro). Como NÓS iniciamos com um valor conhecido e o gateway se
  // comprometeu, aplicamos a contabilidade agora, com o valor EXATO. O webhook
  // que chega depois é idempotente: pagamento já reembolsado → no-op.
  const statusContabil = result.status === "PENDING" ? "REFUNDED" : result.status;
  try {
    await applyGatewayStatus(payment.id, statusContabil, undefined, {
      refundAmountCents: input.amountCents,
    });
  } catch (error) {
    // O DINHEIRO JÁ SAIU no gateway; só a baixa local falhou. O pagamento fica
    // em REFUND_PENDING e o próximo clique cai na RECUPERAÇÃO lá de cima
    // (confere no gateway e aplica a contabilidade sem estornar de novo).
    console.error(
      `[refund] estorno EXECUTADO no gateway mas a contabilidade falhou (payment ${payment.id}, order ${order.id})`,
      error,
    );
    throw new InternalServerErrorException(
      "O estorno foi feito no gateway, mas a baixa aqui falhou — clique em aprovar de novo para reconciliar.",
    );
  }

  return { order, payment, gatewayStatus: result.status };
}
