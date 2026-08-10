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

/** Convite de promoter (afiliado por conta de produtor). commissionBps = 0 → só contabiliza. */
export const invitePromoterSchema = z.object({
  promoterOrgId: z.string().uuid(),
  /** % do valor dos INGRESSOS (bps: 500 = 5%); 0 = sem repasse, só contagem */
  commissionBps: z.number().int().min(0).max(5000).default(0),
});
export type InvitePromoterInput = z.infer<typeof invitePromoterSchema>;
