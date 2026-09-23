import {
  BadRequestException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { prisma } from "@borafest/database";
import {
  applyStoreGatewayStatus,
  getFallbackGatewayForMethod,
  getGateway,
  getGatewayForMethod,
  AsaasApiError,
  CircuitOpenError,
  GatewayTimeoutError,
} from "@borafest/payments";
import type { CreateCardPaymentInput, CreateStorePixPaymentInput } from "@borafest/contracts";

function assertMinimumCharge(totalCents: number): void {
  const minimum = Number(process.env.PAYMENT_MIN_CHARGE_CENTS ?? 500);
  if (totalCents < minimum) {
    throw new BadRequestException(
      `O pagamento mínimo é ${(minimum / 100).toLocaleString("pt-BR", {
        style: "currency",
        currency: "BRL",
      })}`,
    );
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
      body?.errors?.[0]?.description ??
        "O provedor recusou a cobrança — confira os dados informados",
    );
  }
  throw error;
}

@Injectable()
export class StorePaymentsService {
  async createPix(publicToken: string, input: CreateStorePixPaymentInput) {
    const order = await prisma.storeOrder.findUnique({
      where: { publicToken },
      include: { organization: { select: { displayName: true, name: true } } },
    });
    if (!order) throw new NotFoundException("Pedido da Loja não encontrado");
    if (!["CREATED", "PAYMENT_PENDING"].includes(order.status)) {
      throw new BadRequestException("Pedido da Loja não está aguardando pagamento");
    }
    if (order.expiresAt.getTime() <= Date.now()) {
      throw new BadRequestException("A reserva de estoque deste pedido expirou");
    }
    assertMinimumCharge(order.totalCents);

    const existing = await prisma.storePayment.findFirst({
      where: {
        storeOrderId: order.id,
        method: "PIX",
        status: "PENDING",
        externalId: { not: null },
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: "desc" },
    });
    if (existing?.pixQrCodeText) return this.publicPayment(existing);

    const gateway = getGatewayForMethod("PIX");
    const payment = await prisma.storePayment.create({
      data: {
        storeOrderId: order.id,
        provider: gateway.provider,
        method: "PIX",
        amountCents: order.totalCents,
      },
    });

    const expiresInSeconds = Math.max(
      60,
      Math.floor((order.expiresAt.getTime() - Date.now()) / 1000),
    );
    const payload = {
      paymentId: payment.id,
      orderId: order.id,
      amountCents: order.totalCents,
      customer: {
        name: order.contactName,
        email: order.contactEmail,
        document: input.payerDocument,
        phone: input.payerPhone ?? order.contactPhone ?? undefined,
      },
      expiresInSeconds,
      idempotencyKey: payment.id,
      description: `Loja ${order.organization.displayName ?? order.organization.name} · BoraFest`.slice(0, 90),
    };

    let charge;
    let used = gateway;
    try {
      charge = await gateway.createPixCharge(payload);
    } catch (error) {
      const fallback = getFallbackGatewayForMethod("PIX");
      if (!fallback) {
        await prisma.storePayment.update({
          where: { id: payment.id },
          data: { status: "FAILED", failReason: String(error) },
        }).catch(() => undefined);
        toApiError(error);
      }
      try {
        charge = await fallback!.createPixCharge(payload);
        used = fallback!;
      } catch {
        await prisma.storePayment.update({
          where: { id: payment.id },
          data: { status: "FAILED", failReason: String(error) },
        }).catch(() => undefined);
        toApiError(error);
      }
    }

    const updated = await prisma.storePayment.update({
      where: { id: payment.id },
      data: {
        provider: used.provider,
        externalId: charge!.externalId,
        pixQrCodeText: charge!.qrCodeText,
        expiresAt: charge!.expiresAt,
      },
    });
    await prisma.storeOrder.updateMany({
      where: { id: order.id, status: "CREATED" },
      data: { status: "PAYMENT_PENDING" },
    });
    return this.publicPayment(updated);
  }

