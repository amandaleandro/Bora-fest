import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { prisma } from "@borafest/database";
import { PERMISSIONS } from "@borafest/auth";
import type { CreateRefundRequestInput } from "@borafest/contracts";
import { OrgAccessService } from "../common/org-access.service";
import { executeOrderRefund } from "../common/execute-refund";
import {
  devolverReembolsoParaFila,
  recusarPedidoDeReembolso,
  reservarAprovacaoDoReembolso,
} from "../common/recusar-reembolso";

@Injectable()
export class RefundRequestsService {
  constructor(private readonly orgAccess: OrgAccessService) {}

  /**
   * Pedido de reembolso self-service (arquitetura §13): só cria o registro
   * PENDING, não estorna sozinho. Quem analisa depende do modo de repasse da
   * organização do evento (decisão 2026-07-28): INSTANTÂNEO → a própria casa
   * resolve no painel; PADRÃO → backoffice BoraFest.
   */
  async create(orderPublicToken: string, input: CreateRefundRequestInput) {
    const order = await prisma.order.findUnique({
      where: { publicToken: orderPublicToken },
      include: {
        event: { select: { organization: { select: { name: true, settlementMode: true } } } },
      },
    });
    if (!order) throw new NotFoundException("Pedido não encontrado");

    // INGRESSO GRÁTIS NÃO TEM REEMBOLSO (2026-10-11): antes o pedido entrava na
    // fila da casa/BoraFest, o comprador via "Reembolso em análise" e o
    // "Aprovar" falhava ("não tem pagamento aprovado") — só dava para recusar.
    // Vem antes da checagem de status para a mensagem dizer o motivo real.
    if (order.totalCents === 0) {
      throw new BadRequestException("Ingresso grátis não tem reembolso.");
    }

    if (!["PAID", "FULFILLED"].includes(order.status)) {
      throw new BadRequestException("Este pedido não tem pagamento aprovado para reembolsar");
    }

    // pedido travado (2026-10-13): duas abas (ou duplo clique) criavam dois
    // PENDING — a checagem e a criação agora acontecem com a linha do pedido
    // presa, então a segunda espera a primeira e vê o pendente
    const request = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM orders WHERE id = ${order.id}::uuid FOR UPDATE`;
      const pendente = await tx.refundRequest.findFirst({
        where: { orderId: order.id, status: "PENDING" },
        select: { id: true },
      });
      if (pendente) {
        throw new BadRequestException("Já existe um pedido de reembolso pendente para este pedido");
      }
      return tx.refundRequest.create({
        data: { orderId: order.id, reason: input.reason },
      });
    });

    // o comprador vê quem analisa — a casa (INSTANT) ou a BoraFest (STANDARD)
    return {
      ...request,
      reviewedBy:
        order.event.organization.settlementMode === "INSTANT"
          ? order.event.organization.name
          : "BoraFest",
    };
  }

  /** Fila de reembolsos da casa (pedidos dos eventos dela). */
  async listForOrganization(organizationId: string, userId: string) {
    await this.orgAccess.assertPermission(organizationId, userId, PERMISSIONS.FINANCE_VIEW);

    return prisma.refundRequest.findMany({
      where: { order: { event: { organizationId } } },
      orderBy: [{ status: "asc" }, { requestedAt: "desc" }],
      take: 100,
      include: {
        order: {
          select: {
            publicToken: true,
            contactName: true,
            contactEmail: true,
            totalCents: true,
            status: true,
            event: { select: { title: true } },
          },
        },
      },
    });
  }

  /**
   * Aprovação PELA CASA — só no modo INSTANTÂNEO (o aditivo transfere a
   * responsabilidade do reembolso para ela; no PADRÃO quem executa é a
   * BoraFest). O estorno sai do saldo da organização via ledger.
   */
  async approveByOrganization(
    requestId: string,
    organizationId: string,
    userId: string,
    input: { amountCents?: number },
  ) {
    const { request } = await this.assertResolvable(requestId, organizationId, userId);

    // reserva atômica ANTES do estorno (common/recusar-reembolso.ts)
    await reservarAprovacaoDoReembolso(requestId, userId);
    let estorno: Awaited<ReturnType<typeof executeOrderRefund>>;
    try {
      estorno = await executeOrderRefund(request.order.publicToken, {
        amountCents: input.amountCents,
        idempotencyPrefix: `org-refund:${organizationId}`,
      });
    } catch (err) {
      await devolverReembolsoParaFila(requestId, userId);
      throw err;
    }
    const { order, gatewayStatus } = estorno;

    await prisma.auditLog.create({
      data: {
        actorUserId: userId,
        organizationId,
        action: "producer.refund_request.approve",
        entityType: "refund_request",
        entityId: requestId,
        metadata: { orderId: order.id, amountCents: input.amountCents ?? null, gatewayStatus },
      },
    });

    return { approved: true, orderId: order.id };
  }

  async rejectByOrganization(
    requestId: string,
    organizationId: string,
    userId: string,
    input: { note: string },
  ) {
    await this.assertResolvable(requestId, organizationId, userId);

    // atômica e com aviso ao comprador (common/recusar-reembolso.ts)
    const updated = await recusarPedidoDeReembolso(requestId, userId, input.note, "casa");

    await prisma.auditLog.create({
      data: {
        actorUserId: userId,
        organizationId,
        action: "producer.refund_request.reject",
        entityType: "refund_request",
        entityId: requestId,
        metadata: { note: input.note },
      },
    });

    return updated;
  }

  private async assertResolvable(requestId: string, organizationId: string, userId: string) {
    await this.orgAccess.assertPermission(organizationId, userId, PERMISSIONS.ORDER_REFUND);

    const request = await prisma.refundRequest.findUnique({
      where: { id: requestId },
      include: {
        order: {
          select: { publicToken: true, event: { select: { organizationId: true } } },
        },
      },
    });
    if (!request) throw new NotFoundException("Pedido de reembolso não encontrado");
    if (request.order.event.organizationId !== organizationId) {
      throw new ForbiddenException("Este pedido de reembolso não é de um evento seu");
    }
    if (request.status !== "PENDING") {
      throw new BadRequestException("Este pedido de reembolso já foi resolvido");
    }

    const org = await prisma.organization.findUniqueOrThrow({
      where: { id: organizationId },
      select: { settlementMode: true },
    });
    if (org.settlementMode !== "INSTANT") {
      throw new BadRequestException(
        "No repasse padrão, quem analisa reembolsos é a BoraFest — fale com o suporte",
      );
    }

    return { request };
  }
}
