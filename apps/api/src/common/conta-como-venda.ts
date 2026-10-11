import { Prisma } from "@borafest/database";

/**
 * O QUE É VENDA — fonte única da regra para os relatórios (2026-10-11).
 *
 * Decisão do Arthur em 2026-09-15: "lista não é venda". Pedido de R$ 0 (lista
 * de convidados, lote grátis, cupom de 100%) nasce PAID, mas não é venda: não
 * soma em ingresso vendido, pedido, faturamento, comissão nem ranking.
 *
 * O relatório de promoter já seguia isso; "Por vendedor" e a "Competição
 * atléticas/parceiros" não. O mesmo promoter aparecia com 0 vendidos numa tela
 * e 30 na outra, uma atlética subia na competição enchendo a lista, e cancelar
 * um convidado (correção de digitação) virava venda que "falhou".
 *
 *  - deu certo: pago/entregue E com valor
 *  - falhou:    estornado/expirado/cancelado E com valor
 *
 * As telas da Casa/do promoter (organizations.service), o caixa da porta
 * (orders.service) e a notificação de venda (worker/sale-notify) escrevem a
 * mesma regra à mão — ao mexer aqui, confira lá.
 */
export const STATUS_VENDA_OK = ["PAID", "FULFILLED"] as const;
export const STATUS_VENDA_FALHOU = ["REFUNDED", "PARTIALLY_REFUNDED", "CHARGEBACK", "EXPIRED", "CANCELED"] as const;

type PedidoParaVenda = { status: string; totalCents: number };

/** Só pedido com valor entra em relatório de venda, tanto no "deu certo" quanto no "falhou". */
export function temValorDeVenda(pedido: { totalCents: number }): boolean {
  return pedido.totalCents > 0;
}

export function vendaDeuCerto(pedido: PedidoParaVenda): boolean {
  return temValorDeVenda(pedido) && (STATUS_VENDA_OK as readonly string[]).includes(pedido.status);
}

export function vendaFalhou(pedido: PedidoParaVenda): boolean {
  return temValorDeVenda(pedido) && (STATUS_VENDA_FALHOU as readonly string[]).includes(pedido.status);
}

/** A mesma regra do valor como filtro do Prisma (busca só o que pode ser venda). */
export const ONDE_PEDIDO_COM_VALOR: Prisma.OrderWhereInput = { totalCents: { gt: 0 } };

/**
 * A mesma regra do valor em SQL, para relatório em query crua (promoter).
 * Espera a tabela `orders` com o apelido `o` na query.
 */
export const SQL_PEDIDO_COM_VALOR = Prisma.sql`o.total_cents > 0`;
