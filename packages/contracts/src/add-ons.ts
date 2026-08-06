import { z } from "zod";

export const createAddOnSchema = z.object({
  name: z.string().min(2).max(80),
  description: z.string().max(300).optional(),
  priceCents: z.number().int().min(0),
});
export type CreateAddOnInput = z.infer<typeof createAddOnSchema>;

export const updateAddOnSchema = createAddOnSchema.partial().extend({
  active: z.boolean().optional(),
});
export type UpdateAddOnInput = z.infer<typeof updateAddOnSchema>;

/** Seleção de itens adicionais no checkout — vai junto com o pedido. */
export const orderAddOnSelectionSchema = z.object({
  addOnId: z.string().uuid(),
  quantity: z.number().int().min(1).max(20),
});
export type OrderAddOnSelectionInput = z.infer<typeof orderAddOnSelectionSchema>;
