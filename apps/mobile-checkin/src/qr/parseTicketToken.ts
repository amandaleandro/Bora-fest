/**
 * Decodifica (sem verificar assinatura) o payload de um QR de ingresso no
 * formato `BF1.<payload-base64url>.<assinatura-base64url>` — espelha
 * `packages/tickets/src/qr-token.ts`, mas sem depender de `node:crypto`
 * (que não existe em React Native). A verificação de assinatura de verdade
 * é sempre feita pelo servidor, tanto no scan online (`POST /v1/checkins`)
 * quanto na sincronização em lote — este parser serve só para o app
 * conseguir extrair `tid`/`eid` e fazer um pré-check local contra o
 * manifesto (mostrar "ingresso desconhecido" na hora, decidir se enfileira).
 */

const TOKEN_PREFIX = "BF1";

export interface TicketTokenPayload {
  v: 1;
  eid: string;
  tid: string;
  lid: string;
  n: string;
  iat: number;
}

export class InvalidTicketTokenError extends Error {}

const BASE64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/**
 * Base64url → UTF-8 sem depender de `atob`/`Buffer` (nenhum dos dois é
 * garantido no runtime Hermes do React Native).
 */
function base64UrlToString(input: string): string {
  const base64 = input.replace(/-/g, "+").replace(/_/g, "/");
  const bytes: number[] = [];
  let buffer = 0;
  let bits = 0;

  for (const char of base64) {
    const value = BASE64_ALPHABET.indexOf(char);
    if (value === -1) continue;
    buffer = (buffer << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 0xff);
    }
  }

  let result = "";
  for (const byte of bytes) {
    result += String.fromCharCode(byte);
  }
  return decodeURIComponent(escape(result));
}

export function parseTicketToken(token: string): TicketTokenPayload {
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== TOKEN_PREFIX) {
    throw new InvalidTicketTokenError("Formato de QR desconhecido");
  }

  let payload: unknown;
  try {
    payload = JSON.parse(base64UrlToString(parts[1]));
  } catch {
    throw new InvalidTicketTokenError("Payload do QR ilegível");
  }

  if (
    typeof payload !== "object" ||
    payload === null ||
    (payload as any).v !== 1 ||
    typeof (payload as any).eid !== "string" ||
    typeof (payload as any).tid !== "string" ||
    typeof (payload as any).lid !== "string"
  ) {
    throw new InvalidTicketTokenError("Payload do QR incompleto");
  }

  return payload as TicketTokenPayload;
}

/** true se a string parece um QR de ingresso (não garante validade). */
export function looksLikeTicketToken(value: string): boolean {
  return value.startsWith(`${TOKEN_PREFIX}.`);
}
