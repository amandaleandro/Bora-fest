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
exports.WaitingRoomService = void 0;
const common_1 = require("@nestjs/common");
const database_1 = require("@borafest/database");
const queues_1 = require("@borafest/queues");
let WaitingRoomService = (() => {
    let _classDecorators = [(0, common_1.Injectable)()];
    let _classDescriptor;
    let _classExtraInitializers = [];
    let _classThis;
    var WaitingRoomService = class {
        static { _classThis = this; }
        static {
            const _metadata = typeof Symbol === "function" && Symbol.metadata ? Object.create(null) : void 0;
            __esDecorate(null, _classDescriptor = { value: _classThis }, _classDecorators, { kind: "class", name: _classThis.name, metadata: _metadata }, null, _classExtraInitializers);
            WaitingRoomService = _classThis = _classDescriptor.value;
            if (_metadata) Object.defineProperty(_classThis, Symbol.metadata, { enumerable: true, configurable: true, writable: true, value: _metadata });
            __runInitializers(_classThis, _classExtraInitializers);
        }
        redis = (0, queues_1.getRedisConnection)();
        /**
         * Sem sala de espera ativa: admite direto (o gate simplesmente não existe
         * pra esse evento) — o comprador nem percebe a diferença.
         */
        async join(slug) {
            const event = await this.loadEvent(slug);
            if (!event.waitingRoomEnabled) {
                return { status: "ADMITTED", ticketId: "" };
            }
            return (0, queues_1.joinWaitingRoom)(this.redis, event.id, event.waitingRoomConcurrency);
        }
        async status(slug, ticketId) {
            const event = await this.loadEvent(slug);
            if (!event.waitingRoomEnabled) {
                return { status: "ADMITTED" };
            }
            return (0, queues_1.getWaitingRoomStatus)(this.redis, event.id, ticketId);
        }
        /**
         * Gate server-side na criação da reserva — só é chamado quando o
         * `ReservationsService` já confirmou que o evento tem sala de espera
         * ativa, então aqui é sempre exigência: sem ticket admitido, sem reserva.
         */
        async assertAdmitted(eventId, ticketId) {
            if (!ticketId || !(await (0, queues_1.isWaitingRoomAdmitted)(this.redis, eventId, ticketId))) {
                throw new common_1.ForbiddenException("Sua vez na sala de espera ainda não chegou ou expirou — volte e entre na fila novamente");
            }
        }
        async loadEvent(slug) {
            const event = await database_1.prisma.event.findFirst({
                where: { slug, status: "PUBLISHED" },
                select: { id: true, waitingRoomEnabled: true, waitingRoomConcurrency: true },
            });
            if (!event)
                throw new common_1.NotFoundException("Evento não encontrado");
            return event;
        }
    };
    return WaitingRoomService = _classThis;
})();
exports.WaitingRoomService = WaitingRoomService;
