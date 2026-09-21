import { z } from "zod";

export const storeProductStatusSchema = z.enum(["DRAFT", "ACTIVE", "ARCHIVED"]);

const httpImageUrl = z
  .string()
  .url()
  .max(500)
  .refine(
    (value) => /^https:\/\//i.test(value) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//i.test(value),
    "Use HTTPS (HTTP apenas em localhost)",
  );
export type StoreProductStatusInput = z.infer<typeof storeProductStatusSchema>;

export const createStoreProductSchema = z.object({
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(1200).optional(),
  imageUrl: httpImageUrl.optional(),
});
export type CreateStoreProductInput = z.infer<typeof createStoreProductSchema>;

export const updateStoreProductSchema = createStoreProductSchema.partial().extend({
  status: storeProductStatusSchema.optional(),
});
export type UpdateStoreProductInput = z.infer<typeof updateStoreProductSchema>;

export const createStoreVariantSchema = z.object({
  name: z.string().trim().min(1).max(80),
  sku: z.string().trim().min(1).max(80).optional(),
  priceCents: z.number().int().min(0),
  stockTotal: z.number().int().min(0).max(1_000_000),
});
export type CreateStoreVariantInput = z.infer<typeof createStoreVariantSchema>;

export const updateStoreVariantSchema = createStoreVariantSchema.partial().extend({
  active: z.boolean().optional(),
});
export type UpdateStoreVariantInput = z.infer<typeof updateStoreVariantSchema>;
