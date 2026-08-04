/**
 * Proteção contra gateway lento/instável sob pico de checkouts simultâneos
 * (arquitetura §11 — evitar que uma chamada externa lenta segure conexões e
 * gere efeito cascata). Duas peças:
 *
 * - `fetchWithTimeout`: nunca deixa uma chamada ao PSP pendurada — aborta e
 *   falha rápido em vez de acumular requisições esperando.
 * - `CircuitBreaker`: depois de falhas seguidas, para de tentar por um
 *   período (fail-fast) em vez de deixar cada novo checkout esperar o mesmo
 *   timeout — dá tempo do gateway se recuperar sem ficar sob mais carga.
 */

export class GatewayTimeoutError extends Error {
  constructor(ms: number) {
    super(`Gateway não respondeu em ${ms}ms`);
  }
}

export class CircuitOpenError extends Error {
  constructor(provider: string) {
    super(`Gateway ${provider} temporariamente indisponível (circuito aberto)`);
  }
}

export async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new GatewayTimeoutError(timeoutMs);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

interface CircuitBreakerOptions {
  provider: string;
  /** falhas seguidas até abrir o circuito */
  failureThreshold: number;
  /** quanto tempo o circuito fica aberto antes de deixar 1 chamada testar de novo */
  resetTimeoutMs: number;
}

/**
 * Circuit breaker simples de processo único (cada instância da API tem o
 * seu) — não precisa de estado compartilhado: sob pico real, todas as
 * instâncias vêem as mesmas falhas do gateway e abrem o circuito quase
 * junto.
 */
export class CircuitBreaker {
  private state: "CLOSED" | "OPEN" | "HALF_OPEN" = "CLOSED";
  private consecutiveFailures = 0;
  private openedAt = 0;

  constructor(private readonly options: CircuitBreakerOptions) {}

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === "OPEN") {
      if (Date.now() - this.openedAt < this.options.resetTimeoutMs) {
        throw new CircuitOpenError(this.options.provider);
      }
      this.state = "HALF_OPEN"; // deixa 1 chamada testar se já recuperou
    }

    try {
      const result = await fn();
      this.consecutiveFailures = 0;
      this.state = "CLOSED";
      return result;
    } catch (error) {
      this.consecutiveFailures++;
      if (this.state === "HALF_OPEN" || this.consecutiveFailures >= this.options.failureThreshold) {
        this.state = "OPEN";
        this.openedAt = Date.now();
      }
      throw error;
    }
  }
}
