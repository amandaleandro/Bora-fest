import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { prisma } from "@borafest/database";
import { applyGatewayStatus, getDefaultGateway } from "@borafest/payments";
import type { CreateCardPaymentInput, CreatePixPaymentInput } from "@borafest/contracts";
import { IdempotencyService } from "../common/idempotency.service";

@Injectable()
export class PaymentsService {
  constructor(private readonly idempotency: IdempotencyService) {}

  async createPix(orderId: string, input: CreatePixPaymentInput, idempotencyKey?: string) {
    return this.idempotency.run(
      idempotencyKey,
      "payments:create-pix",
      { orderId, ...input },
      async () => {
        const order = await this.loadPayableOrder(orderId);

        // reaproveita cobrança Pix pendente e ainda válida (evita QR duplicado)
        const existing = await prisma.payment.findFirst({
          where: {
            orderId,
            method: "PIX",
            status: "PENDING",
            expiresAt: { gt: new Date() },
          },
          orderBy: { createdAt: "desc" },
        });
        if (existing?.pixQrCodeText) {
          return this.toPublicPayment(existing);
        }

        const gateway = getDefaultGateway();
        const expiresInSeconds = Math.max(
          60,
          Math.floor(((order.expiresAt?.getTime() ?? Date.now() + 15 * 60_000) - Date.now()) / 1000),
        );

        const payment = await prisma.payment.create({
          data: {
            orderId,
            provider: gateway.provider,
            method: "PIX",
            amountCents: order.totalCents,
            metadata: input.payerDocument ? { payerDocument: input.payerDocument } : undefined,
          },
        });

        const charge = await gateway.createPixCharge({
          paymentId: payment.id,
          orderId,
          amountCents: order.totalCents,
          customer: {
            name: order.contactName ?? undefined,
            email: order.contactEmail,
            document: input.payerDocument,
          },
          expiresInSeconds,
          idempotencyKey: payment.id,
        });

        const updated = await prisma.payment.update({
          where: { id: payment.id },
          data: {
            externalId: charge.externalId,
            pixQrCodeText: charge.qrCodeText,
            expiresAt: charge.expiresAt,
          },
        });

        await this.ensureOrderPending(orderId);

        return this.toPublicPayment(updated);
      },
    );
  }

  async createCard(orderId: string, input: CreateCardPaymentInput, idempotencyKey?: string) {
    return this.idempotency.run(
      idempotencyKey,
      "payments:create-card",
      { orderId, cardToken: input.cardToken, installments: input.installments },
      async () => {
        const order = await this.loadPayableOrder(orderId);
        const gateway = getDefaultGateway();

        const payment = await prisma.payment.create({
          data: {
            orderId,
            provider: gateway.provider,
            method: "CARD",
            amountCents: order.totalCents,
            installments: input.installments,
          },
        });

        const result = await gateway.createCardPayment({
          paymentId: payment.id,
          orderId,
          amountCents: order.totalCents,
          cardToken: input.cardToken,
          installments: input.installments,
          customer: {
            name: order.contactName ?? undefined,
            email: order.contactEmail,
            document: input.payerDocument,
          },
          idempotencyKey: payment.id,
        });

        await prisma.payment.update({
          where: { id: payment.id },
          data: {
            externalId: result.externalId,
            failReason: result.failReason,
          },
        });

        await this.ensureOrderPending(orderId);

        // cartão responde na hora: aplica o resultado pelo mesmo caminho
        // idempotente dos webhooks
        await applyGatewayStatus(payment.id, result.status);

        const finalPayment = await prisma.payment.findUniqueOrThrow({
          where: { id: payment.id },
        });
        return this.toPublicPayment(finalPayment);
      },
    );
  }

  private async loadPayableOrder(orderId: string) {
    const order = await prisma.order.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundException("Pedido não encontrado");
    if (order.status !== "CREATED" && order.status !== "PAYMENT_PENDING") {
      throw new BadRequestException("Pedido não está aguardando pagamento");
    }
    if (order.expiresAt && order.expiresAt.getTime() <= Date.now()) {
      throw new BadRequestException("Janela de pagamento do pedido expirou");
    }
    return order;
  }

  private async ensureOrderPending(orderId: string): Promise<void> {
    await prisma.order.updateMany({
      where: { id: orderId, status: "CREATED" },
      data: { status: "PAYMENT_PENDING" },
    });
  }

  /** Nunca expor metadata/ids internos do gateway além do necessário. */
  private toPublicPayment(payment: {
    id: string;
    orderId: string;
    provider: string;
    method: string;
    status: string;
    amountCents: number;
    pixQrCodeText: string | null;
    installments: number | null;
    failReason: string | null;
    expiresAt: Date | null;
    paidAt: Date | null;
  }) {
    return {
      id: payment.id,
      orderId: payment.orderId,
      provider: payment.provider,
      method: payment.method,
      status: payment.status,
      amountCents: payment.amountCents,
      pixQrCodeText: payment.pixQrCodeText,
      installments: payment.installments,
      failReason: payment.failReason,
      expiresAt: payment.expiresAt,
      paidAt: payment.paidAt,
    };
  }
}
