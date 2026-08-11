import { BadRequestException } from "@nestjs/common";
import { prisma } from "@borafest/database";

/**
 * Teto ACUMULADO de estorno (revisão adversarial 2026-08-11).
 *
 * A validação antiga era por chamada — dois estornos parciais de R$ 60 num
 * pagamento de R$ 100 mandavam R$ 120 ao comprador e jogavam o caixa da casa
 * no negativo. Aqui somamos tudo que já foi devolvido (REFUND_DEBIT) e
 * recusamos o que passar do valor pago. Vale para produtor, backoffice e casa.
 */
export async function assertRefundWithinCap(
  payment: { id: string; amountCents: number },
  amountCents: number | undefined,
): Promise<void> {
  const debitos = await prisma.ledgerEntry.aggregate({
    where: { referenceType: "payment", referenceId: payment.id, type: "REFUND_DEBIT" },
    _sum: { amountCents: true },
  });
  const jaDevolvido = Math.abs(debitos._sum.amountCents ?? 0);
  const restante = payment.amountCents - jaDevolvido;

  if (restante <= 0) {
    throw new BadRequestException("Este pagamento já foi totalmente estornado");
  }
  const pedido = amountCents ?? restante;
  if (pedido > restante) {
    throw new BadRequestException(
      `Valor acima do disponível para estorno (restam R$ ${(restante / 100).toFixed(2).replace(".", ",")})`,
    );
  }
}
