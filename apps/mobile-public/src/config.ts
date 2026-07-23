/**
 * Base da API. "localhost" não funciona a partir de um celular físico nem
 * do emulador Android — use o IP da sua máquina na rede local
 * (EXPO_PUBLIC_API_URL=http://192.168.0.10:3333) ou 10.0.2.2 no emulador
 * Android.
 */
export const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:3333";

/**
 * Chave PÚBLICA (pk_) do Pagar.me pra tokenizar cartão direto do app, sem
 * passar o PAN pelo nosso backend (mesmo princípio do tokenizecard.js usado
 * no checkout web). Sem essa env configurada, `tokenizeCard()` cai no modo
 * mock (só funciona contra o MockGateway em dev — ver src/payments/tokenizeCard.ts).
 */
export const PAGARME_PUBLIC_KEY = process.env.EXPO_PUBLIC_PAGARME_PUBLIC_KEY ?? null;
