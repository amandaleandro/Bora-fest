import { createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify } from "crypto";

/**
 * QR do ingresso (arquitetura §12): token compacto assinado com Ed25519,
 * verificável offline pelo app de check-in com a chave pública do evento.
 *
 * Formato: `BF1.<payload base64url>.<assinatura base64url>`
 */

export const TICKET_TOKEN_PREFIX = "BF1";

export interface TicketTokenPayload {
  /** versão do formato */
  v: 1;
  /** event id */
  eid: string;
  /** ticket id */
  tid: string;
  /** ticket lot id (setor/lote para regra de portão) */
  lid: string;
  /** nonce aleatório — impede reconstrução do token a partir de dados públicos */
  n: string;
  /** issued at (epoch segundos) */
  iat: number;
}

export interface EventKeyPairPem {
  publicKeyPem: string;
  privateKeyPem: string;
}

export function generateEventKeyPair(): EventKeyPairPem {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  return {
    publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
    privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  };
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

export function signTicketToken(payload: TicketTokenPayload, privateKeyPem: string): string {
  const encoded = base64url(JSON.stringify(payload));
  const key = createPrivateKey(privateKeyPem);
  const signature = sign(null, Buffer.from(encoded), key);
  return `${TICKET_TOKEN_PREFIX}.${encoded}.${signature.toString("base64url")}`;
}

export class InvalidTicketTokenError extends Error {}

export function parseTicketToken(token: string): TicketTokenPayload {
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== TICKET_TOKEN_PREFIX) {
    throw new InvalidTicketTokenError("Formato de token de ingresso inválido");
  }
  try {
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    if (payload?.v !== 1 || !payload.tid || !payload.eid) {
      throw new InvalidTicketTokenError("Payload de token de ingresso inválido");
    }
    return payload as TicketTokenPayload;
  } catch (error) {
    if (error instanceof InvalidTicketTokenError) throw error;
    throw new InvalidTicketTokenError("Payload de token de ingresso ilegível");
  }
}

/** Verifica assinatura e retorna o payload; lança InvalidTicketTokenError se inválido. */
export function verifyTicketToken(token: string, publicKeyPem: string): TicketTokenPayload {
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== TICKET_TOKEN_PREFIX) {
    throw new InvalidTicketTokenError("Formato de token de ingresso inválido");
  }
  const key = createPublicKey(publicKeyPem);
  const ok = verify(null, Buffer.from(parts[1]), key, Buffer.from(parts[2], "base64url"));
  if (!ok) {
    throw new InvalidTicketTokenError("Assinatura do ingresso inválida");
  }
  return parseTicketToken(token);
}
