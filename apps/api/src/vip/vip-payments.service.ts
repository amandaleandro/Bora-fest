import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { PERMISSIONS } from "@borafest/auth";
import { Prisma, prisma, type VipPaymentRow } from "@borafest/database";
import {
  applyVipGatewayStatus,
  AsaasApiError,
  CircuitOpenError,
  GatewayTimeoutError,
  getFallbackGatewayForMethod,
  getGateway,
  getGatewayForMethod,
} from "@borafest/payments";
import type { ConfigureVipDepositInput, CreatePixPaymentInput } from "@borafest/contracts";
import { IdempotencyService } from "../common/idempotency.service";
import { OrgAccessService } from "../common/org-access.service";

type QueryDb = Pick<Prisma.TransactionClient, "$queryRaw">;

type VipPayableContext = {
  id: string;
  publicToken: string;
  status: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  totalCents: number;
  depositCents: number | null;
  paymentDueAt: Date | null;
  eventTitle: string;
  eventStartsAt: Date;
  eventEndsAt: Date;
  organizationId: string;
};

function assertMinimumCharge(amountCents: number): void {
  const minimum = Number(process.env.PAYMENT_MIN_CHARGE_CENTS ?? 500);
  if (amountCents < minimum) {
    const formatted = (minimum / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
    throw new BadRequestException(`O sinal mínimo para pagamento online é ${formatted}`);
  }
}

function toApiError(error: unknown): never {
  if (error instanceof CircuitOpenError || error instanceof GatewayTimeoutError) {
    throw new ServiceUnavailableException(
      "Pagamento indisponível no momento — tente novamente em alguns segundos",
    );
  }
  if (error instanceof AsaasApiError && error.status >= 400 && error.status < 500) {
    const body = error.body as { errors?: Array<{ description?: string }> } | undefined;
    throw new BadRequestException(
      body?.errors?.[0]?.description ?? "O provedor recusou a cobrança — confira os dados do pagador",
    );
  }
  throw error;
}

@Injectable()
export class VipPaymentsService {
  private readonly logger = new Logger(VipPaymentsService.name);

  constructor(
    private readonly idempotency: IdempotencyService,
    private readonly orgAccess: OrgAccessService,
  ) {}

  async configureDeposit(
    reservationId: string,
    actorUserId: string,
    input: ConfigureVipDepositInput,
  ) {
    const reservation = await prisma.vipReservation.findUnique({
      where: { id: reservationId },
      include: { inventory: { include: { event: true } } },
    });
    if (!reservation) throw new NotFoundException("Reserva VIP não encontrada");
    await this.orgAccess.assertPermission(
      reservation.inventory.event.organizationId,
      actorUserId,
      PERMISSIONS.EVENT_CREATE,
    );
    if (reservation.status !== "CONFIRMED") {
      throw new ConflictException("Configure o sinal somente depois de confirmar a reserva");
    }
    if (input.depositCents > reservation.totalCents) {
      throw new BadRequestException("O sinal não pode superar o valor total da reserva");
    }

    const dueAt = input.paymentDueAt ? new Date(input.paymentDueAt) : null;
    if (dueAt && dueAt.getTime() <= Date.now()) {
      throw new BadRequestException("O prazo de pagamento precisa estar no futuro");
    }
    if (dueAt && dueAt >= reservation.inventory.event.startsAt) {
      throw new BadRequestException("O prazo do sinal precisa terminar antes do início do evento");
    }

    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM vip_reservations WHERE id = ${reservationId}::uuid FOR UPDATE`;
      const currentRows = await tx.$queryRaw<Array<{ depositCents: number | null }>>`
        SELECT deposit_cents AS "depositCents"
        FROM vip_reservations
        WHERE id = ${reservationId}::uuid
      `;
      const current = currentRows[0]?.depositCents ?? null;
      const activeRows = await tx.$queryRaw<Array<{ count: bigint }>>`
        SELECT COUNT(*)::bigint AS count
        FROM vip_payments
        WHERE vip_reservation_id = ${reservationId}::uuid
          AND status IN (
            'PENDING'::"PaymentStatus", 'AUTHORIZED'::"PaymentStatus",
            'PAID'::"PaymentStatus", 'REFUND_PENDING'::"PaymentStatus"
          )
      `;
      const activePayments = Number(activeRows[0]?.count ?? 0n);
      const nextDeposit = input.depositCents === 0 ? null : input.depositCents;
      if (activePayments > 0 && nextDeposit !== current) {
        throw new ConflictException("O valor do sinal não pode mudar enquanto existe pagamento ativo ou pago");
      }

      await tx.$executeRaw`
        UPDATE vip_reservations
        SET deposit_cents = ${nextDeposit}, payment_due_at = ${nextDeposit ? dueAt : null}, updated_at = CURRENT_TIMESTAMP
        WHERE id = ${reservationId}::uuid
      `;
      await tx.auditLog.create({
        data: {
          actorUserId,
          organizationId: reservation.inventory.event.organizationId,
          action: "vip.deposit.configured",
          entityType: "VipReservation",
          entityId: reservationId,
          metadata: { depositCents: nextDeposit, paymentDueAt: nextDeposit ? dueAt?.toISOString() ?? null : null },
        },
      });
    });

    return this.paymentSummaryByReservationId(reservationId);
  }

  async createPix(
    publicToken: string,
    input: CreatePixPaymentInput,
    idempotencyKey?: string,
  ) {
    return this.idempotency.run(
      idempotencyKey,
      "vip-payments:create-pix",
      { publicToken, ...input },
      async () => {
        const setup = await prisma.$transaction(async (tx) => {
          await tx.$queryRaw`SELECT id FROM vip_reservations WHERE public_token = ${publicToken}::uuid FOR UPDATE`;
          const context = await this.contextByToken(publicToken, tx);
          if (!context) throw new NotFoundException("Reserva VIP não encontrada");
          if (context.status !== "CONFIRMED") {
            throw new ConflictException("A reserva precisa estar confirmada antes do pagamento");
          }
          if (!context.depositCents || context.depositCents <= 0) {
            throw new ConflictException("A Casa ainda não definiu um sinal para esta reserva");
          }
          if (context.paymentDueAt && context.paymentDueAt.getTime() <= Date.now()) {
            throw new ConflictException("O prazo para pagamento do sinal terminou");
          }

          const paidCents = await this.paidCents(context.id, tx);
          const dueCents = Math.max(0, Math.min(context.depositCents, context.totalCents) - paidCents);
          if (dueCents <= 0) throw new ConflictException("O sinal desta reserva já está pago");
          assertMinimumCharge(dueCents);

          const existing = await this.pendingPayment(context.id, tx);
          if (existing?.pixQrCodeText) return { context, existing, paymentId: existing.id, dueCents };

          const gateway = getGatewayForMethod("PIX");
          const paymentId = randomUUID();
          await tx.$executeRaw`
            INSERT INTO vip_payments (
              id, vip_reservation_id, provider, method, status, amount_cents, created_at, updated_at
            ) VALUES (
              ${paymentId}::uuid, ${context.id}::uuid, ${gateway.provider}, 'PIX'::"PaymentMethod",
              'PENDING'::"PaymentStatus", ${dueCents}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
            )
          `;
          return { context, existing: null as VipPaymentRow | null, paymentId, dueCents };
        });

        if (setup.existing) return this.toPublicPayment(setup.existing);

        const gateway = getGatewayForMethod("PIX");
        const defaultExpiry = Math.max(60, Number(process.env.VIP_PIX_EXPIRES_SECONDS ?? 1800));
        const dueSeconds = setup.context.paymentDueAt
          ? Math.floor((setup.context.paymentDueAt.getTime() - Date.now()) / 1000)
          : defaultExpiry;
        const expiresInSeconds = Math.max(60, Math.min(defaultExpiry, dueSeconds));
        const request = {
          paymentId: setup.paymentId,
          orderId: setup.context.id,
          amountCents: setup.dueCents,
          customer: {
            name: setup.context.contactName,
            email: setup.context.contactEmail,
            document: input.payerDocument,
            phone: input.payerPhone || setup.context.contactPhone,
          },
          expiresInSeconds,
          idempotencyKey: setup.paymentId,
          description: `Reserva VIP ${setup.context.eventTitle}`.slice(0, 90) + " · BoraFest",
        };

        let charge;
        let used = gateway;
        try {
          charge = await gateway.createPixCharge(request);
        } catch (error) {
          const fallback = getFallbackGatewayForMethod("PIX");
          if (!fallback) {
            await this.markFailed(setup.paymentId, error);
            toApiError(error);
          }
          this.logger.error(`Pix VIP falhou em ${gateway.provider}; tentando reserva ${fallback!.provider}`);
          try {
            charge = await fallback!.createPixCharge(request);
            used = fallback!;
          } catch {
            await this.markFailed(setup.paymentId, error);
            toApiError(error);
          }
        }

        await prisma.$executeRaw`
          UPDATE vip_payments
          SET provider = ${used.provider}, external_id = ${charge!.externalId},
              pix_qr_code_text = ${charge!.qrCodeText}, expires_at = ${charge!.expiresAt},
              updated_at = CURRENT_TIMESTAMP
          WHERE id = ${setup.paymentId}::uuid
        `;
        const payment = await this.paymentById(setup.paymentId);
        if (!payment) throw new NotFoundException("Pagamento VIP não encontrado após criação");
        return this.toPublicPayment(payment);
      },
    );
  }

  async sync(publicToken: string) {
    const context = await this.contextByToken(publicToken);
    if (!context) throw new NotFoundException("Reserva VIP não encontrada");
    const rows = await prisma.$queryRaw<VipPaymentRow[]>`
      SELECT
        id, vip_reservation_id AS "vipReservationId", provider, method, status,
        amount_cents AS "amountCents", external_id AS "externalId",
        pix_qr_code_text AS "pixQrCodeText", fail_reason AS "failReason",
        expires_at AS "expiresAt", paid_at AS "paidAt", metadata,
        created_at AS "createdAt", updated_at AS "updatedAt"
      FROM vip_payments
      WHERE vip_reservation_id = ${context.id}::uuid
        AND status IN ('PENDING'::"PaymentStatus", 'AUTHORIZED'::"PaymentStatus")
        AND external_id IS NOT NULL
      ORDER BY created_at DESC
      LIMIT 1
    `;
    const payment = rows[0];
    if (!payment?.externalId) return { synced: false };
    try {
      const gateway = getGateway(payment.provider);
      const status = await gateway.getStatus(payment.externalId);
      if (status !== "PENDING") await applyVipGatewayStatus(payment.id, status);
      return { synced: true, status };
    } catch (error) {
      this.logger.warn(`sync do Pix VIP ${payment.id} falhou: ${String(error)}`);
      return { synced: false };
    }
  }

  async paymentSummaryByToken(publicToken: string) {
    const context = await this.contextByToken(publicToken);
    if (!context) throw new NotFoundException("Reserva VIP não encontrada");
    return this.buildSummary(context);
  }

  async paymentSummaryByReservationId(reservationId: string) {
    const rows = await prisma.$queryRaw<VipPayableContext[]>`
      SELECT
        vr.id, vr.public_token AS "publicToken", vr.status::text AS status,
        vr.contact_name AS "contactName", vr.contact_email AS "contactEmail", vr.contact_phone AS "contactPhone",
        vr.total_cents AS "totalCents", vr.deposit_cents AS "depositCents", vr.payment_due_at AS "paymentDueAt",
        e.title AS "eventTitle", e.starts_at AS "eventStartsAt", e.ends_at AS "eventEndsAt",
        e.organization_id AS "organizationId"
      FROM vip_reservations vr
      JOIN vip_inventory vi ON vi.id = vr.vip_inventory_id
      JOIN events e ON e.id = vi.event_id
      WHERE vr.id = ${reservationId}::uuid
    `;
    const context = rows[0];
    if (!context) throw new NotFoundException("Reserva VIP não encontrada");
    return this.buildSummary(context);
  }

  private async buildSummary(context: VipPayableContext) {
    const paidCents = await this.paidCents(context.id);
    const pending = await this.pendingPayment(context.id);
    return {
      depositCents: context.depositCents,
      paymentDueAt: context.paymentDueAt,
      paidCents,
      depositRemainingCents: Math.max(0, (context.depositCents ?? 0) - paidCents),
      totalRemainingCents: Math.max(0, context.totalCents - paidCents),
      latestPayment: pending ? this.toPublicPayment(pending) : null,
    };
  }

  private async contextByToken(publicToken: string, db: QueryDb = prisma) {
    const rows = await db.$queryRaw<VipPayableContext[]>`
      SELECT
        vr.id, vr.public_token AS "publicToken", vr.status::text AS status,
        vr.contact_name AS "contactName", vr.contact_email AS "contactEmail", vr.contact_phone AS "contactPhone",
        vr.total_cents AS "totalCents", vr.deposit_cents AS "depositCents", vr.payment_due_at AS "paymentDueAt",
        e.title AS "eventTitle", e.starts_at AS "eventStartsAt", e.ends_at AS "eventEndsAt",
        e.organization_id AS "organizationId"
      FROM vip_reservations vr
      JOIN vip_inventory vi ON vi.id = vr.vip_inventory_id
      JOIN events e ON e.id = vi.event_id
      WHERE vr.public_token = ${publicToken}::uuid
    `;
    return rows[0] ?? null;
  }

  private async paidCents(reservationId: string, db: QueryDb = prisma) {
    const rows = await db.$queryRaw<Array<{ paidCents: bigint }>>`
      SELECT COALESCE(SUM(amount_cents), 0)::bigint AS "paidCents"
      FROM vip_payments
      WHERE vip_reservation_id = ${reservationId}::uuid AND status = 'PAID'::"PaymentStatus"
    `;
    return Number(rows[0]?.paidCents ?? 0n);
  }

  private async pendingPayment(reservationId: string, db: QueryDb = prisma) {
    const rows = await db.$queryRaw<VipPaymentRow[]>`
      SELECT
        id, vip_reservation_id AS "vipReservationId", provider, method, status,
        amount_cents AS "amountCents", external_id AS "externalId",
        pix_qr_code_text AS "pixQrCodeText", fail_reason AS "failReason",
        expires_at AS "expiresAt", paid_at AS "paidAt", metadata,
        created_at AS "createdAt", updated_at AS "updatedAt"
      FROM vip_payments
      WHERE vip_reservation_id = ${reservationId}::uuid
        AND status IN ('PENDING'::"PaymentStatus", 'AUTHORIZED'::"PaymentStatus")
        AND external_id IS NOT NULL
        AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)
      ORDER BY created_at DESC
      LIMIT 1
    `;
    return rows[0] ?? null;
  }

  private async paymentById(id: string) {
    const rows = await prisma.$queryRaw<VipPaymentRow[]>`
      SELECT
        id, vip_reservation_id AS "vipReservationId", provider, method, status,
        amount_cents AS "amountCents", external_id AS "externalId",
        pix_qr_code_text AS "pixQrCodeText", fail_reason AS "failReason",
        expires_at AS "expiresAt", paid_at AS "paidAt", metadata,
        created_at AS "createdAt", updated_at AS "updatedAt"
      FROM vip_payments WHERE id = ${id}::uuid
    `;
    return rows[0] ?? null;
  }

  private async markFailed(id: string, error: unknown) {
    const message = error instanceof Error ? error.message.slice(0, 500) : "Falha ao criar cobrança";
    await prisma.$executeRaw`
      UPDATE vip_payments
      SET status = 'FAILED'::"PaymentStatus", fail_reason = ${message}, updated_at = CURRENT_TIMESTAMP
      WHERE id = ${id}::uuid AND status = 'PENDING'::"PaymentStatus"
    `;
  }

  private toPublicPayment(payment: VipPaymentRow) {
    return {
      id: payment.id,
      method: payment.method,
      status: payment.status,
      amountCents: payment.amountCents,
      pixQrCodeText: payment.pixQrCodeText,
      failReason: payment.failReason,
      expiresAt: payment.expiresAt,
      paidAt: payment.paidAt,
    };
  }
}