  async createCard(
    publicToken: string,
    input: CreateCardPaymentInput,
    remoteIp?: string,
  ) {
    const order = await prisma.storeOrder.findUnique({
      where: { publicToken },
      include: { organization: { select: { displayName: true, name: true } } },
    });
    if (!order) throw new NotFoundException("Pedido da Loja não encontrado");
    if (!["CREATED", "PAYMENT_PENDING"].includes(order.status)) {
      throw new BadRequestException("Pedido da Loja não está aguardando pagamento");
    }
    if (order.expiresAt.getTime() <= Date.now()) {
      throw new BadRequestException("A reserva de estoque deste pedido expirou");
    }
    assertMinimumCharge(order.totalCents);

    const gateway = getGatewayForMethod("CARD");
    const payment = await prisma.storePayment.create({
      data: {
        storeOrderId: order.id,
        provider: gateway.provider,
        method: "CARD",
        amountCents: order.totalCents,
        installments: input.installments,
      },
    });

    try {
      const result = await gateway.createCardPayment({
        paymentId: payment.id,
        orderId: order.id,
        amountCents: order.totalCents,
        description: `Loja ${order.organization.displayName ?? order.organization.name} · BoraFest`.slice(0, 90),
        cardToken: input.cardToken,
        ...(input.card
          ? {
              rawCard: {
                number: input.card.number,
                holderName: input.card.holderName,
                expiryMonth: input.card.expiryMonth,
                expiryYear: input.card.expiryYear,
                ccv: input.card.ccv,
                holderInfo: {
                  name: input.card.holderName,
                  email: order.contactEmail,
                  cpfCnpj: input.card.holderCpf,
                  postalCode: input.card.postalCode,
                  addressNumber: input.card.addressNumber,
                  phone: order.contactPhone ?? undefined,
                },
              },
            }
          : {}),
        remoteIp,
        installments: input.installments,
        customer: {
          name: order.contactName,
          email: order.contactEmail,
          document: input.payerDocument ?? input.card?.holderCpf,
        },
        idempotencyKey: payment.id,
      });

      await prisma.storePayment.update({
        where: { id: payment.id },
        data: {
          externalId: result.externalId,
          failReason: result.failReason,
        },
      });
      await prisma.storeOrder.updateMany({
        where: { id: order.id, status: "CREATED" },
        data: { status: "PAYMENT_PENDING" },
      });

      await applyStoreGatewayStatus(payment.id, result.status);
      const finalPayment = await prisma.storePayment.findUniqueOrThrow({
        where: { id: payment.id },
      });
      return this.publicPayment(finalPayment);
    } catch (error) {
      await prisma.storePayment.update({
        where: { id: payment.id },
        data: { status: "FAILED", failReason: String(error) },
      }).catch(() => undefined);
      toApiError(error);
    }
  }

  async sync(publicToken: string) {
    const order = await prisma.storeOrder.findUnique({ where: { publicToken } });
    if (!order) throw new NotFoundException("Pedido da Loja não encontrado");

    const payment = await prisma.storePayment.findFirst({
      where: {
        storeOrderId: order.id,
        externalId: { not: null },
        status: { in: ["PENDING", "AUTHORIZED"] },
      },
      orderBy: { createdAt: "desc" },
    });
    if (!payment?.externalId) return { synced: false };

    try {
      const gateway = getGateway(payment.provider);
      const status = await gateway.getStatus(payment.externalId);
      if (status !== "PENDING") {
        await applyStoreGatewayStatus(payment.id, status);
      }
      return { synced: true, status };
    } catch {
      return { synced: false };
    }
  }

  private publicPayment(payment: {
    id: string;
    status: string;
    amountCents: number;
    pixQrCodeText: string | null;
    expiresAt: Date | null;
    paidAt: Date | null;
  }) {
    return {
      id: payment.id,
      status: payment.status,
      amountCents: payment.amountCents,
      pixQrCodeText: payment.pixQrCodeText,
      expiresAt: payment.expiresAt,
      paidAt: payment.paidAt,
    };
  }
}
