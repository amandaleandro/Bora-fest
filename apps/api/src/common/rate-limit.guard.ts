import { createHash } from "node:crypto";
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
 * LIMITE DESLIGADO SÓ PARA TESTE DE CARGA (2026-10-12). O script de carga
 * forjava X-Forwarded-For para escapar do limite — truque que a correção de
 * 29/08 fechou (e que nunca deveria funcionar). Agora o caminho é explícito:
 * `RATE_LIMIT_DISABLED=1` desliga o limite, mas SÓ com NODE_ENV=development ou
 * test. Em produção (as imagens fixam NODE_ENV=production) ou com NODE_ENV
 * vazio a variável é ignorada — lista do que é permitido, não do que é
 * proibido: esquecer o NODE_ENV não abre a porta.
 */
export function rateLimitDesligadoParaTeste(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.RATE_LIMIT_DISABLED !== "1") return false;
  return env.NODE_ENV === "development" || env.NODE_ENV === "test";
}

/**
 * Limite de requisições por janela, contado no Redis (`INCR` + `EXPIRE` na
 * primeira ocorrência — atômico o bastante pro propósito: um estouro
 * ocasional de +1 sob corrida não importa aqui, diferente do estoque).
 * Guard global (`APP_GUARD`); rotas sem `@RateLimit` caem no default acima.
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  /** lido uma vez, no boot: o limite não liga/desliga no meio do processo */
  private readonly desligado = rateLimitDesligadoParaTeste();

  constructor(private readonly reflector: Reflector) {
    if (this.desligado) {
      // eslint-disable-next-line no-console
      console.warn(
        `[rate-limit] DESLIGADO (RATE_LIMIT_DISABLED=1, NODE_ENV=${process.env.NODE_ENV}) — só para teste de carga`,
      );
    } else if (process.env.RATE_LIMIT_DISABLED === "1") {
      // eslint-disable-next-line no-console
      console.error(
        `[rate-limit] RATE_LIMIT_DISABLED=1 IGNORADO: só vale com NODE_ENV=development ou test (agora: ${
          process.env.NODE_ENV ?? "vazio"
        }). O limite segue ligado.`,
      );
    }
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (this.desligado) return true;
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
    if (options.by === "session") {
      // Este guard é global e roda ANTES do SessionGuard, então request.userId
      // ainda não existe aqui. A sessão está no header: o hash do bearer é
      // único por login, custa zero I/O e isola cada aparelho da porta mesmo
      // atrás do mesmo NAT. Sem header, cai no IP (comportamento antigo).
      const auth: string | undefined = request.headers?.authorization;
      if (auth) keyPart = `s:${createHash("sha256").update(auth).digest("hex").slice(0, 32)}`;
    } else if (options.by?.startsWith("body:") || options.by?.startsWith("params:")) {
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

    // UM round-trip atômico (perf+correção 2026-08-30): antes eram DOIS awaits
    // sequenciais em TODA request (o guard é global), e se o processo caísse
    // entre o incr e o expire a chave ficava SEM TTL — contador eterno
    // bloqueando o IP pra sempre. EXPIRE NX (Redis >= 7) renova só na criação,
    // dentro do mesmo pipeline.
    // Redis fora: a conexão compartilhada tem fila offline sem limite de
    // tentativas — o exec() ficava ESPERANDO para sempre e toda rota travava
    // (revisão 2026-10-12). Sem conexão pronta, ou sem resposta em 1 s, libera.
    if (redis.status !== "ready") {
      // eslint-disable-next-line no-console
      console.error(`[rate-limit] Redis ${redis.status} — request liberada sem limite`);
      return true;
    }
    const respostas = await Promise.race([
      redis.multi().incr(redisKey).expire(redisKey, options.windowSeconds, "NX").exec(),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 1000).unref()),
    ]);
    // Redis fora do ar: decisão DELIBERADA de falhar ABERTO (achado 2026-09-01)
    // — antes o incr lançava e TODA rota respondia 500 (indisponibilidade
    // total); melhor ficar sem rate limit por instantes do que sem site.
    if (!respostas || respostas[0]?.[0]) {
      // eslint-disable-next-line no-console
      console.error("[rate-limit] Redis indisponível — request liberada sem limite", respostas?.[0]?.[0]);
      return true;
    }
    const count = Number(respostas[0][1] ?? 0);

    if (count > options.limit) {
      throw new HttpException(
        "Muitas tentativas — aguarde um pouco antes de tentar de novo",
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    return true;
  }
}
