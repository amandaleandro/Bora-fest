import { z } from "zod";

export const updateLoyaltyProgramSchema = z.object({
  enabled: z.boolean(),
  pointsPerReal: z.number().int().min(0).max(100),
  silverPoints: z.number().int().min(0).max(10_000_000),
  goldPoints: z.number().int().min(0).max(10_000_000),
  platinumPoints: z.number().int().min(0).max(10_000_000),
}).superRefine((value, ctx) => {
  if (value.goldPoints < value.silverPoints) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["goldPoints"], message: "O nível Ouro deve começar depois do Prata" });
  }
  if (value.platinumPoints < value.goldPoints) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["platinumPoints"], message: "O nível Platina deve começar depois do Ouro" });
  }
});

export type UpdateLoyaltyProgramInput = z.infer<typeof updateLoyaltyProgramSchema>;
