import { CanActivate, ExecutionContext, HttpException, HttpStatus, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { getRedisConnection } from "@borafest/queues";
import { RATE_LIMIT_KEY, type RateLimitOptions } from "./rate-limit.decorator";

/** Fallback global pra rotas sem `@RateLimit` explícito — proteção básica contra flood. */
const DEFAULT_LIMIT: RateLimitOptions = {
  limit: 120,
  windowSeconds: 60,
  keyPrefix: "default",
  by: "ip",
};

/**
 * Limite de requisições por janela, contado no Redis (`INCR` + `EXPIRE` na
 * primeira ocorrência — atômico o bastante pro propósito: um estouro
 * ocasional de +1 sob corrida não importa aqui, diferente do estoque).
 * Guard global (`APP_GUARD`); rotas sem `@RateLimit` caem no default acima.
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const options =
      this.reflector.get<RateLimitOptions>(RATE_LIMIT_KEY, context.getHandler()) ?? DEFAULT_LIMIT;

    const request = context.switchToHttp().getRequest();
    // BURLA DO RATE LIMIT (auditoria 2026-08-29): ler o X-Forwarded-For CRU
    // deixava qualquer cliente forjar o IP e rotacionar a chave a cada request
    // — brute-force de senha, OTP, cupom e teste de cartao passavam sem 429
    // (provado: 20/20 sem bloqueio). `request.ip` respeita o trustProxy do
    // Fastify: so aceita o XFF do proxy confiavel (Caddy), nao do cliente.
    // Exige TRUST_PROXY apontando para o IP do proxy, nao "true" solto.
    const ip = request.ip || "unknown";

    let keyPart = ip;
    if (options.by?.startsWith("body:") || options.by?.startsWith("params:")) {
      const [fonte, field] = options.by.split(":");
      const value = (fonte === "params" ? request.params : request.body)?.[field];
      // nunca deixar um objeto virar "[object Object]" na chave (auditoria
      // 2026-08-29): serializa valores não-primitivos
      if (value !== undefined && value !== null) {
        // normaliza a chave (auditoria 2026-08-30): sem minúsculas+trim, o
        // destino do OTP em "User@x.com" e "user@x.com" caía em baldes
        // diferentes — dava pra bombardear o e-mail de um terceiro variando a
        // caixa. Chave de rate limit é insensível a caixa por construção.
        const v = (typeof value === "object" ? JSON.stringify(value) : String(value))
          .trim()
          .toLowerCase();
        keyPart = `${ip}:${v}`;
      }
    }

    const redisKey = `ratelimit:${options.keyPrefix}:${keyPart}`;
    const redis = getRedisConnection();

    const count = await redis.incr(redisKey);
    if (count === 1) {
      await redis.expire(redisKey, options.windowSeconds);
    }

    if (count > options.limit) {
      throw new HttpException(
        "Muitas tentativas — aguarde um pouco antes de tentar de novo",
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    return true;
  }
}
