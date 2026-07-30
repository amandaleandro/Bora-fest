import { z } from "zod";

export const createPixPaymentSchema = z.object({
  /** CPF/CNPJ do pagador — alguns PSPs exigem para Pix */
  payerDocument: z.string().min(11).max(18).optional(),
  /** celular com DDD (Pagar.me pede customer completo no Pix) */
  payerPhone: z.string().min(10).max(20).optional(),
});
export type CreatePixPaymentInput = z.infer<typeof createPixPaymentSchema>;

export const rawCardSchema = z.object({
  number: z.string().min(13).max(23),
  holderName: z.string().min(2).max(100),
  expiryMonth: z.string().regex(/^(0[1-9]|1[0-2])$/),
  expiryYear: z.string().regex(/^\d{4}$/),
  ccv: z.string().regex(/^\d{3,4}$/),
  holderCpf: z.string().min(11).max(18),
  postalCode: z.string().min(8).max(10),
  addressNumber: z.string().min(1).max(10),
});

export const createCardPaymentSchema = z
  .object({
    /** token do provedor (Pagar.me/mock) — OU `card` cru p/ gateways server-side (Asaas) */
    cardToken: z.string().min(8).optional(),
    card: rawCardSchema.optional(),
    installments: z.number().int().min(1).max(12).default(1),
    payerDocument: z.string().min(11).max(18).optional(),
  })
  .refine((v) => v.cardToken || v.card, { message: "Informe cardToken ou card" });
export type CreateCardPaymentInput = z.infer<typeof createCardPaymentSchema>;
