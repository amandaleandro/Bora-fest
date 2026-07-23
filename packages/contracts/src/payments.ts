import { z } from "zod";

export const createPixPaymentSchema = z.object({
  /** CPF/CNPJ do pagador — alguns PSPs exigem para Pix */
  payerDocument: z.string().min(11).max(18).optional(),
});
export type CreatePixPaymentInput = z.infer<typeof createPixPaymentSchema>;

export const createCardPaymentSchema = z.object({
  /** token do cartão gerado pelo provedor no navegador — nunca o PAN */
  cardToken: z.string().min(8),
  installments: z.number().int().min(1).max(12).default(1),
  payerDocument: z.string().min(11).max(18).optional(),
});
export type CreateCardPaymentInput = z.infer<typeof createCardPaymentSchema>;
