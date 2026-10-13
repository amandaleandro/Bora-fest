import { z } from "zod";

export const createTicketTypeSchema = z.object({
  name: z.string().min(2),
  description: z.string().optional(),
  position: z.number().int().min(0).default(0),
});
export type CreateTicketTypeInput = z.infer<typeof createTicketTypeSchema>;

/**
 * "Quem pode pegar" restrito a convidados (formato Sympla, 2026-10-10/12):
 * NONE = aberto · LINK = some do site e só abre pelo link com o código do lote ·
 * EMAIL = só quem o produtor convidar por e-mail (convite pessoal).
 */
export const lotInviteModeSchema = z.enum(["NONE", "LINK", "EMAIL"]);
export type LotInviteModeInput = z.infer<typeof lotInviteModeSchema>;

export const createTicketLotSchema = z.object({
  /// BUYER = comprador paga preço+taxa · PRODUCER = produtor absorve
  feeMode: z.enum(["BUYER", "PRODUCER"]).optional(),
  nominal: z.boolean().optional(),
  requiresCpf: z.boolean().optional(),
  /// meia-entrada opt-in: só oferece 50% ao comprador se o produtor marcar
  halfPriceEnabled: z.boolean().optional(),
  /// só balcão: some do site; só a portaria (promoter) vende/emite
  pdvOnly: z.boolean().optional(),
  /** lote exclusivo: só aparece para quem chegou pelo link/código de um promoter */
  promoterOnly: z.boolean().optional(),
  /** restrito a convidados: LINK (link com o código do lote) ou EMAIL (convite pessoal por e-mail) */
  inviteMode: lotInviteModeSchema.optional(),
  /** ingressos deste lote por CPF, somando todos os pedidos; ausente = sem limite */
  limitPerCpf: z.number().int().min(1).max(20).optional(),
  name: z.string().min(2),
  priceCents: z.number().int().min(0),
  feeCents: z.number().int().min(0).default(0),
  capacity: z.number().int().min(1),
  maxPerOrder: z.number().int().min(1).max(20).default(6),
  /** janela de vendas do lote; ausente = começa já / sem data para parar */
  startsAt: z.string().datetime().optional(),
  endsAt: z.string().datetime().optional(),
  /**
   * VIRADA AUTOMÁTICA (2026-10-12): o lote nasce guardado (DRAFT) e abre
   * sozinho quando este lote anterior (do mesmo ingresso) esgotar ou for encerrado.
   */
  activateAfterLotId: z.string().uuid().optional(),
  /**
   * Já nasce à venda (2026-10-12): o painel criava e ativava em duas chamadas —
   * se a segunda falhasse, "tentar de novo" criava um lote repetido.
   * Não combina com activateAfterLotId.
   */
  activateNow: z.boolean().optional(),
});
export type CreateTicketLotInput = z.infer<typeof createTicketLotSchema>;

/**
 * EDITAR LOTE (2026-10-12): até aqui o lote só se criava, ativava, encerrava ou
 * apagava. Só os campos enviados mudam; `null` limpa (sem limite por CPF, sem
 * data, sem virada). As regras são as mesmas da criação — o servidor confere o
 * estado FINAL do lote, não só o que veio no pedido. O preço só muda enquanto
 * ninguém comprou nem reservou; a quantidade nunca fica abaixo do que já saiu.
 * Taxa, nominal e CPF obrigatório não se editam aqui.
 */
export const updateTicketLotSchema = z.object({
  name: z.string().trim().min(2).optional(),
  priceCents: z.number().int().min(0).optional(),
  capacity: z.number().int().min(1).optional(),
  maxPerOrder: z.number().int().min(1).max(20).optional(),
  limitPerCpf: z.number().int().min(1).max(20).nullable().optional(),
  startsAt: z.string().datetime().nullable().optional(),
  endsAt: z.string().datetime().nullable().optional(),
  inviteMode: lotInviteModeSchema.optional(),
  promoterOnly: z.boolean().optional(),
  pdvOnly: z.boolean().optional(),
  halfPriceEnabled: z.boolean().optional(),
  /** lote anterior da virada automática; null = deixa de esperar (só vale para lote que ainda não abriu) */
  activateAfterLotId: z.string().uuid().nullable().optional(),
});
export type UpdateTicketLotInput = z.infer<typeof updateTicketLotSchema>;
