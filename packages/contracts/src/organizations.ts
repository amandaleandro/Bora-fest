import { z } from "zod";

export const createOrganizationSchema = z.object({
  name: z.string().min(2),
  kind: z.enum(["INDIVIDUAL", "COMPANY"]),
  document: z.string().min(11),
});
export type CreateOrganizationInput = z.infer<typeof createOrganizationSchema>;

export const inviteMemberSchema = z.object({
  email: z.string().email(),
  roleKey: z.enum(["owner", "admin", "operator", "finance"]),
});
export type InviteMemberInput = z.infer<typeof inviteMemberSchema>;

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
