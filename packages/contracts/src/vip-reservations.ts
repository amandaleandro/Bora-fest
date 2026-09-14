import { z } from "zod";

export const vipInventoryKindSchema = z.enum(["MESA", "CAMAROTE", "LOUNGE", "BISTRO", "OUTRO"]);
export type VipInventoryKindInput = z.infer<typeof vipInventoryKindSchema>;

const optionalText = (max: number) => z.string().trim().max(max).optional();

export const createVipInventorySchema = z
  .object({
    kind: vipInventoryKindSchema,
    name: z.string().trim().min(2).max(80),
    description: optionalText(600),
    benefits: optionalText(1200),
    unitPriceCents: z.number().int().min(0).max(100_000_000),
    quantity: z.number().int().min(1).max(500),
    capacityPerUnit: z.number().int().min(1).max(200),
    maxUnitsPerReservation: z.number().int().min(1).max(50).default(1),
  })
  .superRefine((value, ctx) => {
    if (value.maxUnitsPerReservation > value.quantity) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["maxUnitsPerReservation"],
        message: "O máximo por reserva não pode superar a quantidade disponível",
      });
    }
  });
export type CreateVipInventoryInput = z.infer<typeof createVipInventorySchema>;

export const updateVipInventorySchema = z.object({
  kind: vipInventoryKindSchema.optional(),
  name: z.string().trim().min(2).max(80).optional(),
  description: z.string().trim().max(600).nullable().optional(),
  benefits: z.string().trim().max(1200).nullable().optional(),
  unitPriceCents: z.number().int().min(0).max(100_000_000).optional(),
  quantity: z.number().int().min(1).max(500).optional(),
  capacityPerUnit: z.number().int().min(1).max(200).optional(),
  maxUnitsPerReservation: z.number().int().min(1).max(50).optional(),
  active: z.boolean().optional(),
});
export type UpdateVipInventoryInput = z.infer<typeof updateVipInventorySchema>;

export const createVipReservationSchema = z.object({
  inventoryId: z.string().uuid(),
  contactName: z.string().trim().min(2).max(120),
  contactEmail: z.string().trim().email().max(254),
  contactPhone: z.string().trim().min(8).max(30),
  partySize: z.number().int().min(1).max(500),
  units: z.number().int().min(1).max(50).default(1),
  customerNote: z.string().trim().max(1000).optional(),
});
export type CreateVipReservationInput = z.infer<typeof createVipReservationSchema>;

export const resolveVipReservationSchema = z.object({
  note: z.string().trim().max(1000).optional(),
});
export type ResolveVipReservationInput = z.infer<typeof resolveVipReservationSchema>;

export const manageVipReservationSchema = resolveVipReservationSchema.extend({
  action: z.enum(["CONFIRM", "REJECT", "CANCEL"]),
});
export type ManageVipReservationInput = z.infer<typeof manageVipReservationSchema>;
