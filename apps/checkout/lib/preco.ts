import { formatCents } from "./format";

/**
 * "Grátis quando zero" (2026-10-11): o ÚNICO jeito de mostrar ao comprador um
 * valor que pode dar R$ 0 — preço do lote, total do seletor, total do checkout,
 * do pedido, de Minhas compras e do Perfil. Ingresso grátis não fala de
 * "R$ 0,00" nem de pagamento: a pessoa lê "Grátis".
 */
export function precoOuGratis(cents: number): string {
  return cents === 0 ? "Grátis" : formatCents(cents);
}

/** Pedido de R$ 0 (lote grátis, cupom de 100%, cortesia, lista): ninguém pagou — não há o que reembolsar. */
export function pedidoGratis(order: { totalCents: number }): boolean {
  return order.totalCents === 0;
}

interface LotePreco {
  priceCents: number;
  feeCents: number;
  /** PRODUCER: o produtor absorve a taxa — o comprador paga só o preço */
  feeMode: string;
}

interface LoteEstoque {
  status: string;
  capacity: number;
  soldCount: number;
  reservedCount: number;
}

/** O que o comprador paga por 1 ingresso do lote (com a taxa quando ela é dele). */
export function precoDoLote(lot: LotePreco): number {
  return lot.priceCents + (lot.feeMode !== "PRODUCER" ? lot.feeCents : 0);
}

/** Lote que dá pra pegar agora: ativo e com vaga (a mesma conta do "Esgotado" do seletor). */
export function loteComEstoque(lot: LoteEstoque): boolean {
  return lot.status === "ACTIVE" && lot.capacity - lot.soldCount - lot.reservedCount > 0;
}

/**
 * Preço do "a partir de" da página do evento (2026-10-11): o mais barato entre
 * os lotes COM ESTOQUE. Lote esgotado não conta — antes o botão seguia dizendo
 * "a partir de R$ 0,00" (ou R$ 20) depois que o lote grátis (ou o de R$ 20)
 * acabava. null = nada à venda agora.
 */
export function menorPrecoDisponivel(event: {
  ticketTypes: Array<{ lots: Array<LotePreco & LoteEstoque> }>;
}): number | null {
  const precos = event.ticketTypes.flatMap((t) => t.lots.filter(loteComEstoque).map(precoDoLote));
  return precos.length ? Math.min(...precos) : null;
}

/**
 * Botão de baixo da página do evento (2026-10-11). Quando o mais barato com
 * estoque é grátis, mostra "Grátis" mesmo havendo lote pago — a mesma regra do
 * card da vitrine ("Grátis" porque é o mais barato); no seletor cada lote
 * aparece com o seu preço.
 */
export function textoBotaoEvento(menorPreco: number | null): string {
  if (menorPreco === null) return "Comprar ingressos";
  if (menorPreco === 0) return `Garantir ingresso · ${precoOuGratis(0)}`;
  return `Comprar ingressos · a partir de ${formatCents(menorPreco)}`;
}
