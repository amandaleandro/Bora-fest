import { AsaasGateway, ASAAS_PROVIDER } from "./asaas";
import { MercadoPagoGateway, MERCADOPAGO_PROVIDER } from "./mercadopago";
import { MockGateway, MOCK_PROVIDER } from "./mock";
import { PagarmeGateway, PAGARME_PROVIDER } from "./pagarme";
import type { PaymentGateway } from "./types";

const gateways = new Map<string, PaymentGateway>();

function ensureBuiltins(): void {
  if (!gateways.has(MOCK_PROVIDER)) {
    gateways.set(MOCK_PROVIDER, new MockGateway());
  }
  if (!gateways.has(PAGARME_PROVIDER)) {
    // mantido vivo como alavanca de negociação e plano B (troca por env)
    gateways.set(PAGARME_PROVIDER, new PagarmeGateway());
  }
  if (!gateways.has(MERCADOPAGO_PROVIDER)) {
    // Pix em percentual (~0,99%) — viabiliza a taxa de R$ 1 sem prejuízo
    gateways.set(MERCADOPAGO_PROVIDER, new MercadoPagoGateway());
  }
  if (!gateways.has(ASAAS_PROVIDER)) {
    // primário (decisão 2026-07-28, pesquisa rodada 2): melhor custo com
    // escrow + KYC no PSP para o pré-lançamento
    gateways.set(ASAAS_PROVIDER, new AsaasGateway());
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

export type PaymentMethodRoute = "PIX" | "CARD";

/**
 * Roteamento por MÉTODO (decisão 2026-08-11): Pix e cartão podem viver em
 * provedores diferentes — hoje Pix no Mercado Pago (percentual) e cartão no
 * Asaas (tarifa melhor). Sem as variáveis, tudo cai no PAYMENTS_PROVIDER.
 *
 * PAYMENTS_PROVIDER_PIX / PAYMENTS_PROVIDER_CARD
 */
export function getGatewayForMethod(method: PaymentMethodRoute): PaymentGateway {
  const especifico =
    method === "PIX" ? process.env.PAYMENTS_PROVIDER_PIX : process.env.PAYMENTS_PROVIDER_CARD;
  return getGateway(especifico || process.env.PAYMENTS_PROVIDER || MOCK_PROVIDER);
}

/**
 * Provedor reserva do método (PAYMENTS_FALLBACK_PIX / PAYMENTS_FALLBACK_CARD).
 *
 * É a defesa contra o incidente que o Arthur viveu: se o provedor primário
 * começar a recusar/limitar no meio do pico, a venda migra sozinha para o
 * reserva em vez de o checkout simplesmente quebrar. null = sem reserva.
 */
export function getFallbackGatewayForMethod(method: PaymentMethodRoute): PaymentGateway | null {
  const nome =
    method === "PIX" ? process.env.PAYMENTS_FALLBACK_PIX : process.env.PAYMENTS_FALLBACK_CARD;
  if (!nome) return null;
  const primario = getGatewayForMethod(method).provider;
  if (nome === primario) return null;
  try {
    return getGateway(nome);
  } catch {
    return null;
  }
}
