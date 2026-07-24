import { z } from "zod";

export const requestOtpSchema = z.object({
  destination: z.string().min(3),
  channel: z.enum(["EMAIL", "SMS", "WHATSAPP"]),
});
export type RequestOtpInput = z.infer<typeof requestOtpSchema>;

export const verifyOtpSchema = z.object({
  destination: z.string().min(3),
  code: z.string().length(6),
});
export type VerifyOtpInput = z.infer<typeof verifyOtpSchema>;

export const registerSchema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(8),
  /** aceite explícito de Termos + Privacidade (LGPD) */
  acceptTerms: z.literal(true),
});
export type RegisterInput = z.infer<typeof registerSchema>;

export const passwordLoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});
export type PasswordLoginInput = z.infer<typeof passwordLoginSchema>;

export const recoverPasswordSchema = z.object({
  email: z.string().email(),
});
export type RecoverPasswordInput = z.infer<typeof recoverPasswordSchema>;

export const resetPasswordSchema = z.object({
  token: z.string().min(16),
  password: z.string().min(8),
});
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
