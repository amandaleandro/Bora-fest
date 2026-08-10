import { z } from "zod";
import { orderAddOnSelectionSchema } from "./add-ons";

export const createOrderSchema = z.object({
  reservationId: z.string().uuid(),
  contactEmail: z.string().email(),
  contactName: z.string().min(2).optional(),
  /** celular com DDD — habilita entrega do ingresso por WhatsApp */
  contactPhone: z.string().min(10).max(20).optional(),
  couponCode: z.string().min(3).max(24).optional(),
  /// slug do parceiro de vendas capturado do link público (?p=slug) — atribui a comissão
  partnerSlug: z.string().min(1).max(80).optional(),
  /** link rastreável de PROMOTER (?pr=slug) — se válido, vence o de atlética (sem comissão dupla) */
  promoterSlug: z.string().min(1).max(80).optional(),
  /** CPF do comprador — vira o CPF da conta criada no checkout (vínculo do ingresso) */
  contactCpf: z.string().min(11).max(14).optional(),
  /// itens adicionais escolhidos no checkout (upsell) — ex.: camiseta do evento
  addOns: z.array(orderAddOnSelectionSchema).optional(),
  /// participantes de ingressos nominais (1 por unidade do lote nominal)
  attendees: z
    .array(
      z.object({
        ticketLotId: z.string().uuid(),
        name: z.string().min(2),
        cpf: z.string().min(11).max(14).optional(),
      }),
    )
    .optional(),
  /// aceite versionado de Termos e Privacidade (LGPD) — bloqueante no checkout
  consent: z
    .object({
      version: z.string().min(3),
      terms: z.literal(true),
      privacy: z.literal(true),
    })
    .optional(),
});
export type CreateOrderInput = z.infer<typeof createOrderSchema>;

/** "Receber meus ingressos no WhatsApp" — corpo opcional; sem phone usa o contato do pedido. */
export const orderWhatsAppSchema = z
  .object({
    phone: z.string().min(10).max(20).optional(),
  })
  .optional();
export type OrderWhatsAppInput = z.infer<typeof orderWhatsAppSchema>;

/** PDV (venda presencial/manual pelo produtor) — painel > Vendas > PDV, sem checkout. */
export const pdvOrderSchema = z.object({
  ticketLotId: z.string().uuid(),
  quantity: z.number().int().min(1).max(20),
  buyerName: z.string().min(2),
  buyerDocument: z.string().min(5).max(20).optional(),
  buyerEmail: z.string().email().optional(),
  salesPartnerId: z.string().uuid().optional(),
});
export type PdvOrderInput = z.infer<typeof pdvOrderSchema>;
