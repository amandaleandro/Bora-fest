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
