import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { prisma } from "@borafest/database";
import { applyGatewayStatus, getGateway } from "@borafest/payments";
import { executeOrderRefund } from "../common/execute-refund";
import {
  createNotificationDeliveryQueue,
  createOrderExpirationQueue,
  createOutboxDispatchQueue,
  createPaymentReconciliationQueue,
  createReservationExpirationQueue,
} from "@borafest/queues";
import type {
  ApproveRefundRequestInput,
  BlockReasonInput,
  RefundOrderInput,
  RejectRefundRequestInput,
  SetOrganizationFeeInput,
} from "@borafest/contracts";
import { FinanceService } from "../finance/finance.service";
import { PlatformAccessService } from "../common/platform-access.service";
import { generateOtpCode, hashOtpCode, verifyOtpCode } from "@borafest/auth";
import { NotificationsService } from "../notifications/notifications.service";
import { getOrganizationBalanceCents, getPayoutAvailability } from "../common/ledger";

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
    private readonly finance: FinanceService,
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

  /**
   * Aprovação do cadastro (2026-08-11): toda organização nasce
   * PENDING_VERIFICATION e NADA no sistema promovia para ACTIVE — só o
   * "desbloquear", que na tela só aparece para quem estava BLOCKED. Resultado:
   * a casa vendia normalmente, o dinheiro entrava e o saque ficava travado
   * para sempre, sem botão que resolvesse. Este é o passo explícito de
   * conferência de cadastro/KYC que destrava o repasse.
   */
  async approveOrganization(organizationId: string, userId: string) {
    // staff PRIMEIRO (auditoria 2026-08-29): antes consultava e respondia sobre
    // a organização antes de checar quem pergunta
    await this.platformAccess.assertStaff(userId);
    const organization = await prisma.organization.findUnique({ where: { id: organizationId } });
    if (!organization) throw new NotFoundException("Organização não encontrada");
    if (organization.status === "BLOCKED") {
      throw new BadRequestException(
        "Organização bloqueada — use desbloquear (aprovar não passa por cima de bloqueio)",
      );
    }
    return this.setOrganizationStatus(organizationId, userId, "ACTIVE", "cadastro aprovado");
  }

  /**
   * Exclusão de conta em DUAS etapas (pedido do Arthur 2026-08-14): etapa 1
   * gera um código de 6 dígitos e envia ao E-MAIL DO ADMIN LOGADO pela fila de
   * notificações (mesmo template do OTP de login). Reusa OtpChallenge — o
   * destination composto isola do OTP de login e amarra código→org→admin.
   */
  async requestOrganizationDeleteCode(organizationId: string, userId: string) {
    const actor = await this.platformAccess.assertAdmin(userId);
    const organization = await prisma.organization.findUnique({ where: { id: organizationId } });
    if (!organization) throw new NotFoundException("Organização não encontrada");
    if (!actor.email) throw new BadRequestException("Sua conta de admin não tem e-mail para receber o código");

    const code = generateOtpCode();
    const destination = `org-delete:${organizationId}:${actor.email}`;
    await prisma.$transaction([
      prisma.otpChallenge.create({
        data: {
          userId: actor.id,
          destination,
          channel: "EMAIL",
          codeHash: hashOtpCode(code, destination),
          expiresAt: new Date(Date.now() + 10 * 60 * 1000),
        },
      }),
      prisma.notification.create({
        data: { channel: "EMAIL", recipient: actor.email, template: "otp_code", payload: { code, ttlMinutes: 10 } },
      }),
      prisma.auditLog.create({
        data: {
          actorUserId: actor.id,
          action: "admin.organization.delete_code",
          entityType: "organization",
          entityId: organizationId,
        },
      }),
    ]);
    return { sent: true, ttlMinutes: 10 };
  }

  /**
   * Etapa 2: confere o código e exclui. TRAVA DURA: organização com histórico
   * financeiro (venda paga, repasse ou lançamento no ledger) NUNCA é excluída —
   * o rastro fiscal/contábil fica; o caminho para essas é BLOQUEAR.
   */
  async deleteOrganization(organizationId: string, userId: string, input: { code: string }) {
    const actor = await this.platformAccess.assertAdmin(userId);
    const organization = await prisma.organization.findUnique({ where: { id: organizationId } });
    if (!organization) throw new NotFoundException("Organização não encontrada");

    const destination = `org-delete:${organizationId}:${actor.email}`;
    const challenge = await prisma.otpChallenge.findFirst({
      where: { destination, consumedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: "desc" },
    });
    if (!challenge) {
      throw new BadRequestException("Código expirado — gere um novo");
    }
    // reivindica a tentativa atomicamente (auditoria 2026-08-30): mesmo TOCTOU
    // do login — sem isto, verificações paralelas furam o teto de 5. Exclusão
    // de organização é destrutiva; força-bruta do código aqui é inaceitável.
    const claim = await prisma.otpChallenge.updateMany({
      where: { id: challenge.id, consumedAt: null, attempts: { lt: 5 } },
      data: { attempts: { increment: 1 } },
    });
    if (claim.count === 0) {
      throw new BadRequestException("Código expirado — gere um novo");
    }
    if (!verifyOtpCode(input.code, destination, challenge.codeHash)) {
      throw new BadRequestException("Código incorreto");
    }
    await prisma.otpChallenge.update({ where: { id: challenge.id }, data: { consumedAt: new Date() } });

    const [paidOrders, payouts, ledgerEntries] = await Promise.all([
      prisma.order.count({
        where: {
          event: { organizationId },
          status: { in: ["PAID", "FULFILLED", "REFUNDED", "PARTIALLY_REFUNDED", "CHARGEBACK"] },
        },
      }),
      prisma.payout.count({ where: { organizationId } }),
      prisma.ledgerEntry.count({ where: { ledgerAccount: { organizationId } } }),
    ]);
    if (paidOrders > 0 || payouts > 0 || ledgerEntries > 0) {
      throw new BadRequestException(
        "Organização tem histórico financeiro (vendas pagas/repasse/ledger) — bloqueie em vez de excluir",
      );
    }

    // Limpeza transacional: pedidos NÃO-pagos de teste (CREATED/EXPIRED/…)
    // travavam o delete por FKs sem cascade (Order.reservation, RefundRequest,
    // PushToken → era o 500). Removemos o lixo explicitamente — com uma trava
    // extra: pagamento com movimentação de dinheiro em QUALQUER estado bloqueia.
    await prisma.$transaction(async (tx) => {
      const eventIds = (
        await tx.event.findMany({ where: { organizationId }, select: { id: true } })
      ).map((e) => e.id);
      if (eventIds.length > 0) {
        const orderIds = (
          await tx.order.findMany({ where: { eventId: { in: eventIds } }, select: { id: true } })
        ).map((o) => o.id);
        if (orderIds.length > 0) {
          const moneyPayments = await tx.payment.count({
            where: {
              orderId: { in: orderIds },
              status: { in: ["PAID", "AUTHORIZED", "REFUND_PENDING", "REFUNDED", "CHARGEBACK"] },
            },
          });
          if (moneyPayments > 0) {
            throw new BadRequestException(
              "Organização tem pagamentos com movimentação — bloqueie em vez de excluir",
            );
          }
          // ORDEM PROVADA pelo teste de FKs (scratchpad/fk_delete_test.py):
          // tudo que aponta pra Order/TicketLot SEM cascade sai antes.
          await tx.refundRequest.deleteMany({ where: { orderId: { in: orderIds } } });
          await tx.pushToken.deleteMany({ where: { orderId: { in: orderIds } } });
          await tx.payment.deleteMany({ where: { orderId: { in: orderIds } } }); // Payment→Order é RESTRICT (era o 500)
          await tx.ticket.deleteMany({ where: { orderId: { in: orderIds } } }); // teoricamente vazio (guard barra pago) — cinto de segurança
          await tx.order.deleteMany({ where: { id: { in: orderIds } } });
        }
        // Restrict contra TicketLot no MESMO cascade do evento: sai explícito antes
        await tx.reservationItem.deleteMany({ where: { reservation: { eventId: { in: eventIds } } } });
        await tx.reservation.deleteMany({ where: { eventId: { in: eventIds } } });
        await tx.guestListEntry.deleteMany({ where: { eventId: { in: eventIds } } });
      }
      // auditoria ANTES do delete (entityId é string, sem FK — sobrevive à exclusão)
      await tx.auditLog.create({
        data: {
          actorUserId: actor.id,
          action: "admin.organization.delete",
          entityType: "organization",
          entityId: organizationId,
          metadata: { name: organization.name, document: organization.document, status: organization.status },
        },
      });
      await tx.organization.delete({ where: { id: organizationId } });
    });
    return { deleted: true };
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
        action:
          status === "BLOCKED"
            ? "admin.organization.block"
            : reason === "cadastro aprovado"
              ? "admin.organization.approve"
              : "admin.organization.unblock",
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

    const { order, gatewayStatus } = await executeOrderRefund(publicToken, {
      amountCents: input.amountCents,
      idempotencyPrefix: "admin-refund",
    });

    await prisma.auditLog.create({
      data: {
        actorUserId: actor.id,
        action: "admin.order.refund",
        entityType: "order",
        entityId: order.id,
        metadata: { amountCents: input.amountCents, reason: input.reason, gatewayStatus },
      },
    });

    return prisma.order.findUniqueOrThrow({
      where: { id: order.id },
      include: {
        payments: {
          orderBy: { createdAt: "desc" },
          select: { id: true, provider: true, method: true, status: true, amountCents: true, createdAt: true, paidAt: true },
        },
      },
    });
  }

  async listRefundRequests(userId: string, filters: { status?: string }) {
    await this.platformAccess.assertStaff(userId);

    return prisma.refundRequest.findMany({
      where: filters.status ? { status: filters.status as any } : undefined,
      orderBy: { requestedAt: "desc" },
      include: {
        order: {
          select: { id: true, publicToken: true, contactEmail: true, contactName: true, totalCents: true, status: true },
        },
      },
    });
  }

  /** Aprovação: dispara o estorno de verdade reusando `refundOrder` (mesmo gateway). */
  async approveRefundRequest(id: string, userId: string, input: ApproveRefundRequestInput) {
    // 403-primeiro (auditoria 2026-08-12): sem isto, um SUPPORT recebia 404/400
    // do pedido ANTES do 403, vazando o estado da fila para quem não pode agir.
    const actor = await this.platformAccess.assertAdmin(userId);

    const request = await prisma.refundRequest.findUnique({
      where: { id },
      include: { order: { select: { publicToken: true } } },
    });
    if (!request) throw new NotFoundException("Pedido de reembolso não encontrado");
    if (request.status !== "PENDING") {
      throw new BadRequestException("Este pedido de reembolso já foi resolvido");
    }

    const order = await this.refundOrder(request.order.publicToken, userId, {
      amountCents: input.amountCents,
      reason: request.reason,
    });

    await prisma.refundRequest.update({
      where: { id },
      data: { status: "APPROVED", resolvedAt: new Date(), resolvedByUserId: userId },
    });

    // auditoria simétrica ao reject e ao lado do produtor: aprovação de reembolso
    // do comprador passa a ser rastreável por entityType=refund_request
    await prisma.auditLog.create({
      data: {
        actorUserId: actor.id,
        action: "admin.refund-request.approve",
        entityType: "refund_request",
        entityId: id,
        metadata: { orderId: order.id, amountCents: input.amountCents ?? null },
      },
    });

    return order;
  }

  async rejectRefundRequest(id: string, userId: string, input: RejectRefundRequestInput) {
    const actor = await this.platformAccess.assertAdmin(userId);

    const request = await prisma.refundRequest.findUnique({ where: { id } });
    if (!request) throw new NotFoundException("Pedido de reembolso não encontrado");
    if (request.status !== "PENDING") {
      throw new BadRequestException("Este pedido de reembolso já foi resolvido");
    }

    const updated = await prisma.refundRequest.update({
      where: { id },
      data: {
        status: "REJECTED",
        resolvedAt: new Date(),
        resolvedByUserId: userId,
        resolutionNote: input.note,
      },
    });

    await prisma.auditLog.create({
      data: {
        actorUserId: actor.id,
        action: "admin.refund-request.reject",
        entityType: "refund_request",
        entityId: id,
        metadata: { note: input.note },
      },
    });

    return updated;
  }

  async listWebhooks(
    userId: string,
    filters: { provider?: string; status?: string },
    limit = 50,
  ): Promise<any> {
    await this.platformAccess.assertStaff(userId);

    // defesa em profundidade (auditoria 2026-08-29): o rawBody pode conter PII
    // do pagamento; os headers já entram sanitizados pelo worker. A lista do
    // backoffice mostra o resumo, não o corpo cru.
    return prisma.webhookDelivery.findMany({
      where: {
        provider: filters.provider,
        status: filters.status as never,
      },
      select: {
        id: true, provider: true, eventType: true, externalEventId: true,
        signatureValid: true, status: true, error: true,
        receivedAt: true, processedAt: true,
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

  async getOrganizationLedger(organizationId: string, userId: string, limit = 50): Promise<any> {
    await this.platformAccess.assertStaff(userId);

    const organization = await prisma.organization.findUnique({ where: { id: organizationId } });
    if (!organization) throw new NotFoundException("Organização não encontrada");

    const ledgerAccount = await prisma.ledgerAccount.findUnique({ where: { organizationId } });
    const [balanceCents, availableForPayoutCents, entries] = await Promise.all([
      getOrganizationBalanceCents(organizationId),
      getPayoutAvailability(organizationId).then((a) => a.availableForPayoutCents),
      ledgerAccount
        ? prisma.ledgerEntry.findMany({
            where: { ledgerAccountId: ledgerAccount.id },
            orderBy: { createdAt: "desc" },
            take: Math.min(limit, 200),
          })
        : Promise.resolve([]),
    ]);

    return { organizationId, balanceCents, availableForPayoutCents, entries };
  }

  async listPayouts(userId: string, filters: { organizationId?: string; status?: string }) {
    await this.platformAccess.assertStaff(userId);

    return prisma.payout.findMany({
      where: {
        organizationId: filters.organizationId,
        status: filters.status as never,
      },
      orderBy: { requestedAt: "desc" },
      take: 100,
    });
  }

  async createPayout(organizationId: string, userId: string) {
    const actor = await this.platformAccess.assertAdmin(userId);

    const organization = await prisma.organization.findUnique({ where: { id: organizationId } });
    if (!organization) throw new NotFoundException("Organização não encontrada");
    if (organization.status !== "ACTIVE") {
      throw new BadRequestException(
        "Repasse bloqueado: organização precisa estar com KYC aprovado (status ACTIVE)",
      );
    }

    const availability = await getPayoutAvailability(organizationId);
    const availableCents = availability.availableForPayoutCents;
    if (availableCents <= 0) {
      throw new BadRequestException("Sem saldo disponível para repasse");
    }

    const payout = await prisma.payout.create({
      data: { organizationId, amountCents: availableCents, status: "PENDING" },
    });

    // INSTANT: a parcela ainda na janela de reembolso paga antecipação —
    // débito lançado junto do repasse para o extrato contar a história toda
    const anticipationFeeCents =
      availability.settlementMode === "INSTANT" ? availability.anticipationFeeCents : 0;
    if (anticipationFeeCents > 0) {
      const ledgerAccount = await prisma.ledgerAccount.upsert({
        where: { organizationId },
        update: {},
        create: { organizationId },
      });
      await prisma.ledgerEntry.create({
        data: {
          ledgerAccountId: ledgerAccount.id,
          type: "ANTICIPATION_FEE",
          amountCents: -anticipationFeeCents,
          referenceType: "payout",
          referenceId: payout.id,
          description: "Antecipação de saldo em janela de reembolso (repasse instantâneo)",
        },
      });
    }

    await prisma.auditLog.create({
      data: {
        actorUserId: actor.id,
        organizationId,
        action: "admin.payout.create",
        entityType: "payout",
        entityId: payout.id,
        metadata: {
          amountCents: availableCents,
          settlementMode: availability.settlementMode,
          anticipationFeeCents,
        },
      },
    });

    return { ...payout, anticipationFeeCents };
  }

  /**
   * Modo de repasse da organização (decisão 2026-07-28): INSTANT só deve ser
   * ligado para casas de confiança E após aceite da cláusula de
   * responsabilidade de reembolso (docs/juridico/REPASSE-INSTANTANEO-MINUTA.md).
   */
  async listPayoutRequests(userId: string, filters: { status?: string }) {
    await this.platformAccess.assertAdmin(userId);
    return prisma.payoutRequest.findMany({
      where: filters.status ? { status: filters.status as never } : undefined,
      include: { organization: { select: { id: true, name: true, settlementMode: true } } },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
  }

  async approvePayoutRequest(requestId: string, userId: string) {
    const actor = await this.platformAccess.assertAdmin(userId);
    const payoutId = await this.finance.approveRequestInternal(requestId, actor.id);
    await prisma.auditLog.create({
      data: {
        actorUserId: actor.id,
        action: "payout.request_approved",
        entityType: "payout_request",
        entityId: requestId,
        metadata: { payoutId },
      },
    });
    return { requestId, payoutId };
  }

  async rejectPayoutRequest(requestId: string, userId: string, note?: string) {
    const actor = await this.platformAccess.assertAdmin(userId);
    const request = await prisma.payoutRequest.findUniqueOrThrow({ where: { id: requestId } });
    if (request.status !== "PENDING") throw new BadRequestException("Solicitação já resolvida");
    await prisma.payoutRequest.update({
      where: { id: requestId },
      data: { status: "REJECTED", resolvedAt: new Date(), notes: note ?? null },
    });
    await prisma.auditLog.create({
      data: {
        actorUserId: actor.id,
        action: "payout.request_rejected",
        entityType: "payout_request",
        entityId: requestId,
        metadata: { note: note ?? null },
      },
    });
    return { requestId, status: "REJECTED" };
  }

  async updateSettlement(
    organizationId: string,
    userId: string,
    input: {
      settlementMode?: "STANDARD" | "INSTANT";
      autoPayout?: boolean;
      refundHoldDays?: number;
      autoPayoutMinCents?: number | null;
    },
  ) {
    const actor = await this.platformAccess.assertAdmin(userId);

    const organization = await prisma.organization.findUnique({ where: { id: organizationId } });
    if (!organization) throw new NotFoundException("Organização não encontrada");
    if (input.refundHoldDays !== undefined && (input.refundHoldDays < 0 || input.refundHoldDays > 90)) {
      throw new BadRequestException("Janela de reembolso deve ficar entre 0 e 90 dias");
    }

    const updated = await prisma.organization.update({
      where: { id: organizationId },
      data: {
        ...(input.settlementMode !== undefined ? { settlementMode: input.settlementMode } : {}),
        ...(input.autoPayout !== undefined ? { autoPayout: input.autoPayout } : {}),
        ...(input.refundHoldDays !== undefined ? { refundHoldDays: input.refundHoldDays } : {}),
        ...(input.autoPayoutMinCents !== undefined ? { autoPayoutMinCents: input.autoPayoutMinCents } : {}),
      },
    });

    await prisma.auditLog.create({
      data: {
        actorUserId: actor.id,
        organizationId,
        action: "admin.organization.settlement",
        entityType: "organization",
        entityId: organizationId,
        metadata: {
          antes: {
            settlementMode: organization.settlementMode,
            autoPayout: organization.autoPayout,
            refundHoldDays: organization.refundHoldDays,
          },
          depois: {
            settlementMode: updated.settlementMode,
            autoPayout: updated.autoPayout,
            refundHoldDays: updated.refundHoldDays,
          },
        },
      },
    });

    return {
      id: updated.id,
      settlementMode: updated.settlementMode,
      autoPayout: updated.autoPayout,
      refundHoldDays: updated.refundHoldDays,
    };
  }

  async markPayoutPaid(payoutId: string, userId: string, notes?: string) {
    const actor = await this.platformAccess.assertAdmin(userId);

    const payout = await prisma.payout.findUnique({ where: { id: payoutId } });
    if (!payout) throw new NotFoundException("Repasse não encontrado");

    const updated = await prisma.payout.updateMany({
      where: { id: payoutId, status: "PENDING" },
      data: { status: "PAID", paidAt: new Date(), notes },
    });
    if (updated.count === 0) {
      throw new BadRequestException("Repasse não está pendente");
    }

    const ledgerAccount = await prisma.ledgerAccount.upsert({
      where: { organizationId: payout.organizationId },
      update: {},
      create: { organizationId: payout.organizationId },
    });

    // idempotente: nunca debitar duas vezes o mesmo repasse
    const jaDebitado = await prisma.ledgerEntry.findFirst({
      where: { ledgerAccountId: ledgerAccount.id, type: "PAYOUT_DEBIT", referenceId: payoutId },
    });
    if (jaDebitado) return prisma.payout.findUniqueOrThrow({ where: { id: payoutId } });

    await prisma.ledgerEntry.create({
      data: {
        ledgerAccountId: ledgerAccount.id,
        type: "PAYOUT_DEBIT",
        amountCents: -payout.amountCents,
        referenceType: "payout",
        referenceId: payout.id,
      },
    });

    await prisma.auditLog.create({
      data: {
        actorUserId: actor.id,
        organizationId: payout.organizationId,
        action: "admin.payout.mark_paid",
        entityType: "payout",
        entityId: payout.id,
        metadata: { amountCents: payout.amountCents, notes },
      },
    });

    return prisma.payout.findUniqueOrThrow({ where: { id: payoutId } });
  }
}
