/**
 * JANELA DE VENDA DO LOTE (2026-10-12): startsAt/endsAt valem em todo canal —
 * site (reserva, vitrine), card da Casa e PORTA. Antes a porta vendia lote de
 * pré-venda depois do fim, pelo preço antigo. Fonte única para quem não é o
 * catalog.service (que tem a sua própria, com a mesma regra).
 */
export function loteNaJanela(lot: { startsAt: Date | null; endsAt: Date | null }, agora = Date.now()): boolean {
  return (
    (lot.startsAt === null || lot.startsAt.getTime() <= agora) &&
    (lot.endsAt === null || lot.endsAt.getTime() > agora)
  );
}

/** Mensagem para quem tenta vender/reservar fora da janela; null quando está dentro. */
export function motivoForaDaJanela(
  lot: { name: string; startsAt: Date | null; endsAt: Date | null },
  agora = Date.now(),
): string | null {
  if (lot.startsAt !== null && lot.startsAt.getTime() > agora) return `Este lote ainda não abriu (${lot.name}).`;
  if (lot.endsAt !== null && lot.endsAt.getTime() <= agora) return `Este lote já encerrou (${lot.name}).`;
  return null;
}
