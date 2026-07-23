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
    const ip = request.headers["x-forwarded-for"]?.split(",")[0]?.trim() || request.ip || "unknown";

    let keyPart = ip;
    if (options.by?.startsWith("body:")) {
      const field = options.by.slice("body:".length);
      const value = request.body?.[field];
      if (value) keyPart = `${ip}:${value}`;
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
