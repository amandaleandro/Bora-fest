import { MockGateway, MOCK_PROVIDER } from "./mock";
import { PagarmeGateway, PAGARME_PROVIDER } from "./pagarme";
import type { PaymentGateway } from "./types";

const gateways = new Map<string, PaymentGateway>();

function ensureBuiltins(): void {
  if (!gateways.has(MOCK_PROVIDER)) {
    gateways.set(MOCK_PROVIDER, new MockGateway());
  }
  if (!gateways.has(PAGARME_PROVIDER)) {
    // primário (decisão 2026-07-23) — env lida por chamada, troca é só
    // PAYMENTS_PROVIDER; futuros adapters (asaas, celcoin...) entram aqui
    gateways.set(PAGARME_PROVIDER, new PagarmeGateway());
  }
}

export function registerGateway(gateway: PaymentGateway): void {
  gateways.set(gateway.provider, gateway);
}

export class UnknownGatewayError extends Error {
  constructor(provider: string) {
    super(`Gateway de pagamento desconhecido: ${provider}`);
  }
}

export function getGateway(provider: string): PaymentGateway {
  ensureBuiltins();
  const gateway = gateways.get(provider);
  if (!gateway) throw new UnknownGatewayError(provider);
  return gateway;
}

/** Provedor padrão da plataforma (env PAYMENTS_PROVIDER; mock em dev). */
export function getDefaultGateway(): PaymentGateway {
  return getGateway(process.env.PAYMENTS_PROVIDER ?? MOCK_PROVIDER);
}
