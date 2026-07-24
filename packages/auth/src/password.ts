import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

/**
 * Senha do painel do produtor (protótipo: login e-mail/senha, mín. 8 chars).
 * scrypt com salt aleatório por usuário; formato `scrypt$<salt>$<hash>`.
 * Compradores continuam sem senha (OTP) — decisão de produto.
 */

const KEY_LENGTH = 64;

export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_RESET_TTL_MINUTES = 30;

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("base64url");
  const hash = scryptSync(password, salt, KEY_LENGTH).toString("base64url");
  return `scrypt$${salt}$${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  const candidate = scryptSync(password, parts[1], KEY_LENGTH);
  const expected = Buffer.from(parts[2], "base64url");
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

/** Token de redefinição: o valor cru vai no link; só o hash é persistido. */
export function generateResetToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: hashResetToken(token) };
}

export function hashResetToken(token: string): string {
  return scryptSync(token, "borafest-password-reset", 32).toString("base64url");
}
