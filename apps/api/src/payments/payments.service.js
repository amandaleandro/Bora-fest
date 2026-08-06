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
exports.PaymentsService = void 0;
const common_1 = require("@nestjs/common");
const database_1 = require("@borafest/database");
const payments_1 = require("@borafest/payments");
/** Erro do gateway já é fail-fast (timeout/circuito) — devolve 503 claro em vez de 500 genérico. */
function toApiError(error) {
    if (error instanceof payments_1.CircuitOpenError || error instanceof payments_1.GatewayTimeoutError) {
        throw new common_1.ServiceUnavailableException("Pagamento indisponível no momento — tente novamente em alguns segundos");
    }
    throw error;
}
let PaymentsService = (() => {
    let _classDecorators = [(0, common_1.Injectable)()];
    let _classDescriptor;
    let _classExtraInitializers = [];
    let _classThis;
    var PaymentsService = class {
        static { _classThis = this; }
        static {
            const _metadata = typeof Symbol === "function" && Symbol.metadata ? Object.create(null) : void 0;
            __esDecorate(null, _classDescriptor = { value: _classThis }, _classDecorators, { kind: "class", name: _classThis.name, metadata: _metadata }, null, _classExtraInitializers);
            PaymentsService = _classThis = _classDescriptor.value;
            if (_metadata) Object.defineProperty(_classThis, Symbol.metadata, { enumerable: true, configurable: true, writable: true, value: _metadata });
            __runInitializers(_classThis, _classExtraInitializers);
        }
        idempotency;
        constructor(idempotency) {
            this.idempotency = idempotency;
        }
        async createPix(orderId, input, idempotencyKey) {
            return this.idempotency.run(idempotencyKey, "payments:create-pix", { orderId, ...input }, async () => {
                const order = await this.loadPayableOrder(orderId);
                // reaproveita cobrança Pix pendente e ainda válida (evita QR duplicado)
                const existing = await database_1.prisma.payment.findFirst({
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
                const gateway = (0, payments_1.getDefaultGateway)();
                const expiresInSeconds = Math.max(60, Math.floor(((order.expiresAt?.getTime() ?? Date.now() + 15 * 60_000) - Date.now()) / 1000));
                const payment = await database_1.prisma.payment.create({
                    data: {
                        orderId,
                        provider: gateway.provider,
                        method: "PIX",
                        amountCents: order.totalCents,
                        metadata: input.payerDocument ? { payerDocument: input.payerDocument } : undefined,
                    },
                });
                const charge = await gateway
                    .createPixCharge({
                    paymentId: payment.id,
                    orderId,
                    amountCents: order.totalCents,
                    customer: {
                        name: order.contactName ?? undefined,
                        email: order.contactEmail,
                        document: input.payerDocument,
                        phone: input.payerPhone,
                    },
                    expiresInSeconds,
                    idempotencyKey: payment.id,
                })
                    .catch(toApiError);
                const updated = await database_1.prisma.payment.update({
                    where: { id: payment.id },
                    data: {
                        externalId: charge.externalId,
                        pixQrCodeText: charge.qrCodeText,
                        expiresAt: charge.expiresAt,
                    },
                });
                await this.ensureOrderPending(orderId);
                return this.toPublicPayment(updated);
            });
        }
        async createCard(orderId, input, idempotencyKey, remoteIp) {
            // PAN nunca entra em log, banco ou payload de idempotência — só o final
            const cardRef = input.cardToken ?? `raw:${input.card?.number.replace(/\D/g, "").slice(-4)}`;
            return this.idempotency.run(idempotencyKey, "payments:create-card", { orderId, cardRef, installments: input.installments }, async () => {
                const order = await this.loadPayableOrder(orderId);
                const gateway = (0, payments_1.getDefaultGateway)();
                const payment = await database_1.prisma.payment.create({
                    data: {
                        orderId,
                        provider: gateway.provider,
                        method: "CARD",
                        amountCents: order.totalCents,
                        installments: input.installments,
                    },
                });
                const result = await gateway
                    .createCardPayment({
                    paymentId: payment.id,
                    orderId,
                    amountCents: order.totalCents,
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
                        name: order.contactName ?? undefined,
                        email: order.contactEmail,
                        document: input.payerDocument ?? input.card?.holderCpf,
                    },
                    idempotencyKey: payment.id,
                })
                    .catch(toApiError);
                await database_1.prisma.payment.update({
                    where: { id: payment.id },
                    data: {
                        externalId: result.externalId,
                        failReason: result.failReason,
                    },
                });
                await this.ensureOrderPending(orderId);
                // cartão responde na hora: aplica o resultado pelo mesmo caminho
                // idempotente dos webhooks
                await (0, payments_1.applyGatewayStatus)(payment.id, result.status);
                const finalPayment = await database_1.prisma.payment.findUniqueOrThrow({
                    where: { id: payment.id },
                });
                return this.toPublicPayment(finalPayment);
            });
        }
        async loadPayableOrder(orderId) {
            const order = await database_1.prisma.order.findUnique({ where: { id: orderId } });
            if (!order)
                throw new common_1.NotFoundException("Pedido não encontrado");
            if (order.status !== "CREATED" && order.status !== "PAYMENT_PENDING") {
                throw new common_1.BadRequestException("Pedido não está aguardando pagamento");
            }
            if (order.expiresAt && order.expiresAt.getTime() <= Date.now()) {
                throw new common_1.BadRequestException("Janela de pagamento do pedido expirou");
            }
            return order;
        }
        async ensureOrderPending(orderId) {
            await database_1.prisma.order.updateMany({
                where: { id: orderId, status: "CREATED" },
                data: { status: "PAYMENT_PENDING" },
            });
        }
        /** Nunca expor metadata/ids internos do gateway além do necessário. */
        toPublicPayment(payment) {
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
    };
    return PaymentsService = _classThis;
})();
exports.PaymentsService = PaymentsService;
