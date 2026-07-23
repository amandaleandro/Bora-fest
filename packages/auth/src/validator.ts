import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";

/**
 * Credenciais do app de check-in (§12): PIN curto por evento para a equipe
 * de portaria + token longo por aparelho registrado. Mesmo padrão de hash do
 * OTP (sha256 com escopo + comparação em tempo constante).
 */

export const VALIDATOR_PIN_LENGTH = 6;

export function generateValidatorPin(): string {
  return randomInt(0, 10 ** VALIDATOR_PIN_LENGTH)
    .toString()
    .padStart(VALIDATOR_PIN_LENGTH, "0");
}

export function hashValidatorPin(pin: string, eventId: string): string {
  return createHash("sha256").update(`validator-pin:${eventId}:${pin}`).digest("hex");
}

export function verifyValidatorPin(pin: string, eventId: string, pinHash: string): boolean {
  return safeEqualHex(hashValidatorPin(pin, eventId), pinHash);
}

export function generateDeviceToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashDeviceToken(token: string): string {
  return createHash("sha256").update(`validator-device:${token}`).digest("hex");
}

export function verifyDeviceToken(token: string, tokenHash: string): boolean {
  return safeEqualHex(hashDeviceToken(token), tokenHash);
}

function safeEqualHex(candidateHex: string, expectedHex: string): boolean {
  const candidate = Buffer.from(candidateHex, "hex");
  const expected = Buffer.from(expectedHex, "hex");
  if (candidate.length !== expected.length) return false;
  return timingSafeEqual(candidate, expected);
}
