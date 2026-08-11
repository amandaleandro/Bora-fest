import { BadRequestException, NotFoundException } from "@nestjs/common";
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

  await applyGatewayStatus(payment.id, result.status, undefined, {
    refundAmountCents: input.amountCents,
  });

  return { order, payment, gatewayStatus: result.status };
}
