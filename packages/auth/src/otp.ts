import { randomInt, createHash, timingSafeEqual } from "node:crypto";

export const OTP_LENGTH = 6;
export const OTP_TTL_MINUTES = 10;
export const OTP_MAX_ATTEMPTS = 5;

export function generateOtpCode(): string {
  return randomInt(0, 10 ** OTP_LENGTH).toString().padStart(OTP_LENGTH, "0");
}

export function hashOtpCode(code: string, destination: string): string {
  return createHash("sha256").update(`${destination}:${code}`).digest("hex");
}

export function verifyOtpCode(code: string, destination: string, codeHash: string): boolean {
  const candidate = Buffer.from(hashOtpCode(code, destination), "hex");
  const expected = Buffer.from(codeHash, "hex");
  if (candidate.length !== expected.length) return false;
  return timingSafeEqual(candidate, expected);
}
