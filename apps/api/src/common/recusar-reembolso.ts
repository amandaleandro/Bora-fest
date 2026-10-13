import { BadRequestException, NotFoundException } from "@nestjs/common";
import { ehEmailAnonimo, prisma } from "@borafest/database";
import { semEmailReal } from "@borafest/contracts";

/** Template do worker (deliver-notifications.ts). */
export const TEMPLATE_REEMBOLSO_RECUSADO = "refund_request_rejected";

/**
 * Recusa um pedido de reembolso, SEM checagem de permissão — quem chama já
 * checou (casa no repasse instantâneo, ou backoffice). Mesmo contrato para os
 * dois lados (2026-10-13):
 *  - atômico: só recusa se ainda estiver PENDING (dois cliques, ou casa e
 *    BoraFest ao mesmo tempo, não geram duas recusas nem dois e-mails);
 *  - avisa o comprador NA MESMA TRANSAÇÃO — antes a recusa era silenciosa e
 *    "Minhas compras" seguia dizendo "em análise".
 *
 * @param recusadoPor o que o comprador lê: nome da casa ou "BoraFest"
 */
export async function recusarPedidoDeReembolso(
  requestId: string,
  actorUserId: string,
  nota: string,
  recusadoPor: "casa" | "BoraFest",
) {
  return prisma.$transaction(async (tx) => {
    // o dinheiro já voltou (estorno direto pelo backoffice, ou aprovação cujo
    // gateway estornou e a baixa local falhou): recusar mandaria "recusado,
    // seu ingresso continua valendo" a quem já foi reembolsado (revisão 2026-10-13)
    const jaEstornado = await tx.refundRequest.findFirst({
      where: {
        id: requestId,
        order: {
          OR: [
            { status: { in: ["REFUND_PENDING", "PARTIALLY_REFUNDED", "REFUNDED", "CHARGEBACK"] } },
            { payments: { some: { status: { in: ["REFUND_PENDING", "REFUNDED", "CHARGEBACK"] } } } },
          ],
        },
      },
      select: { id: true },
    });
    if (jaEstornado) {
      throw new BadRequestException(
        "Este pedido já teve o dinheiro devolvido — use Aprovar para fechar o pedido de reembolso.",
      );
    }

    const marcado = await tx.refundRequest.updateMany({
      where: { id: requestId, status: "PENDING" },
      data: {
        status: "REJECTED",
        resolvedAt: new Date(),
        resolvedByUserId: actorUserId,
        resolutionNote: nota,
      },
    });
    if (marcado.count === 0) {
      const existe = await tx.refundRequest.findUnique({ where: { id: requestId }, select: { id: true } });
      if (!existe) throw new NotFoundException("Pedido de reembolso não encontrado");
      throw new BadRequestException("Este pedido de reembolso já foi resolvido");
    }

    const request = await tx.refundRequest.findUniqueOrThrow({
      where: { id: requestId },
      include: {
        order: {
          select: {
            id: true,
            contactName: true,
            contactEmail: true,
            event: {
              select: { title: true, organization: { select: { name: true, displayName: true } } },
            },
          },
        },
      },
    });

    const { order } = request;
    const casa = order.event.organization.displayName ?? order.event.organization.name;
    // e-mail sintético (lista, porta) ou de conta apagada não tem caixa
    if (!semEmailReal(order.contactEmail) && !ehEmailAnonimo(order.contactEmail)) {
      await tx.notification.create({
        data: {
          channel: "EMAIL",
          recipient: order.contactEmail,
          template: TEMPLATE_REEMBOLSO_RECUSADO,
          orderId: order.id,
          payload: {
            contactName: order.contactName,
            eventTitle: order.event.title,
            recusadoPor: recusadoPor === "casa" ? casa : "BoraFest",
            casa,
            motivo: nota,
          },
        },
      });
    }

    const { order: _order, ...resto } = request;
    return resto;
  });
}

/**
 * APROVAÇÃO atômica (revisão 2026-10-13): reserva o pedido (PENDING →
 * APPROVED) ANTES do estorno. Antes o estorno saía primeiro e a marcação
 * vinha depois — uma recusa no meio (casa e BoraFest, ou dois cliques)
 * passava, o comprador recebia o dinheiro E o e-mail "recusado", e a
 * aprovação sobrescrevia a recusa. Quem chama estorna depois e, se o estorno
 * falhar, devolve com `devolverReembolsoParaFila`.
 */
export async function reservarAprovacaoDoReembolso(requestId: string, actorUserId: string): Promise<void> {
  const reservado = await prisma.refundRequest.updateMany({
    where: { id: requestId, status: "PENDING" },
    data: { status: "APPROVED", resolvedAt: new Date(), resolvedByUserId: actorUserId },
  });
  if (reservado.count === 0) {
    const existe = await prisma.refundRequest.findUnique({ where: { id: requestId }, select: { id: true } });
    if (!existe) throw new NotFoundException("Pedido de reembolso não encontrado");
    throw new BadRequestException("Este pedido de reembolso já foi resolvido");
  }
}

/** O estorno não saiu: o pedido volta para a fila (só se ainda for a reserva deste aprovador). */
export async function devolverReembolsoParaFila(requestId: string, actorUserId: string): Promise<void> {
  await prisma.refundRequest.updateMany({
    where: { id: requestId, status: "APPROVED", resolvedByUserId: actorUserId },
    data: { status: "PENDING", resolvedAt: null, resolvedByUserId: null },
  });
}
