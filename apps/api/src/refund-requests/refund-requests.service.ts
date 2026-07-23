import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { prisma } from "@borafest/database";
import type { CreateRefundRequestInput } from "@borafest/contracts";

@Injectable()
export class RefundRequestsService {
  /**
   * Pedido de reembolso self-service (arquitetura §13): só cria o registro
   * PENDING, não estorna sozinho — quem executa é o admin (`AdminService.
   * approveRefundRequest`, mesmo gateway usado no estorno manual).
   */
  async create(orderPublicToken: string, input: CreateRefundRequestInput) {
    const order = await prisma.order.findUnique({
      where: { publicToken: orderPublicToken },
      include: { refundRequests: { where: { status: "PENDING" } } },
    });
    if (!order) throw new NotFoundException("Pedido não encontrado");

    if (!["PAID", "FULFILLED"].includes(order.status)) {
      throw new BadRequestException("Este pedido não tem pagamento aprovado para reembolsar");
    }
    if (order.refundRequests.length > 0) {
      throw new BadRequestException("Já existe um pedido de reembolso pendente para este pedido");
    }

    return prisma.refundRequest.create({
      data: { orderId: order.id, reason: input.reason },
    });
  }
}
