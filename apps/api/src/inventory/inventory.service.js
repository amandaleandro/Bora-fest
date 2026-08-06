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
exports.InventoryService = exports.InsufficientStockError = void 0;
const common_1 = require("@nestjs/common");
const database_1 = require("@borafest/database");
class InsufficientStockError extends Error {
    constructor(lotId) {
        super(`Estoque insuficiente para o lote ${lotId}`);
    }
}
exports.InsufficientStockError = InsufficientStockError;
let InventoryService = (() => {
    let _classDecorators = [(0, common_1.Injectable)()];
    let _classDescriptor;
    let _classExtraInitializers = [];
    let _classThis;
    var InventoryService = class {
        static { _classThis = this; }
        static {
            const _metadata = typeof Symbol === "function" && Symbol.metadata ? Object.create(null) : void 0;
            __esDecorate(null, _classDescriptor = { value: _classThis }, _classDecorators, { kind: "class", name: _classThis.name, metadata: _metadata }, null, _classExtraInitializers);
            InventoryService = _classThis = _classDescriptor.value;
            if (_metadata) Object.defineProperty(_classThis, Symbol.metadata, { enumerable: true, configurable: true, writable: true, value: _metadata });
            __runInitializers(_classThis, _classExtraInitializers);
        }
        /**
         * Decremento atômico de estoque: só reserva se
         * vendidos + reservados + quantidade <= capacidade,
         * checado e atualizado em uma única instrução no Postgres
         * para não haver overselling sob concorrência. Aceita um
         * client de transação para ser combinado com a criação da
         * reserva em uma única unidade atômica.
         */
        async tryReserve(lotId, quantity, client = database_1.prisma) {
            const rows = await client.$queryRaw(database_1.Prisma.sql `
      UPDATE ticket_lots
      SET reserved_count = reserved_count + ${quantity}, updated_at = now()
      WHERE id = ${lotId}::uuid
        AND status = 'ACTIVE'
        AND (sold_count + reserved_count + ${quantity}) <= capacity
      RETURNING id
    `);
            if (rows.length === 0) {
                throw new InsufficientStockError(lotId);
            }
        }
        async release(lotId, quantity, client = database_1.prisma) {
            await client.$executeRaw(database_1.Prisma.sql `
      UPDATE ticket_lots
      SET reserved_count = GREATEST(reserved_count - ${quantity}, 0), updated_at = now()
      WHERE id = ${lotId}::uuid
    `);
        }
        async confirmSale(lotId, quantity, client = database_1.prisma) {
            await client.$executeRaw(database_1.Prisma.sql `
      UPDATE ticket_lots
      SET reserved_count = GREATEST(reserved_count - ${quantity}, 0),
          sold_count = sold_count + ${quantity},
          updated_at = now()
      WHERE id = ${lotId}::uuid
    `);
        }
        async getAvailability(lotId, client = database_1.prisma) {
            const lot = await client.ticketLot.findUnique({ where: { id: lotId } });
            if (!lot)
                return null;
            return {
                lotId: lot.id,
                capacity: lot.capacity,
                sold: lot.soldCount,
                reserved: lot.reservedCount,
                available: Math.max(lot.capacity - lot.soldCount - lot.reservedCount, 0),
                status: lot.status,
            };
        }
    };
    return InventoryService = _classThis;
})();
exports.InventoryService = InventoryService;
