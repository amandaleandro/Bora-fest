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


export const storeShippingAddressSchema = z.object({
  postalCode: z.string().trim().min(8).max(10),
  street: z.string().trim().min(2).max(180),
  number: z.string().trim().min(1).max(30),
  complement: z.string().trim().max(120).optional(),
  neighborhood: z.string().trim().min(2).max(120),
  city: z.string().trim().min(2).max(120),
  state: z.string().trim().length(2).transform((value) => value.toUpperCase()),
});

export const createStoreOrderSchema = z.object({
  items: z.array(z.object({
    variantId: z.string().uuid(),
    quantity: z.number().int().min(1).max(20),
  })).min(1).max(20),
  contactName: z.string().trim().min(2).max(120),
  contactEmail: z.string().trim().email().max(254),
  contactPhone: z.string().trim().min(8).max(30).optional(),
  fulfillmentMethod: z.enum(["PICKUP", "DELIVERY"]).default("PICKUP"),
  shippingAddress: storeShippingAddressSchema.optional(),
}).superRefine((value, ctx) => {
  if (value.fulfillmentMethod === "DELIVERY" && !value.shippingAddress) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["shippingAddress"], message: "Informe o endereço de entrega" });
  }
});
export type CreateStoreOrderInput = z.infer<typeof createStoreOrderSchema>;

export const createStorePixPaymentSchema = z.object({
  payerDocument: z.string().trim().min(11).max(18).optional(),
  payerPhone: z.string().trim().min(8).max(30).optional(),
});
export type CreateStorePixPaymentInput = z.infer<typeof createStorePixPaymentSchema>;

export const fulfillStoreOrderSchema = z.object({
  pickupCode: z.string().trim().min(6).max(20),
});
export type FulfillStoreOrderInput = z.infer<typeof fulfillStoreOrderSchema>;


export const requestStoreRefundSchema = z.object({
  reason: z.string().trim().min(3).max(1000),
});
export type RequestStoreRefundInput = z.infer<typeof requestStoreRefundSchema>;

export const rejectStoreRefundSchema = z.object({
  note: z.string().trim().min(3).max(1000),
});
export type RejectStoreRefundInput = z.infer<typeof rejectStoreRefundSchema>;


export const updateStoreSettingsSchema = z.object({
  pickupEnabled: z.boolean().optional(),
  deliveryEnabled: z.boolean().optional(),
  flatShippingCents: z.number().int().min(0).max(1_000_000).optional(),
  deliveryInstructions: z.string().trim().max(500).nullable().optional(),
});
export type UpdateStoreSettingsInput = z.infer<typeof updateStoreSettingsSchema>;
