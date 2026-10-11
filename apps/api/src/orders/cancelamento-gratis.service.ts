import { Injectable, NotFoundException } from "@nestjs/common";
import { prisma } from "@borafest/database";
import { PERMISSIONS } from "@borafest/auth";
import type { CancelFreeOrderInput } from "@borafest/contracts";
import { OrgAccessService } from "../common/org-access.service";
import { cancelarPedidoGratis } from "../common/cancelar-pedido-gratis";

/**
 * "Cancelar ingresso" do painel (Vendas do evento) para pedido de R$ 0
 * (decisão do Arthur, 2026-10-11): no pedido grátis o "Reembolsar" vira
 * "Cancelar ingresso". O QR deixa de valer, a vaga volta ao lote e a pessoa
 * recebe um e-mail avisando. A regra mora em `cancelarPedidoGratis`; aqui só
 * a porta de entrada do produtor.
 */
@Injectable()
export class CancelamentoGratisService {
  constructor(private readonly orgAccess: OrgAccessService) {}

  async cancelarPeloProdutor(
    orderId: string,
    actorUserId: string,
    input: CancelFreeOrderInput | undefined,
  ): Promise<any> {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      select: { id: true, event: { select: { organizationId: true } } },
    });
    if (!order) throw new NotFoundException("Pedido não encontrado");
    // mesma permissão do estorno: quem pode devolver dinheiro pode liberar vaga
    await this.orgAccess.assertPermission(order.event.organizationId, actorUserId, PERMISSIONS.ORDER_REFUND);

    const motivo = input?.reason?.trim() || "Cancelado pelo produtor";
    await cancelarPedidoGratis(order.id, actorUserId, motivo, {
      origem: "produtor",
      aviso: { tipo: "ingresso" },
    });

    // mesmo formato do retorno do estorno (orders.service refundOrder): sem o
    // Payment cru e sem o CPF do comprador (revisão pré-deploy 2026-10-11)
    const cancelado = await prisma.order.findUniqueOrThrow({
      where: { id: order.id },
      include: {
        payments: {
          orderBy: { createdAt: "desc" },
          select: { id: true, provider: true, method: true, status: true, amountCents: true, createdAt: true, paidAt: true },
        },
        tickets: { select: { id: true, code: true, status: true, attendeeName: true, ticketLotId: true } },
      },
    });
    const { contactCpf: _cpf, ...semCpf } = cancelado;
    return semCpf;
  }
}
