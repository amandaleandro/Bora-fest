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
exports.ReservationsService = void 0;
const common_1 = require("@nestjs/common");
const database_1 = require("@borafest/database");
const queues_1 = require("@borafest/queues");
const inventory_service_1 = require("../inventory/inventory.service");
const RESERVATION_TTL_MINUTES = 10;
let ReservationsService = (() => {
    let _classDecorators = [(0, common_1.Injectable)()];
    let _classDescriptor;
    let _classExtraInitializers = [];
    let _classThis;
    var ReservationsService = class {
        static { _classThis = this; }
        static {
            const _metadata = typeof Symbol === "function" && Symbol.metadata ? Object.create(null) : void 0;
            __esDecorate(null, _classDescriptor = { value: _classThis }, _classDecorators, { kind: "class", name: _classThis.name, metadata: _metadata }, null, _classExtraInitializers);
            ReservationsService = _classThis = _classDescriptor.value;
            if (_metadata) Object.defineProperty(_classThis, Symbol.metadata, { enumerable: true, configurable: true, writable: true, value: _metadata });
            __runInitializers(_classThis, _classExtraInitializers);
        }
        inventory;
        waitingRoom;
        expirationQueue = (0, queues_1.createReservationExpirationQueue)();
        constructor(inventory, waitingRoom) {
            this.inventory = inventory;
            this.waitingRoom = waitingRoom;
        }
        async create(userId, input) {
            const event = await database_1.prisma.event.findUnique({ where: { id: input.eventId } });
            if (!event || event.status !== "PUBLISHED") {
                throw new common_1.NotFoundException("Evento não encontrado ou não publicado");
            }
            if (event.waitingRoomEnabled) {
                await this.waitingRoom.assertAdmitted(event.id, input.waitingRoomTicketId);
            }
            const lots = await database_1.prisma.ticketLot.findMany({
                where: { id: { in: input.items.map((item) => item.ticketLotId) } },
                include: { ticketType: true },
            });
            for (const item of input.items) {
                const lot = lots.find((l) => l.id === item.ticketLotId);
                if (!lot || lot.ticketType.eventId !== input.eventId) {
                    throw new common_1.BadRequestException(`Lote ${item.ticketLotId} não pertence a este evento`);
                }
                if (item.quantity > lot.maxPerOrder) {
                    throw new common_1.BadRequestException(`Quantidade acima do limite por pedido para o lote ${lot.name}`);
                }
            }
            const expiresAt = new Date(Date.now() + RESERVATION_TTL_MINUTES * 60 * 1000);
            const reservation = await database_1.prisma.$transaction(async (tx) => {
                for (const item of input.items) {
                    await this.inventory.tryReserve(item.ticketLotId, item.quantity, tx);
                }
                return tx.reservation.create({
                    data: {
                        eventId: input.eventId,
                        userId,
                        expiresAt,
                        items: {
                            create: input.items.map((item) => {
                                const lot = lots.find((l) => l.id === item.ticketLotId);
                                return {
                                    ticketLotId: item.ticketLotId,
                                    quantity: item.quantity,
                                    // meia-entrada (Lei 12.933/2013): metade do preço, taxa cheia;
                                    // documento é conferido na portaria
                                    priceCents: item.halfPrice ? Math.round(lot.priceCents / 2) : lot.priceCents,
                                    feeCents: lot.feeCents,
                                    halfPrice: item.halfPrice ?? false,
                                };
                            }),
                        },
                    },
                    include: { items: true },
                });
            }).catch((error) => {
                if (error instanceof inventory_service_1.InsufficientStockError) {
                    throw new common_1.BadRequestException(error.message);
                }
                throw error;
            });
            await this.expirationQueue.add("expire", { reservationId: reservation.id }, { delay: RESERVATION_TTL_MINUTES * 60 * 1000, jobId: reservation.id });
            return reservation;
        }
        async findById(reservationId) {
            const reservation = await database_1.prisma.reservation.findUnique({
                where: { id: reservationId },
                include: { items: true },
            });
            if (!reservation)
                throw new common_1.NotFoundException("Reserva não encontrada");
            return reservation;
        }
    };
    return ReservationsService = _classThis;
})();
exports.ReservationsService = ReservationsService;
