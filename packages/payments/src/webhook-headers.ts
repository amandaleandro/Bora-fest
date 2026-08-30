import type { WebhookHeaders } from "./types";

/**
 * Cabeçalhos que provam a autenticidade do webhook — NUNCA podem ser
 * persistidos nem devolvidos por nenhuma rota (auditoria de segurança
 * 2026-08-29). O token do Asaas, por exemplo, é a única prova de "pagamento
 * aprovado"; gravado em claro em `webhook_deliveries` e servido por
 * GET /v1/admin/webhooks, quem o lesse forjaria uma confirmação de pagamento.
 *
 * A verificação de assinatura usa os cabeçalhos crus na hora; só o que sobra
 * DEPOIS disso é que pode virar registro de auditoria.
 */
const SEGREDOS = new Set([
  "authorization",
  "cookie",
  "asaas-access-token",
  "x-signature",
  "x-hub-signature",
  "x-hub-signature-256",
  "x-webhook-signature",
  "x-request-signature",
  "x-mp-signature",
  "signature",
]);

/** Remove os cabeçalhos secretos antes de qualquer gravação/resposta. */
export function stripSecretHeaders(
  headers: WebhookHeaders,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (SEGREDOS.has(key.toLowerCase())) continue;
    out[key] = Array.isArray(value) ? value.join(",") : (value ?? "");
  }
  return out;
}
