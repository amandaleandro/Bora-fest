import { SetMetadata } from "@nestjs/common";

export const RATE_LIMIT_KEY = "rate_limit";

export interface RateLimitOptions {
  /** máximo de requisições na janela */
  limit: number;
  windowSeconds: number;
  /** prefixo pra não colidir chaves de rotas diferentes no Redis */
  keyPrefix: string;
  /** "ip" (padrão) conta por IP; "session" conta por SESSÃO LOGADA (hash do
   * Authorization) e cai em IP sem header — para rotas de operador, onde todos
   * os aparelhos da porta saem pelo MESMO IP do Wi-Fi e um balde só travava a
   * venda no pico (auditoria 2026-09-12); "body:<campo>" combina IP + um campo do corpo
   * (ex.: "body:destination" no OTP, pra não deixar spammar UM destinatário
   * de IPs diferentes). */
  by?: "ip" | "session" | `body:${string}` | `params:${string}`;
}

/** Limite de requisições por janela de tempo, contado no Redis (§15 da arquitetura). */
export const RateLimit = (options: RateLimitOptions) => SetMetadata(RATE_LIMIT_KEY, options);
