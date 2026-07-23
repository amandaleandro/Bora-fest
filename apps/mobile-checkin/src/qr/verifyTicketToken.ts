import { ed25519 } from "@noble/curves/ed25519";

/**
 * Verificação REAL da assinatura Ed25519 do QR no aparelho (§12) — fecha a
 * limitação documentada da primeira entrega do app. Usa `@noble/curves`
 * (JS puro, auditada, sem `node:crypto`), então funciona no Hermes.
 *
 * O servidor assina os BYTES ASCII do payload em base64url
 * (`packages/tickets/src/qr-token.ts`); aqui reproduzimos exatamente isso.
 */

const BASE64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

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
  if (der.length < 32) {
    throw new Error("Chave pública Ed25519 inválida");
  }
  return der.slice(der.length - 32);
}

/**
 * true somente se a assinatura do token confere com a chave pública do
 * evento (baixada no manifesto). Nunca lança — QR malformado retorna false.
 */
export function verifyTicketTokenSignature(token: string, publicKeyPem: string): boolean {
  try {
    const parts = token.split(".");
    if (parts.length !== 3 || parts[0] !== "BF1") return false;

    const message = asciiToBytes(parts[1]);
    const signature = base64ToBytes(parts[2]);
    if (signature.length !== 64) return false;

    const publicKey = pemToRawEd25519PublicKey(publicKeyPem);
    return ed25519.verify(signature, message, publicKey);
  } catch {
    return false;
  }
}
