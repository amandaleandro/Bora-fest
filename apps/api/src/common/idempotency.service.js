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
exports.IdempotencyService = void 0;
const common_1 = require("@nestjs/common");
const crypto_1 = require("crypto");
const database_1 = require("@borafest/database");
/**
 * Idempotência de requisições via header `Idempotency-Key` (arquitetura §11).
 * A primeira chamada executa e grava a resposta; repetições com o mesmo key e
 * mesmo payload recebem a resposta gravada; payload diferente é rejeitado.
 */
let IdempotencyService = (() => {
    let _classDecorators = [(0, common_1.Injectable)()];
    let _classDescriptor;
    let _classExtraInitializers = [];
    let _classThis;
    var IdempotencyService = class {
        static { _classThis = this; }
        static {
            const _metadata = typeof Symbol === "function" && Symbol.metadata ? Object.create(null) : void 0;
            __esDecorate(null, _classDescriptor = { value: _classThis }, _classDecorators, { kind: "class", name: _classThis.name, metadata: _metadata }, null, _classExtraInitializers);
            IdempotencyService = _classThis = _classDescriptor.value;
            if (_metadata) Object.defineProperty(_classThis, Symbol.metadata, { enumerable: true, configurable: true, writable: true, value: _metadata });
            __runInitializers(_classThis, _classExtraInitializers);
        }
        hashRequest(payload) {
            return (0, crypto_1.createHash)("sha256").update(JSON.stringify(payload ?? {})).digest("hex");
        }
        async run(key, scope, payload, handler) {
            if (!key)
                return handler();
            const requestHash = this.hashRequest(payload);
            try {
                await database_1.prisma.idempotencyKey.create({
                    data: { key, scope, requestHash, lockedAt: new Date() },
                });
            }
            catch (error) {
                if (error instanceof database_1.Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
                    const existing = await database_1.prisma.idempotencyKey.findUnique({ where: { key } });
                    if (!existing)
                        throw error;
                    if (existing.requestHash !== requestHash) {
                        throw new common_1.UnprocessableEntityException("Idempotency-Key reutilizada com payload diferente");
                    }
                    if (existing.completedAt) {
                        return existing.responseBody;
                    }
                    throw new common_1.ConflictException("Requisição com esta Idempotency-Key ainda em processamento");
                }
                throw error;
            }
            try {
                const response = await handler();
                await database_1.prisma.idempotencyKey.update({
                    where: { key },
                    data: {
                        completedAt: new Date(),
                        responseBody: response,
                        statusCode: 200,
                    },
                });
                return response;
            }
            catch (error) {
                // libera o key para retry — a falha não deve travar o cliente para sempre
                await database_1.prisma.idempotencyKey.delete({ where: { key } }).catch(() => undefined);
                throw error;
            }
        }
    };
    return IdempotencyService = _classThis;
})();
exports.IdempotencyService = IdempotencyService;
