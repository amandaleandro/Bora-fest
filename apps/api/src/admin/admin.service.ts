import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { prisma } from "@borafest/database";
import { applyGatewayStatus, getGateway } from "@borafest/payments";
import {
  createNotificationDeliveryQueue,
  createOrderExpirationQueue,
  createOutboxDispatchQueue,
  createPaymentReconciliationQueue,
  createReservationExpirationQueue,
} from "@borafest/queues";
import type {
  BlockReasonInput,
  RefundOrderInput,
  SetOrganizationFeeInput,
} from "@borafest/contracts";
import { PlatformAccessService } from "../common/platform-access.service";
import { NotificationsService } from "../notifications/notifications.service";

@Injectable()
export class AdminService {
  private readonly reservationQueue = createReservationExpirationQueue();
  private readonly outboxQueue = createOutboxDispatchQueue();
  private readonly paymentQueue = createPaymentReconciliationQueue();
  private readonly orderQueue = createOrderExpirationQueue();
  private readonly notificationQueue = createNotificationDeliveryQueue();

  constructor(
    private readonly platformAccess: PlatformAccessService,
    private readonly notifications: NotificationsService,
  ) {}

  async listOrganizations(userId: string) {
    await this.platformAccess.assertStaff(userId);

    return prisma.organization.findMany({
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        slug: true,
        kind: true,
        status: true,
        pixFeeBps: true,
        pixFeeFloorCents: true,
        cardFeeBps: true,
        createdAt: true,
        _count: { select: { events: true, members: true } },
      },
    });
  }

  async getOrganization(organizationId: string, userId: string) {
    await this.platformAccess.assertStaff(userId);

    const organization = await prisma.organization.findUnique({
      where: { id: organizationId },
      include: {
        events: { select: { id: true, title: true, slug: true, status: true } },
        verifications: { orderBy: { createdAt: "desc" }, take: 5 },
      },
    });
    if (!organization) throw new NotFoundException("Organização não encontrada");
    return organization;
  }

  async setOrganizationFee(organizationId: string, userId: string, input: SetOrganizationFeeInput) {
    const actor = await this.platformAccess.assertAdmin(userId);

    const organization = await prisma.organization.findUnique({ where: { id: organizationId } });
    if (!organization) throw new NotFoundException("Organização não encontrada");

    const updated = await prisma.organization.update({
      where: { id: organizationId },
      data: {
        pixFeeBps: input.pixFeeBps,
        pixFeeFloorCents: input.pixFeeFloorCents,
        cardFeeBps: input.cardFeeBps,
      },
    });

    await prisma.auditLog.create({
      data: {
        actorUserId: actor.id,
        organizationId,
        action: "admin.organization.set_fee",
        entityType: "organization",
        entityId: organizationId,
        metadata: input,
      },
    });

    return updated;
  }

  async blockOrganization(organizationId: string, userId: string, input: BlockReasonInput) {
    return this.setOrganizationStatus(organizationId, userId, "BLOCKED", input.reason);
  }

  async unblockOrganization(organizationId: string, userId: string) {
    return this.setOrganizationStatus(organizationId, userId, "ACTIVE", "desbloqueio manual");
  }

  private async setOrganizationStatus(
    organizationId: string,
    userId: string,
    status: "BLOCKED" | "ACTIVE",
    reason: string,
  ) {
    const actor = await this.platformAccess.assertAdmin(userId);

    const organization = await prisma.organization.findUnique({ where: { id: organizationId } });
    if (!organization) throw new NotFoundException("Organização não encontrada");

    const updated = await prisma.organization.update({
      where: { id: organizationId },
      data: { status },
    });

    await prisma.auditLog.create({
      data: {
        actorUserId: actor.id,
        organizationId,
        action: status === "BLOCKED" ? "admin.organization.block" : "admin.organization.unblock",
        entityType: "organization",
        entityId: organizationId,
        metadata: { reason },
      },
    });

    return updated;
  }

  async listEvents(userId: string, filters: { organizationId?: string; status?: string }) {
    await this.platformAccess.assertStaff(userId);

    return prisma.event.findMany({
      where: {
        organizationId: filters.organizationId,
        status: filters.status as never,
      },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        title: true,
        slug: true,
        status: true,
        startsAt: true,
        organization: { select: { id: true, name: true } },
      },
    });
  }

  async blockEvent(eventId: string, userId: string, input: BlockReasonInput) {
    const actor = await this.platformAccess.assertAdmin(userId);

    const event = await prisma.event.findUnique({ where: { id: eventId } });
    if (!event) throw new NotFoundException("Evento não encontrado");

    const updated = await prisma.event.update({
      where: { id: eventId },
      data: { status: "CANCELED", canceledAt: new Date() },
    });

    await prisma.auditLog.create({
      data: {
        actorUserId: actor.id,
        organizationId: event.organizationId,
        action: "admin.event.block",
        entityType: "event",
        entityId: eventId,
        metadata: { reason: input.reason },
      },
    });

    return updated;
  }

  async searchOrders(
    userId: string,
    filters: { publicToken?: string; email?: string; eventId?: string },
  ) {
    await this.platformAccess.assertStaff(userId);

    if (!filters.publicToken && !filters.email && !filters.eventId) {
      throw new BadRequestException("Informe publicToken, email ou eventId para buscar");
    }

    return prisma.order.findMany({
      where: {
        publicToken: filters.publicToken,
        contactEmail: filters.email,
        eventId: filters.eventId,
      },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: {
        id: true,
        publicToken: true,
        contactName: true,
        contactEmail: true,
        status: true,
        totalCents: true,
        createdAt: true,
        event: { select: { id: true, title: true, organization: { select: { id: true, name: true } } } },
        payments: {
          select: { id: true, provider: true, method: true, status: true, externalId: true },
        },
      },
    });
  }

  async resendOrderTickets(publicToken: string, userId: string) {
    const actor = await this.platformAccess.assertStaff(userId);
    const result = await this.notifications.resendTickets(publicToken);

    await prisma.auditLog.create({
      data: {
        actorUserId: actor.id,
        action: "admin.order.resend",
        entityType: "order",
        entityId: publicToken,
        metadata: result,
      },
    });

    return result;
  }

  async refundOrder(publicToken: string, userId: string, input: RefundOrderInput): Promise<any> {
    const actor = await this.platformAccess.assertAdmin(userId);

    const order = await prisma.order.findUnique({
      where: { publicToken },
      include: { payments: { orderBy: { createdAt: "desc" } } },
    });
    if (!order) throw new NotFoundException("Pedido não encontrado");

    const payment = order.payments.find((p) => p.status === "PAID");
    if (!payment || !payment.externalId) {
      throw new BadRequestException("Pedido não tem pagamento aprovado para estornar");
    }

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
        idempotencyKey: `admin-refund:${payment.id}:${input.amountCents ?? "full"}`,
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

    await applyGatewayStatus(payment.id, result.status);

    await prisma.auditLog.create({
      data: {
        actorUserId: actor.id,
        action: "admin.order.refund",
        entityType: "order",
        entityId: order.id,
        metadata: { amountCents: input.amountCents, reason: input.reason, gatewayStatus: result.status },
      },
    });

    return prisma.order.findUniqueOrThrow({
      where: { id: order.id },
      include: { payments: true },
    });
  }

  async listWebhooks(
    userId: string,
    filters: { provider?: string; status?: string },
    limit = 50,
  ): Promise<any> {
    await this.platformAccess.assertStaff(userId);

    return prisma.webhookDelivery.findMany({
      where: {
        provider: filters.provider,
        status: filters.status as never,
      },
      orderBy: { receivedAt: "desc" },
      take: Math.min(limit, 200),
    });
  }

  async getQueuesHealth(userId: string) {
    await this.platformAccess.assertStaff(userId);

    const [reservation, outbox, payment, order, notification, outboxRows] = await Promise.all([
      this.reservationQueue.getJobCounts(),
      this.outboxQueue.getJobCounts(),
      this.paymentQueue.getJobCounts(),
      this.orderQueue.getJobCounts(),
      this.notificationQueue.getJobCounts(),
      prisma.outboxEvent.groupBy({ by: ["status"], _count: { _all: true } }),
    ]);

    return {
      queues: { reservation, outbox, payment, order, notification },
      outboxEvents: Object.fromEntries(outboxRows.map((r) => [r.status, r._count._all])),
    };
  }

  async blockTicket(ticketId: string, userId: string, input: BlockReasonInput) {
    const actor = await this.platformAccess.assertAdmin(userId);

    const ticket = await prisma.ticket.findUnique({ where: { id: ticketId } });
    if (!ticket) throw new NotFoundException("Ingresso não encontrado");
    if (ticket.status === "CANCELED" || ticket.status === "REFUNDED") {
      throw new BadRequestException("Ingresso já está cancelado");
    }

    const updated = await prisma.ticket.update({
      where: { id: ticketId },
      data: { status: "CANCELED", canceledAt: new Date() },
    });

    await prisma.auditLog.create({
      data: {
        actorUserId: actor.id,
        action: "admin.ticket.block",
        entityType: "ticket",
        entityId: ticketId,
        metadata: { reason: input.reason, previousStatus: ticket.status },
      },
    });

    return updated;
  }

  async listAuditLogs(
    userId: string,
    filters: { entityType?: string; entityId?: string; organizationId?: string },
    limit = 50,
  ): Promise<any> {
    await this.platformAccess.assertStaff(userId);

    return prisma.auditLog.findMany({
      where: {
        entityType: filters.entityType,
        entityId: filters.entityId,
        organizationId: filters.organizationId,
      },
      orderBy: { createdAt: "desc" },
      take: Math.min(limit, 200),
    });
  }
}
