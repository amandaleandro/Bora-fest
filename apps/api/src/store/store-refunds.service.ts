import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { prisma } from "@borafest/database";
import { PERMISSIONS } from "@borafest/auth";
import { applyStoreGatewayStatus, getGateway } from "@borafest/payments";
import type { RejectStoreRefundInput, RequestStoreRefundInput } from "@borafest/contracts";
import { OrgAccessService } from "../common/org-access.service";

@Injectable()
export class StoreRefundsService {
  constructor(private readonly orgAccess: OrgAccessService) {}

  async request(publicToken: string, userId: string, input: RequestStoreRefundInput) {
    const order = await prisma.storeOrder.findUnique({
      where: { publicToken },
      include: {
        refundRequests: {
          where: { status: { in: ["PENDING", "AWAITING_RETURN"] } },
          select: { id: true },
        },
      },
    });
    if (!order) throw new NotFoundException("Pedido da Loja não encontrado");
    if (order.userId !== userId) {
      throw new ForbiddenException("Este pedido da Loja não pertence à sua conta");
    }
    if (!["PAID", "READY", "FULFILLED"].includes(order.status)) {
      throw new BadRequestException("Este pedido não está em um estado reembolsável");
    }
    if (order.refundRequests.length > 0) {
      throw new BadRequestException("Já existe uma solicitação de reembolso em andamento");
    }

    const status = order.status === "FULFILLED" ? "AWAITING_RETURN" : "PENDING";
    const created = await prisma.storeRefundRequest.create({
      data: {
        storeOrderId: order.id,
        reason: input.reason,
        status,
      },
    });

    return {
      ...created,
      returnRequired: status === "AWAITING_RETURN",
    };
  }

  async listForOrganization(organizationId: string, userId: string) {
    await this.orgAccess.assertPermission(
      organizationId,
      userId,
      PERMISSIONS.FINANCE_VIEW,
    );

    return prisma.storeRefundRequest.findMany({
      where: { order: { organizationId } },
      orderBy: [{ status: "asc" }, { requestedAt: "desc" }],
      take: 100,
      include: {
        order: {
          select: {
            id: true,
            publicToken: true,
            status: true,
            contactName: true,
            contactEmail: true,
            totalCents: true,
            pickupCode: true,
            paidAt: true,
            fulfilledAt: true,
            items: {
              select: {
                id: true,
                productName: true,
                variantName: true,
                quantity: true,
                priceCents: true,
              },
            },
          },
        },
      },
    });
  }

  async markReturned(requestId: string, organizationId: string, userId: string) {
    await this.orgAccess.assertPermission(
      organizationId,
      userId,
      PERMISSIONS.ORDER_REFUND,
    );

    const request = await prisma.storeRefundRequest.findUnique({
      where: { id: requestId },
      include: { order: { include: { items: true } } },
    });
    if (!request) throw new NotFoundException("Solicitação de reembolso não encontrada");
    if (request.order.organizationId !== organizationId) {
      throw new ForbiddenException("Solicitação não pertence a esta Casa");
    }
    if (request.status !== "AWAITING_RETURN") {
      throw new BadRequestException("Esta solicitação não está aguardando devolução");
    }
    if (request.order.status !== "FULFILLED") {
      throw new BadRequestException("Somente pedido retirado precisa de devolução física");
    }

    await prisma.$transaction(async (tx) => {
      for (const item of request.order.items) {
        const changed = await tx.storeProductVariant.updateMany({
          where: { id: item.variantId, soldCount: { gte: item.quantity } },
          data: { soldCount: { decrement: item.quantity } },
        });
        if (changed.count === 0) {
          throw new Error("Estoque vendido inconsistente na devolução da variação " + item.variantId);
        }
      }

      await tx.storeRefundRequest.update({
        where: { id: request.id },
        data: { status: "PENDING", returnedAt: new Date() },
      });

      await tx.auditLog.create({
        data: {
          actorUserId: userId,
          organizationId,
          action: "store.refund.return_received",
          entityType: "store_refund_request",
          entityId: request.id,
          metadata: { storeOrderId: request.order.id },
        },
      });
    });

    return { returned: true };
  }

