import { SetMetadata } from "@nestjs/common";

export const RATE_LIMIT_KEY = "rate_limit";

export interface RateLimitOptions {
  /** máximo de requisições na janela */
  limit: number;
  windowSeconds: number;
  /** prefixo pra não colidir chaves de rotas diferentes no Redis */
  keyPrefix: string;
  /** "ip" (padrão) conta por IP; "body:<campo>" combina IP + um campo do corpo
   * (ex.: "body:destination" no OTP, pra não deixar spammar UM destinatário
   * de IPs diferentes). */
  by?: "ip" | `body:${string}`;
}

/** Limite de requisições por janela de tempo, contado no Redis (§15 da arquitetura). */
export const RateLimit = (options: RateLimitOptions) => SetMetadata(RATE_LIMIT_KEY, options);
