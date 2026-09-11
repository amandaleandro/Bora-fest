import { z } from "zod";

/**
 * Nova edição a partir de um evento existente. A operação copia apenas
 * configuração; dados operacionais nunca entram na nova edição.
 */
export const duplicateEventSchema = z.object({
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime(),
  title: z.string().trim().min(3).max(160).optional(),
  copyTicketCatalog: z.boolean().default(true),
});
export type DuplicateEventInput = z.infer<typeof duplicateEventSchema>;

/**
 * Atalho para casas recorrentes: desloca início/fim pelo mesmo número de dias
 * e cria a próxima edição como rascunho.
 */
export const nextEventEditionSchema = z.object({
  cadenceDays: z.number().int().min(1).max(365).default(7),
  title: z.string().trim().min(3).max(160).optional(),
  copyTicketCatalog: z.boolean().default(true),
});
export type NextEventEditionInput = z.infer<typeof nextEventEditionSchema>;
