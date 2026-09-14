import { z } from "zod";

export const configureVipDepositSchema = z.object({
  /** 0 remove a exigência, desde que ainda não exista cobrança ativa/paga. */
  depositCents: z.number().int().min(0).max(100_000_000),
  paymentDueAt: z.string().datetime().nullable().optional(),
});
export type ConfigureVipDepositInput = z.infer<typeof configureVipDepositSchema>;

export const createVipPixPaymentSchema = z.object({
  payerDocument: z
    .string()
    .trim()
    .transform((value) => value.replace(/\D/g, ""))
    .refine((value) => value.length === 11 || value.length === 14, "Informe um CPF ou CNPJ válido"),
  payerPhone: z
    .string()
    .trim()
    .transform((value) => value.replace(/\D/g, ""))
    .refine((value) => value.length >= 10 && value.length <= 13, "Informe um telefone com DDD válido")
    .optional(),
});
export type CreateVipPixPaymentInput = z.infer<typeof createVipPixPaymentSchema>;
