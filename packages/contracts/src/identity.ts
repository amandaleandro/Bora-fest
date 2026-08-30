import { z } from "zod";

export const requestOtpSchema = z
  .object({
    // destino validado por canal (auditoria 2026-08-29): sem formato, `destination`
    // cru virava chave de rate limit e dava pra bombardear e-mail de terceiro
    // com variações. E-mail é normalizado em minúsculas; telefone só dígitos.
    destination: z.string().min(3).max(160).trim(),
    channel: z.enum(["EMAIL", "SMS", "WHATSAPP"]),
  })
  .transform((v) => ({ ...v, destination: v.destination.toLowerCase() }))
  .refine(
    (v) =>
      v.channel === "EMAIL"
        ? /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v.destination)
        : /^\+?\d{10,15}$/.test(v.destination.replace(/\D/g, "")),
    { message: "Destino inválido para o canal escolhido", path: ["destination"] },
  );
export type RequestOtpInput = z.infer<typeof requestOtpSchema>;

export const verifyOtpSchema = z.object({
  destination: z.string().min(3),
  code: z.string().length(6),
});
export type VerifyOtpInput = z.infer<typeof verifyOtpSchema>;

/** PATCH /v1/me — verificação/edição da conta (decisão 2026-08-15: conta
 * verificada = tem CPF; necessário para receber/transferir ingresso nominal). */
export const updateMeSchema = z.object({
  name: z.string().min(2).max(120).optional(),
  cpf: z.string().min(11).max(14).optional(),
  notifyWhatsapp: z.boolean().optional(),
  notifyEmailOffers: z.boolean().optional(),
});
export type UpdateMeInput = z.infer<typeof updateMeSchema>;

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
