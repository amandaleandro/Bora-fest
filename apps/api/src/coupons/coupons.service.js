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
exports.CouponsService = void 0;
const common_1 = require("@nestjs/common");
const database_1 = require("@borafest/database");
const auth_1 = require("@borafest/auth");
let CouponsService = (() => {
    let _classDecorators = [(0, common_1.Injectable)()];
    let _classDescriptor;
    let _classExtraInitializers = [];
    let _classThis;
    var CouponsService = class {
        static { _classThis = this; }
        static {
            const _metadata = typeof Symbol === "function" && Symbol.metadata ? Object.create(null) : void 0;
            __esDecorate(null, _classDescriptor = { value: _classThis }, _classDecorators, { kind: "class", name: _classThis.name, metadata: _metadata }, null, _classExtraInitializers);
            CouponsService = _classThis = _classDescriptor.value;
            if (_metadata) Object.defineProperty(_classThis, Symbol.metadata, { enumerable: true, configurable: true, writable: true, value: _metadata });
            __runInitializers(_classThis, _classExtraInitializers);
        }
        orgAccess;
        constructor(orgAccess) {
            this.orgAccess = orgAccess;
        }
        async create(userId, eventId, input) {
            const event = await database_1.prisma.event.findUnique({ where: { id: eventId } });
            if (!event)
                throw new common_1.NotFoundException("Evento não encontrado");
            await this.orgAccess.assertPermission(event.organizationId, userId, auth_1.PERMISSIONS.EVENT_CREATE);
            try {
                return await database_1.prisma.coupon.create({
                    data: {
                        eventId,
                        code: input.code.toUpperCase(),
                        discountType: input.discountType,
                        discountValue: input.discountValue,
                        maxRedemptions: input.maxRedemptions,
                        expiresAt: input.expiresAt,
                    },
                });
            }
            catch (error) {
                if (error instanceof database_1.Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
                    throw new common_1.BadRequestException("Já existe um cupom com este código no evento");
                }
                throw error;
            }
        }
        async list(userId, eventId) {
            const event = await database_1.prisma.event.findUnique({ where: { id: eventId } });
            if (!event)
                throw new common_1.NotFoundException("Evento não encontrado");
            await this.orgAccess.assertPermission(event.organizationId, userId, auth_1.PERMISSIONS.EVENT_CREATE);
            return database_1.prisma.coupon.findMany({ where: { eventId }, orderBy: { createdAt: "desc" } });
        }
        async deactivate(userId, couponId) {
            const coupon = await database_1.prisma.coupon.findUnique({
                where: { id: couponId },
                include: { event: { select: { organizationId: true } } },
            });
            if (!coupon)
                throw new common_1.NotFoundException("Cupom não encontrado");
            await this.orgAccess.assertPermission(coupon.event.organizationId, userId, auth_1.PERMISSIONS.EVENT_CREATE);
            return database_1.prisma.coupon.update({ where: { id: couponId }, data: { active: false } });
        }
        /** Preview público para o checkout mostrar o desconto antes do pedido. */
        async check(eventSlug, code) {
            const event = await database_1.prisma.event.findUnique({ where: { slug: eventSlug } });
            if (!event)
                throw new common_1.NotFoundException("Evento não encontrado");
            const coupon = await this.findUsable(event.id, code);
            return {
                valid: true,
                code: coupon.code,
                discountType: coupon.discountType,
                discountValue: coupon.discountValue,
            };
        }
        /** Valida e retorna o cupom utilizável; lança 400 se inválido/esgotado. */
        async findUsable(eventId, code) {
            const coupon = await database_1.prisma.coupon.findUnique({
                where: { eventId_code: { eventId, code: code.toUpperCase() } },
            });
            if (!coupon || !coupon.active)
                throw new common_1.BadRequestException("Cupom inválido");
            if (coupon.expiresAt && coupon.expiresAt.getTime() < Date.now()) {
                throw new common_1.BadRequestException("Cupom expirado");
            }
            if (coupon.maxRedemptions !== null && coupon.redeemedCount >= coupon.maxRedemptions) {
                throw new common_1.BadRequestException("Cupom esgotado");
            }
            return coupon;
        }
        static discountFor(coupon, totalCents) {
            const discount = coupon.discountType === "PERCENT"
                ? Math.round((totalCents * coupon.discountValue) / 100)
                : coupon.discountValue;
            return Math.min(discount, totalCents);
        }
    };
    return CouponsService = _classThis;
})();
exports.CouponsService = CouponsService;