  async approve(requestId: string, organizationId: string, userId: string) {
    await this.orgAccess.assertPermission(
      organizationId,
      userId,
      PERMISSIONS.ORDER_REFUND,
    );

    const request = await prisma.storeRefundRequest.findUnique({
      where: { id: requestId },
      include: {
        order: {
          include: {
            payments: {
              where: { status: { in: ["PAID", "REFUND_PENDING"] } },
              orderBy: { paidAt: "desc" },
              take: 1,
            },
          },
        },
      },
    });
    if (!request) throw new NotFoundException("Solicitação de reembolso não encontrada");
    if (request.order.organizationId !== organizationId) {
      throw new ForbiddenException("Solicitação não pertence a esta Casa");
    }
    if (request.status !== "PENDING") {
      throw new BadRequestException("Solicitação ainda aguarda devolução ou já foi resolvida");
    }
    if (request.order.status === "FULFILLED" && !request.returnedAt) {
      throw new BadRequestException("Confirme a devolução física antes de estornar");
    }

    const payment = request.order.payments[0];
    if (!payment?.externalId) {
      throw new BadRequestException("Pagamento da Loja não encontrado para estorno");
    }

    const gateway = getGateway(payment.provider);
    const result = await gateway.refund({
      externalId: payment.externalId,
      idempotencyKey: "store-refund:" + request.id,
    });
    if (result.status === "FAILED") {
      throw new BadRequestException("O provedor recusou o estorno; tente novamente");
    }

    if (result.status === "REFUNDED") {
      await applyStoreGatewayStatus(payment.id, "REFUNDED");
    } else {
      await prisma.storePayment.updateMany({
        where: { id: payment.id, status: "PAID" },
        data: { status: "REFUND_PENDING" },
      });
    }

    await prisma.$transaction([
      prisma.storeRefundRequest.update({
        where: { id: request.id },
        data: {
          status: "APPROVED",
          resolvedAt: new Date(),
          resolvedByUserId: userId,
        },
      }),
      prisma.auditLog.create({
        data: {
          actorUserId: userId,
          organizationId,
          action: "store.refund.approve",
          entityType: "store_refund_request",
          entityId: request.id,
          metadata: {
            storeOrderId: request.order.id,
            storePaymentId: payment.id,
            gatewayStatus: result.status,
          },
        },
      }),
    ]);

    return { approved: true, gatewayStatus: result.status };
  }

  async reject(
    requestId: string,
    organizationId: string,
    userId: string,
    input: RejectStoreRefundInput,
  ) {
    await this.orgAccess.assertPermission(
      organizationId,
      userId,
      PERMISSIONS.ORDER_REFUND,
    );

    const request = await prisma.storeRefundRequest.findUnique({
      where: { id: requestId },
      include: { order: { select: { organizationId: true } } },
    });
    if (!request) throw new NotFoundException("Solicitação de reembolso não encontrada");
    if (request.order.organizationId !== organizationId) {
      throw new ForbiddenException("Solicitação não pertence a esta Casa");
    }
    if (!["PENDING", "AWAITING_RETURN"].includes(request.status)) {
      throw new BadRequestException("Solicitação já foi resolvida");
    }

    const updated = await prisma.storeRefundRequest.update({
      where: { id: request.id },
      data: {
        status: "REJECTED",
        resolvedAt: new Date(),
        resolvedByUserId: userId,
        resolutionNote: input.note,
      },
    });

    await prisma.auditLog.create({
      data: {
        actorUserId: userId,
        organizationId,
        action: "store.refund.reject",
        entityType: "store_refund_request",
        entityId: request.id,
        metadata: { note: input.note },
      },
    });

    return updated;
  }
}
