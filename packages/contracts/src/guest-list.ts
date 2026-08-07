import { z } from "zod";

export const createGuestListEntrySchema = z.object({
  ticketLotId: z.string().uuid(),
  guestName: z.string().min(2).max(120),
  /** CPF opcional — sem formatação obrigatória, validado pela portaria no check-in */
  guestDocument: z.string().min(3).max(20).optional(),
  guestPhone: z.string().min(8).max(20).optional(),
  /** parceiro de vendas que trouxe o convidado (omitido = cadastrado direto pela casa) */
  salesPartnerId: z.string().uuid().optional(),
});
export type CreateGuestListEntryInput = z.infer<typeof createGuestListEntrySchema>;
