import { ed25519 } from "@noble/curves/ed25519";

/**
 * Verificação Ed25519 do QR no próprio aparelho — é o que sustenta a regra
 * inegociável da v2 ("sem manifesto local sincronizado, NUNCA aprovar").
 * Mesma lógica do app nativo (apps/mobile-checkin/src/qr/verifyTicketToken.ts):
 * `@noble/curves` em JS puro, sem `node:crypto`, então roda no navegador.
 *
 * O servidor assina os BYTES ASCII do payload em base64url
 * (packages/tickets/src/qr-token.ts); aqui reproduzimos exatamente isso.
 */

const BASE64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

export const TICKET_TOKEN_PREFIX = "BF1";

export interface TicketTokenPayload {
  v: number;
  /** event id */
  eid: string;
  /** ticket id */
  tid: string;
  /** ticket lot id */
  lid: string;
  n: string;
  iat: number;
}

function base64ToBytes(input: string): Uint8Array {
  const base64 = input.replace(/-/g, "+").replace(/_/g, "/");
  const bytes: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const char of base64) {
    const value = BASE64_ALPHABET.indexOf(char);
    if (value === -1) continue; // ignora '=' e quebras de linha
    buffer = (buffer << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 0xff);
    }
  }
  return Uint8Array.from(bytes);
}

function asciiToBytes(input: string): Uint8Array {
  const bytes = new Uint8Array(input.length);
  for (let i = 0; i < input.length; i++) {
    bytes[i] = input.charCodeAt(i) & 0xff;
  }
  return bytes;
}

/**
 * PEM SPKI → chave crua de 32 bytes. O DER de uma chave pública Ed25519
 * (RFC 8410) tem 12 bytes de cabeçalho + os 32 bytes da chave no final.
 */
export function pemToRawEd25519PublicKey(pem: string): Uint8Array {
  const body = pem
    .replace(/-----BEGIN PUBLIC KEY-----/g, "")
    .replace(/-----END PUBLIC KEY-----/g, "")
    .replace(/\s+/g, "");
  const der = base64ToBytes(body);
  if (der.length < 32) throw new Error("Chave pública Ed25519 inválida");
  return der.slice(der.length - 32);
}

/** true somente se a assinatura confere com a chave pública do evento. Nunca lança. */
export function verifyTicketTokenSignature(token: string, publicKeyPem: string): boolean {
  try {
    const parts = token.split(".");
    if (parts.length !== 3 || parts[0] !== TICKET_TOKEN_PREFIX) return false;

    const message = asciiToBytes(parts[1]);
    const signature = base64ToBytes(parts[2]);
    if (signature.length !== 64) return false;

    return ed25519.verify(signature, message, pemToRawEd25519PublicKey(publicKeyPem));
  } catch {
    return false;
  }
}

/** Lê o payload SEM validar assinatura — use sempre junto de verifyTicketTokenSignature. */
export function parseTicketTokenPayload(token: string): TicketTokenPayload | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3 || parts[0] !== TICKET_TOKEN_PREFIX) return null;
    const json = new TextDecoder().decode(base64ToBytes(parts[1]));
    const payload = JSON.parse(json) as TicketTokenPayload;
    if (!payload || payload.v !== 1 || !payload.tid || !payload.eid) return null;
    return payload;
  } catch {
    return null;
  }
}

export function isTicketToken(raw: string): boolean {
  return raw.startsWith(`${TICKET_TOKEN_PREFIX}.`);
}
