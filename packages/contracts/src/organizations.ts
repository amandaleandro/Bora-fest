import { z } from "zod";

export const producerTypeSchema = z.enum(["CASA", "ATLETICA", "PRODUTORA", "INDEPENDENTE", "OUTRO"]);
export type ProducerTypeInput = z.infer<typeof producerTypeSchema>;

export const createOrganizationSchema = z.object({
  name: z.string().min(2),
  kind: z.enum(["INDIVIDUAL", "COMPANY"]),
  document: z.string().min(11),
  /** classificação comercial — obrigatória no cadastro novo */
  producerType: producerTypeSchema,
});
export type CreateOrganizationInput = z.infer<typeof createOrganizationSchema>;

export const inviteMemberSchema = z.object({
  email: z.string().email(),
  roleKey: z.enum(["owner", "admin", "operator", "finance", "seller"]),
  partnerId: z.string().uuid().optional(),
});
export type InviteMemberInput = z.infer<typeof inviteMemberSchema>;

export const createSalesPartnerSchema = z.object({
  name: z.string().min(2),
  commissionBps: z.number().int().min(0).max(10000).default(0),
});
export type CreateSalesPartnerInput = z.infer<typeof createSalesPartnerSchema>;

export const createBankAccountSchema = z.object({
  holderName: z.string().min(2),
  holderDocument: z.string().min(11).max(18),
  bankCode: z.string().min(3).max(3),
  agency: z.string().min(1).max(6),
  account: z.string().min(1).max(15),
  accountType: z.enum(["corrente", "poupanca"]),
  pixKey: z.string().optional(),
});
export type CreateBankAccountInput = z.infer<typeof createBankAccountSchema>;

/** Atualização do perfil público da organização (nome comercial etc.). */
export const updateOrganizationSchema = z.object({
  /** nome mostrado ao público no lugar do nome civil/razão social */
  displayName: z.string().trim().min(2).max(80).nullable().optional(),
});
export type UpdateOrganizationInput = z.infer<typeof updateOrganizationSchema>;

/**
 * Convite de promoter (Promoter v3): a CASA convida uma PESSOA por e-mail.
 * Comissão definida pela casa: NONE (só contabiliza, dinheiro fica com a casa),
 * PERCENT (% do ingresso) ou FIXED (valor por ingresso). Promoter não precisa
 * ser produtor — conta simples basta; chave Pix só ao sacar.
 */
export const invitePromoterSchema = z
  .object({
    email: z.string().email(),
    /** escopo: ausente = todos os eventos da casa; presente = SÓ este evento */
    eventId: z.string().uuid().optional(),
    commissionType: z.enum(["NONE", "PERCENT", "FIXED"]).default("NONE"),
    /** PERCENT: bps (500 = 5%) */
    commissionBps: z.number().int().min(0).max(5000).optional(),
    /** FIXED: centavos por ingresso vendido */
    commissionFixedCents: z.number().int().min(0).max(1_000_000).optional(),
  })
  .refine((v) => v.commissionType !== "PERCENT" || (v.commissionBps ?? 0) > 0, {
    message: "Comissão percentual precisa de um valor maior que zero",
  })
  .refine((v) => v.commissionType !== "FIXED" || (v.commissionFixedCents ?? 0) > 0, {
    message: "Comissão fixa precisa de um valor por ingresso maior que zero",
  });
export type InvitePromoterInput = z.infer<typeof invitePromoterSchema>;

/** Convite de vendedor (nível 3): o promoter convida uma pessoa por e-mail. Vendedor nunca recebe pela plataforma. */
export const inviteSellerSchema = z.object({
  email: z.string().email(),
});
export type InviteSellerInput = z.infer<typeof inviteSellerSchema>;
