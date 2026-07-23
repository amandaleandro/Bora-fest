import { z } from "zod";

/** Registro de token de push (Expo) — escopo é o pedido, não exige conta. */
export const registerPushTokenSchema = z.object({
  token: z.string().min(10),
  platform: z.enum(["ios", "android"]),
});
export type RegisterPushTokenInput = z.infer<typeof registerPushTokenSchema>;
