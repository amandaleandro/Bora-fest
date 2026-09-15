import { z } from "zod";
import { ehCpfValido, normalizarCpf } from "./cpf";

export const createGuestListEntrySchema = z.object({
  ticketLotId: z.string().uuid(),
  guestName: z.string().min(2).max(120),
  /**
   * CPF OBRIGATÓRIO na lista (decisão do Arthur, 2026-09-15).
   *
   * O convidado da lista não recebe QR nem código — ele chega na porta só com o
   * nome. Sem CPF, "sou o João Silva da lista do Pedro" basta para entrar, e a
   * lista circula em grupo de WhatsApp: é o mesmo buraco que tirou a cortesia do
   * balcão em 2026-09-07, por outra porta. Quem TEM ingresso continua provando
   * pela posse dele — por isso a exigência é só aqui.
   *
   * Antes isto era `string().min(3).max(20).optional()`, ou seja aceitava "RG 12"
   * e CPF com dígito errado. O estrago era silencioso: a portaria compara hash de
   * 11 dígitos, então um documento torto nunca casava e o operador lia "não
   * encontrado" — recusa que parecia legítima. Normalizado e validado na entrada.
   */
  guestDocument: z
    .string()
    .transform(normalizarCpf)
    .refine(ehCpfValido, "CPF inválido — confira os números"),
  guestPhone: z.string().min(8).max(20).optional(),
  /** parceiro de vendas que trouxe o convidado (omitido = cadastrado direto pela casa) */
  salesPartnerId: z.string().uuid().optional(),
});
export type CreateGuestListEntryInput = z.infer<typeof createGuestListEntrySchema>;
