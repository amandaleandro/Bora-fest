/**
 * Comissão da BoraFest sobre o produtor (marketplace fee), separada da taxa
 * de serviço cobrada do comprador no checkout (`TicketLot.feeCents`).
 * Taxa decidida em 2026-07-23 (REGISTRO.md): Pix 4,99% (piso R$2,49),
 * cartão 6,99%. Cada organização pode ter override próprio
 * (`Organization.pixFeeBps/pixFeeFloorCents/cardFeeBps`, null = usa o
 * padrão da plataforma abaixo, configurável por env para ambientes de teste).
 */

// Padrão (decisão do Arthur 2026-08-12): nossa taxa é 5% com PISO de R$ 1 — ou
// seja, R$ 1 até o ingresso passar de ~R$ 20 (onde 5% > R$ 1), aí vira 5%.
// Vale para Pix E cartão. Override por organização continua valendo.
const DEFAULT_PIX_FEE_BPS = Number(process.env.PLATFORM_PIX_FEE_BPS ?? 500);
const DEFAULT_PIX_FEE_FLOOR_CENTS = Number(process.env.PLATFORM_PIX_FEE_FLOOR_CENTS ?? 100);
const DEFAULT_CARD_FEE_BPS = Number(process.env.PLATFORM_CARD_FEE_BPS ?? 500);
const DEFAULT_CARD_FEE_FLOOR_CENTS = Number(process.env.PLATFORM_CARD_FEE_FLOOR_CENTS ?? 100);

export interface OrganizationFeeOverrides {
  pixFeeBps: number | null;
  pixFeeFloorCents: number | null;
  cardFeeBps: number | null;
}

export function computePlatformFeeCents(
  method: "PIX" | "CARD",
  amountCents: number,
  org: OrganizationFeeOverrides,
): number {
  if (method === "PIX") {
    const bps = org.pixFeeBps ?? DEFAULT_PIX_FEE_BPS;
    const floorCents = org.pixFeeFloorCents ?? DEFAULT_PIX_FEE_FLOOR_CENTS;
    return Math.max(Math.round((amountCents * bps) / 10_000), floorCents);
  }

  const bps = org.cardFeeBps ?? DEFAULT_CARD_FEE_BPS;
  return Math.max(Math.round((amountCents * bps) / 10_000), DEFAULT_CARD_FEE_FLOOR_CENTS);
}
