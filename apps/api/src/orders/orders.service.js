"use strict";
var __esDecorate = (this && this.__esDecorate) || function (ctor, descriptorIn, decorators, contextIn, initializers, extraInitializers) {
    function accept(f) { if (f !== void 0 && typeof f !== "function") throw new TypeError("Function expected"); return f; }
    var kind = contextIn.kind, key = kind === "getter" ? "get" : kind === "setter" ? "set" : "value";
    var target = !descriptorIn && ctor ? contextIn["static"] ? ctor : ctor.prototype : null;
    var descriptor = descriptorIn || (target ? Object.getOwnPropertyDescriptor(target, contextIn.name) : {});
    var _, done = false;
    for (var i = decorators.length - 1; i >= 0; i--) {
        var context = {};
        for (var p in contextIn) context[p] = p === "access" ? {} : contextIn[p];
        for (var p in contextIn.access) context.access[p] = contextIn.access[p];
        context.addInitializer = function (f) { if (done) throw new TypeError("Cannot add initializers after decoration has completed"); extraInitializers.push(accept(f || null)); };
        var result = (0, decorators[i])(kind === "accessor" ? { get: descriptor.get, set: descriptor.set } : descriptor[key], context);
        if (kind === "accessor") {
            if (result === void 0) continue;
            if (result === null || typeof result !== "object") throw new TypeError("Object expected");
            if (_ = accept(result.get)) descriptor.get = _;
            if (_ = accept(result.set)) descriptor.set = _;
            if (_ = accept(result.init)) initializers.unshift(_);
        }
        else if (_ = accept(result)) {
            if (kind === "field") initializers.unshift(_);
            else descriptor[key] = _;
        }
    }
    if (target) Object.defineProperty(target, contextIn.name, descriptor);
    done = true;
};
var __runInitializers = (this && this.__runInitializers) || function (thisArg, initializers, value) {
    var useValue = arguments.length > 2;
    for (var i = 0; i < initializers.length; i++) {
        value = useValue ? initializers[i].call(thisArg, value) : initializers[i].call(thisArg);
    }
    return useValue ? value : void 0;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.OrdersService = void 0;
const common_1 = require("@nestjs/common");
const database_1 = require("@borafest/database");
const queues_1 = require("@borafest/queues");
const payments_1 = require("@borafest/payments");
const auth_1 = require("@borafest/auth");
const coupons_service_1 = require("../coupons/coupons.service");
/**
 * Janela para pagar depois de criar o pedido. O estoque permanece em
 * `reserved_count` até o pagamento aprovar (aí vira `sold_count`) ou a janela
 * expirar (aí é liberado pelo worker de expiração de pedidos).
 */
const ORDER_PAYMENT_WINDOW_MINUTES = 15;
let OrdersService = (() => {
    let _classDecorators = [(0, common_1.Injectable)()];
    let _classDescriptor;
    let _classExtraInitializers = [];
    let _classThis;
    var OrdersService = class {
        static { _classThis = this; }
        static {
            const _metadata = typeof Symbol === "function" && Symbol.metadata ? Object.create(null) : void 0;
            __esDecorate(null, _classDescriptor = { value: _classThis }, _classDecorators, { kind: "class", name: _classThis.name, metadata: _metadata }, null, _classExtraInitializers);
            OrdersService = _classThis = _classDescriptor.value;
            if (_metadata) Object.defineProperty(_classThis, Symbol.metadata, { enumerable: true, configurable: true, writable: true, value: _metadata });
            __runInitializers(_classThis, _classExtraInitializers);
        }
        coupons;
        orgAccess;
        expirationQueue = (0, queues_1.createReservationExpirationQueue)();
        constructor(coupons, orgAccess) {
            this.coupons = coupons;
            this.orgAccess = orgAccess;
        }
        async createFromReservation(userId, input) {
            const reservation = await database_1.prisma.reservation.findUnique({
                where: { id: input.reservationId },
                include: { items: true },
            });
            if (!reservation)
                throw new common_1.NotFoundException("Reserva não encontrada");
            if (reservation.status !== "ACTIVE") {
                throw new common_1.BadRequestException("Reserva não está mais ativa");
            }
            if (reservation.expiresAt.getTime() <= Date.now()) {
                throw new common_1.BadRequestException("Reserva expirada");
            }
            // quem paga a taxa (handoff v2 §3): BUYER soma a taxa ao comprador;
            // PRODUCER absorve — o comprador paga só o preço e o repasse é descontado.
            const lots = await database_1.prisma.ticketLot.findMany({
                where: { id: { in: reservation.items.map((i) => i.ticketLotId) } },
                select: { id: true, feeMode: true, nominal: true, requiresCpf: true },
            });
            const lotById = new Map(lots.map((l) => [l.id, l]));
            const itemsTotalCents = reservation.items.reduce((sum, item) => {
                const producerAbsorbs = lotById.get(item.ticketLotId)?.feeMode === "PRODUCER";
                const unit = item.priceCents + (producerAbsorbs ? 0 : item.feeCents);
                return sum + unit * item.quantity;
            }, 0);
            // ingressos nominais exigem um participante por unidade
            const nominalItems = reservation.items.filter((i) => lotById.get(i.ticketLotId)?.nominal);
            if (nominalItems.length > 0) {
                for (const item of nominalItems) {
                    const provided = (input.attendees ?? []).filter((a) => a.ticketLotId === item.ticketLotId);
                    if (provided.length < item.quantity) {
                        throw new common_1.BadRequestException("Informe o nome de cada participante dos ingressos nominais");
                    }
                    if (lotById.get(item.ticketLotId)?.requiresCpf && provided.some((a) => !a.cpf)) {
                        throw new common_1.BadRequestException("CPF obrigatório para os ingressos deste setor");
                    }
                }
            }
            const coupon = input.couponCode
                ? await this.coupons.findUsable(reservation.eventId, input.couponCode)
                : null;
            const discountCents = coupon ? coupons_service_1.CouponsService.discountFor(coupon, itemsTotalCents) : 0;
            const totalCents = itemsTotalCents - discountCents;
            const expiresAt = new Date(Date.now() + ORDER_PAYMENT_WINDOW_MINUTES * 60 * 1000);
            const order = await database_1.prisma.$transaction(async (tx) => {
                // guarda de corrida contra o worker de expiração: só converte se ainda ACTIVE
                const converted = await tx.reservation.updateMany({
                    where: { id: reservation.id, status: "ACTIVE" },
                    data: { status: "CONVERTED" },
                });
                if (converted.count === 0) {
                    throw new common_1.BadRequestException("Reserva não está mais ativa");
                }
                // o estoque já está seguro em reserved_count; a venda (sold_count) só se
                // confirma quando o pagamento aprovar — nunca na criação do pedido
                const created = await tx.order.create({
                    data: {
                        eventId: reservation.eventId,
                        reservationId: reservation.id,
                        userId: userId ?? reservation.userId,
                        contactEmail: input.contactEmail,
                        contactName: input.contactName,
                        contactPhone: input.contactPhone?.replace(/\D/g, ""),
                        status: "PAYMENT_PENDING",
                        totalCents,
                        discountCents,
                        expiresAt,
                        items: {
                            create: reservation.items.map((item) => ({
                                ticketLotId: item.ticketLotId,
                                quantity: item.quantity,
                                priceCents: item.priceCents,
                                feeCents: item.feeCents,
                                halfPrice: item.halfPrice,
                            })),
                        },
                    },
                    include: { items: true },
                });
                if (input.attendees?.length) {
                    await tx.orderAttendee.createMany({
                        data: input.attendees.map((a) => ({
                            orderId: created.id,
                            ticketLotId: a.ticketLotId,
                            name: a.name,
                            cpf: a.cpf?.replace(/\D/g, ""),
                        })),
                    });
                }
                if (input.consent) {
                    // LGPD: aceite versionado e provável em auditoria
                    await tx.consent.createMany({
                        data: [
                            { orderId: created.id, userId: userId ?? null, document: "terms", version: input.consent.version },
                            { orderId: created.id, userId: userId ?? null, document: "privacy", version: input.consent.version },
                        ],
                    });
                }
                if (coupon) {
                    // resgate atômico: só conta se ainda houver saldo de usos
                    const redeemed = await tx.coupon.updateMany({
                        where: {
                            id: coupon.id,
                            active: true,
                            OR: [
                                { maxRedemptions: null },
                                { redeemedCount: { lt: coupon.maxRedemptions ?? undefined } },
                            ],
                        },
                        data: { redeemedCount: { increment: 1 } },
                    });
                    if (redeemed.count === 0) {
                        throw new common_1.BadRequestException("Cupom esgotado");
                    }
                    await tx.couponRedemption.create({
                        data: { couponId: coupon.id, orderId: created.id, amountCents: discountCents },
                    });
                }
                return created;
            });
            // a reserva virou pedido: o job de expiração da reserva não é mais necessário
            await this.expirationQueue.remove(reservation.id);
            return order;
        }
        async findByPublicToken(publicToken) {
            const order = await database_1.prisma.order.findUnique({
                where: { publicToken },
                include: {
                    items: true,
                    payments: {
                        orderBy: { createdAt: "desc" },
                        select: {
                            id: true,
                            method: true,
                            status: true,
                            amountCents: true,
                            pixQrCodeText: true,
                            installments: true,
                            failReason: true,
                            expiresAt: true,
                            paidAt: true,
                        },
                    },
                    tickets: { select: { id: true, code: true, status: true } },
                },
            });
            if (!order)
                throw new common_1.NotFoundException("Pedido não encontrado");
            return order;
        }
        /** Detalhe de um pedido para o painel do produtor (tela Vendas). */
        async getOrderDetailForProducer(orderId, actorUserId) {
            const order = await database_1.prisma.order.findUnique({
                where: { id: orderId },
                include: {
                    event: { select: { id: true, title: true, organizationId: true } },
                    items: { include: { ticketLot: { include: { ticketType: true } } } },
                    payments: { orderBy: { createdAt: "desc" } },
                    tickets: { select: { id: true, code: true, status: true, attendeeName: true } },
                },
            });
            if (!order)
                throw new common_1.NotFoundException("Pedido não encontrado");
            await this.orgAccess.assertPermission(order.event.organizationId, actorUserId, auth_1.PERMISSIONS.FINANCE_VIEW);
            return order;
        }
        /**
         * PDV (venda presencial): sem checkout/reserva prévia — reserva e confirma o
         * estoque na mesma transação, cria o pedido já `PAID` e credita o ledger da
         * organização como uma venda normal. Reusa o outbox `order.paid` para que o
         * worker emita os ingressos exatamente como numa compra online (mesmo
         * caminho de cortesias, mas com valor real).
         */
        async createManualSale(eventId, actorUserId, input) {
            const event = await database_1.prisma.event.findUnique({ where: { id: eventId } });
            if (!event)
                throw new common_1.NotFoundException("Evento não encontrado");
            const membership = await this.orgAccess.assertPermission(event.organizationId, actorUserId, auth_1.PERMISSIONS.SALES_PERFORM);
            const partnerId = membership.role.key === "seller"
                ? membership.salesPartnerId ?? undefined
                : input.salesPartnerId ?? undefined;
            if (membership.role.key === "seller" && !partnerId) {
                throw new common_1.ForbiddenException("Vendedor sem atlética/parceiro vinculado");
            }
            if (partnerId) {
                const partner = await database_1.prisma.salesPartner.findFirst({ where: { id: partnerId, organizationId: event.organizationId, active: true } });
                if (!partner)
                    throw new common_1.ForbiddenException("Parceiro de vendas inválido para esta organização");
            }
            const lot = await database_1.prisma.ticketLot.findFirst({
                where: { id: input.ticketLotId, ticketType: { eventId } },
            });
            if (!lot)
                throw new common_1.BadRequestException("Lote não pertence a este evento");
            const organization = await database_1.prisma.organization.findUniqueOrThrow({ where: { id: event.organizationId } });
            const unitCents = lot.priceCents + lot.feeCents;
            const totalCents = unitCents * input.quantity;
            const partner = partnerId
                ? await database_1.prisma.salesPartner.findUnique({ where: { id: partnerId }, select: { commissionBps: true } })
                : null;
            const partnerCommissionCents = partner ? Math.floor((totalCents * partner.commissionBps) / 10_000) : 0;
            // venda no PDV não passa por gateway; a comissão da plataforma segue a
            // tabela do Pix (menor custo) por não haver taxa de adquirente envolvida
            const feeCents = (0, payments_1.computePlatformFeeCents)("PIX", totalCents, organization);
            const buyerEmail = input.buyerEmail ?? `pdv-${Date.now()}@borafest.local`;
            const order = await database_1.prisma
                .$transaction(async (tx) => {
                await (0, database_1.reserveInventory)(tx, lot.id, input.quantity);
                await (0, database_1.confirmSaleInventory)(tx, lot.id, input.quantity);
                const reservation = await tx.reservation.create({
                    data: {
                        eventId,
                        status: "CONVERTED",
                        expiresAt: new Date(),
                        items: {
                            create: [{ ticketLotId: lot.id, quantity: input.quantity, priceCents: lot.priceCents, feeCents: lot.feeCents }],
                        },
                    },
                });
                const created = await tx.order.create({
                    data: {
                        eventId,
                        reservationId: reservation.id,
                        salesPartnerId: partnerId,
                        soldByUserId: actorUserId,
                        partnerCommissionCents,
                        contactEmail: buyerEmail,
                        contactName: input.buyerName,
                        status: "PAID",
                        paidAt: new Date(),
                        totalCents,
                        items: {
                            create: [{ ticketLotId: lot.id, quantity: input.quantity, priceCents: lot.priceCents, feeCents: lot.feeCents }],
                        },
                    },
                });
                const ledgerAccount = await tx.ledgerAccount.upsert({
                    where: { organizationId: event.organizationId },
                    update: {},
                    create: { organizationId: event.organizationId },
                });
                await tx.ledgerEntry.createMany({
                    data: [
                        {
                            ledgerAccountId: ledgerAccount.id,
                            type: "SALE_CREDIT",
                            amountCents: totalCents,
                            referenceType: "order",
                            referenceId: created.id,
                        },
                        {
                            ledgerAccountId: ledgerAccount.id,
                            type: "PLATFORM_FEE",
                            amountCents: -feeCents,
                            referenceType: "order",
                            referenceId: created.id,
                        },
                    ],
                });
                await tx.outboxEvent.create({
                    data: {
                        aggregateType: "order",
                        aggregateId: created.id,
                        eventType: "order.paid",
                        payload: { orderId: created.id, pdv: true },
                    },
                });
                await tx.auditLog.create({
                    data: {
                        actorUserId,
                        organizationId: event.organizationId,
                        action: "order.pdv_sale",
                        entityType: "order",
                        entityId: created.id,
                        metadata: {
                            ticketLotId: lot.id,
                            quantity: input.quantity,
                            buyerName: input.buyerName,
                            buyerDocument: input.buyerDocument,
                            totalCents,
                        },
                    },
                });
                return created;
            })
                .catch((error) => {
                if (error instanceof database_1.InsufficientStockError) {
                    throw new common_1.BadRequestException("Estoque insuficiente para esta venda");
                }
                throw error;
            });
            return { orderId: order.id, publicToken: order.publicToken };
        }
        /**
         * Reembolso pelo painel do produtor (org-scoped, equivalente ao
         * `admin.refundOrder` mas exigindo permissão na organização em vez de
         * `platformRole=ADMIN`). Pedidos com pagamento real (Pix/cartão) disparam
         * o estorno no gateway; pedidos do PDV (sem `Payment`, pagos em dinheiro)
         * são estornados manualmente no ledger.
         */
        async refundOrder(orderId, actorUserId, input) {
            const order = await database_1.prisma.order.findUnique({
                where: { id: orderId },
                include: { event: { select: { organizationId: true } }, payments: { orderBy: { createdAt: "desc" } } },
            });
            if (!order)
                throw new common_1.NotFoundException("Pedido não encontrado");
            await this.orgAccess.assertPermission(order.event.organizationId, actorUserId, auth_1.PERMISSIONS.ORDER_REFUND);
            const payment = order.payments.find((p) => p.status === "PAID");
            if (payment && payment.externalId) {
                if (input.amountCents !== undefined && input.amountCents > payment.amountCents) {
                    throw new common_1.BadRequestException("Valor do estorno maior que o pagamento");
                }
                const marked = await database_1.prisma.payment.updateMany({
                    where: { id: payment.id, status: "PAID" },
                    data: { status: "REFUND_PENDING" },
                });
                if (marked.count === 0) {
                    throw new common_1.BadRequestException("Estorno já em andamento para este pagamento");
                }
                const gateway = (0, payments_1.getGateway)(payment.provider);
                let result;
                try {
                    result = await gateway.refund({
                        externalId: payment.externalId,
                        amountCents: input.amountCents,
                        idempotencyKey: `producer-refund:${payment.id}:${input.amountCents ?? "full"}`,
                    });
                }
                catch (error) {
                    await database_1.prisma.payment.updateMany({ where: { id: payment.id, status: "REFUND_PENDING" }, data: { status: "PAID" } });
                    throw error;
                }
                if (result.status === "FAILED") {
                    await database_1.prisma.payment.updateMany({ where: { id: payment.id, status: "REFUND_PENDING" }, data: { status: "PAID" } });
                    throw new common_1.BadRequestException("Gateway recusou o estorno");
                }
                await (0, payments_1.applyGatewayStatus)(payment.id, result.status, undefined, { refundAmountCents: input.amountCents });
            }
            else {
                // venda do PDV (dinheiro) — sem gateway: estorno manual no ledger
                if (!["PAID", "PARTIALLY_REFUNDED"].includes(order.status)) {
                    throw new common_1.BadRequestException("Pedido não está pago para estornar");
                }
                const amountCents = input.amountCents ?? order.totalCents;
                if (amountCents > order.totalCents) {
                    throw new common_1.BadRequestException("Valor do estorno maior que o pedido");
                }
                const isFull = amountCents >= order.totalCents;
                await database_1.prisma.$transaction(async (tx) => {
                    const ledgerAccount = await tx.ledgerAccount.upsert({
                        where: { organizationId: order.event.organizationId },
                        update: {},
                        create: { organizationId: order.event.organizationId },
                    });
                    await tx.ledgerEntry.create({
                        data: {
                            ledgerAccountId: ledgerAccount.id,
                            type: "REFUND_DEBIT",
                            amountCents: -amountCents,
                            referenceType: "order",
                            referenceId: order.id,
                        },
                    });
                    await tx.order.update({
                        where: { id: order.id },
                        data: { status: isFull ? "REFUNDED" : "PARTIALLY_REFUNDED" },
                    });
                    if (isFull) {
                        const items = await tx.orderItem.findMany({ where: { orderId: order.id } });
                        for (const item of items) {
                            await (0, database_1.returnSaleInventory)(tx, item.ticketLotId, item.quantity);
                        }
                        await tx.ticket.updateMany({
                            where: { orderId: order.id, status: { in: ["ISSUED", "ACTIVE"] } },
                            data: { status: "CANCELED", canceledAt: new Date() },
                        });
                    }
                });
            }
            await database_1.prisma.auditLog.create({
                data: {
                    actorUserId,
                    organizationId: order.event.organizationId,
                    action: "order.producer_refund",
                    entityType: "order",
                    entityId: order.id,
                    metadata: { amountCents: input.amountCents, reason: input.reason },
                },
            });
            return database_1.prisma.order.findUniqueOrThrow({ where: { id: order.id }, include: { payments: true } });
        }
    };
    return OrdersService = _classThis;
})();
exports.OrdersService = OrdersService;
