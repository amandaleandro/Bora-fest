import { origemGratis, type PedidoParaOrigem } from "../common/origem-gratis";

/**
 * ETIQUETAS DA PORTA (2026-10-12) — MEIA-ENTRADA e GRATUITO.
 *
 * Moram aqui, num lugar só, porque a porta lê o ingresso por DOIS caminhos: o
 * check-in online (checkins.service) e o manifesto que o aparelho baixa para
 * validar sem internet (validator.service). Se cada um derivasse a etiqueta do
 * seu jeito, a mesma pessoa sairia com etiquetas diferentes conforme o aparelho
 * tivesse rede — o mesmo descompasso que já aconteceu com CONVIDADO/CORTESIA
 * (ver common/origem-gratis.ts).
 */

/**
 * MEIA-ENTRADA: o item do pedido foi comprado com meia (`OrderItem.halfPrice`).
 * O painel promete ao produtor que o documento é conferido na portaria — sem
 * esta etiqueta a porta não sabia a quem pedir a carteirinha.
 */
export function ehMeia(item: { halfPrice: boolean } | null | undefined): boolean {
  return item?.halfPrice === true;
}

/**
 * GRATUITO: pedido de R$ 0 que NÃO é lista nem cortesia — lote grátis, cupom de
 * 100%, cortesia emitida pelo painel (decisão de 2026-10-10). Quem decide o que é
 * lista/cortesia é `origemGratis`: se ele dá CONVIDADO ou CORTESIA, a etiqueta
 * desse ingresso continua sendo aquela, e GRATUITO não aparece junto.
 */
export function ehGratuito(order: PedidoParaOrigem | null | undefined): boolean {
  if (!order) return false;
  return order.totalCents === 0 && origemGratis(order) === null;
}
