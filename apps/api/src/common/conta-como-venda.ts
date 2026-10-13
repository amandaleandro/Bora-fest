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

/**
 * VENDA, LISTA OU GRÁTIS — os três baldes dos relatórios (2026-10-12).
 *
 * Todo pedido cai em exatamente um balde:
 *  - venda:  tem valor (a regra de cima, `temValorDeVenda`);
 *  - lista:  R$ 0 nascido da lista de convidados (tem entrada em
 *            guest_list_entries, o mesmo critério de `origem-gratis.ts`);
 *  - gratis: R$ 0 que NÃO é lista: lote grátis, cupom de 100%, cortesia.
 *
 * O relatório de promoter só tinha os dois primeiros: quem trouxe 200 pessoas
 * para um evento grátis pelo link dele aparecia com zero. "Grátis" não soma em
 * venda nem em lista; é um terceiro número, ao lado deles.
 */
export type BaldeDoPedido = "venda" | "lista" | "gratis";

export function baldeDoPedido(pedido: { totalCents: number; daLista: boolean }): BaldeDoPedido {
  if (temValorDeVenda(pedido)) return "venda";
  return pedido.daLista ? "lista" : "gratis";
}

/** O pedido nasceu da lista (a entrada pode ter sido cancelada depois; o pedido continua sendo de lista). */
const SQL_PEDIDO_TEM_LISTA = Prisma.sql`EXISTS (SELECT 1 FROM guest_list_entries g_balde WHERE g_balde.order_id = o.id)`;

/** Balde "lista" em SQL, com o mesmo apelido `o` de `SQL_PEDIDO_COM_VALOR`. */
export const SQL_PEDIDO_DA_LISTA = Prisma.sql`(NOT (${SQL_PEDIDO_COM_VALOR}) AND ${SQL_PEDIDO_TEM_LISTA})`;

/** Balde "grátis" em SQL: sem valor e fora da lista. */
export const SQL_PEDIDO_GRATIS = Prisma.sql`(NOT (${SQL_PEDIDO_COM_VALOR}) AND NOT ${SQL_PEDIDO_TEM_LISTA})`;
