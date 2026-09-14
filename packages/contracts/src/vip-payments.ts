import { z } from "zod";

export const configureVipDepositSchema = z.object({
  /** 0 remove a exigência, desde que ainda não exista cobrança ativa/paga. */
  depositCents: z.number().int().min(0).max(100_000_000),
  paymentDueAt: z.string().datetime().nullable().optional(),
});
export type ConfigureVipDepositInput = z.infer<typeof configureVipDepositSchema>;
