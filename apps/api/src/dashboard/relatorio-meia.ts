/**
 * MEIA-ENTRADA NOS RELATÓRIOS (2026-10-12) — Decreto 8.537/2015.
 *
 * O dado já era gravado desde a primeira venda (`OrderItem.halfPrice`, no site
 * e na porta), mas só aparecia no fechamento do PDV. A lei pede que a produção
 * guarde e apresente o relatório de venda com a meia separada, e o produtor
 * não tinha de onde tirar esse número. Agora:
 *  - CSV de pedidos: coluna "meia" com quantos ingressos do pedido são meia;
 *  - CSV de participantes: coluna "meia" (sim/não) em cada ingresso;
 *  - CSV de meia-entrada: um ingresso de meia por linha.
 *
 * Aqui mora só a montagem das linhas (sem banco), para o teste provar a regra
 * sem depender de fixture.
 */

/** Colunas do CSV de meia-entrada, na ordem em que saem. */
export const CABECALHO_MEIA = "data_compra,tipo,lote,participante,codigo,canal,situacao,pedido";

export type CanalDaVenda = "site" | "porta";

/**
 * Venda de porta é a que tem vendedor: o PDV (dinheiro ou Pix na porta) grava
 * `soldByUserId`, a compra no site não. A lista de convidados também grava,
 * mas pedido de lista é R$ 0 e nunca tem meia — então, no relatório de meia,
 * vendedor no pedido = porta.
 */
export function canalDoPedido(pedido: { soldByUserId: string | null }): CanalDaVenda {
  return pedido.soldByUserId ? "porta" : "site";
}

/** Situação do ingresso em português, como o painel mostra (Vendas → pedido). */
const SITUACAO: Record<string, string> = {
  ISSUED: "válido",
  ACTIVE: "válido",
  CHECKED_IN: "usado na entrada",
  TRANSFERRED: "transferido",
  CANCELED: "cancelado",
  REFUNDED: "reembolsado",
};

/**
 * Pedido pago cujo ingresso o worker ainda não emitiu (ele emite segundos
 * depois; se estiver parado, demora). A meia foi vendida e precisa estar no
 * relatório — sumir com ela seria contar menos do que vendeu.
 */
export const SITUACAO_SEM_INGRESSO = "aguardando emissão";

export function situacaoDoIngresso(status: string): string {
  return SITUACAO[status] ?? status;
}

/**
 * Texto livre (nome que o comprador digitou) que começa com = + - @ vira
 * fórmula ao abrir a planilha no Excel/Google Planilhas. Um apóstrofo na
 * frente faz a planilha mostrar o texto como texto.
 */
export function textoSeguroParaPlanilha(valor: string): string {
  return /^[=+\-@\t\r]/.test(valor) ? `'${valor}` : valor;
}

/** Uma linha de CSV: cada célula entre aspas, aspas internas dobradas (mesmo formato dos outros CSVs). */
export function linhaCsv(valores: Array<string | number>): string {
  return valores.map((valor) => `"${String(valor).replace(/"/g, '""')}"`).join(",");
}

/** Quantos ingressos de meia há num pedido (soma das quantidades dos itens de meia). */
export function quantidadeDeMeia(itens: Array<{ quantity: number; halfPrice: boolean }>): number {
  return itens.reduce((soma, item) => soma + (item.halfPrice ? item.quantity : 0), 0);
}

export function simOuNao(valor: boolean): "sim" | "não" {
  return valor ? "sim" : "não";
}

/** Item de meia como vem do banco (o select do exportMeiaEntradaCsv). */
export interface ItemDeMeia {
  quantity: number;
  ticketLot: { name: string; ticketType: { name: string } };
  order: {
    publicToken: string;
    status: string;
    createdAt: Date;
    paidAt: Date | null;
    contactName: string | null;
    soldByUserId: string | null;
  };
  tickets: Array<{ code: string; status: string; attendeeName: string | null }>;
}

/**
 * Uma linha por ingresso de meia. Ingresso emitido sai com código e situação;
 * pedido PAGO ainda sem ingresso sai com o código em branco e "aguardando
 * emissão". Pedido que não chegou a ser pago (Pix pendente, expirado) não tem
 * ingresso e não é venda — não entra.
 *
 * Cancelado e reembolsado ENTRAM, com a situação escrita: o relatório é de
 * venda, e quem confere precisa ver o que foi vendido e depois desfeito. Para
 * contar só o que vale, filtre a coluna "situacao".
 */
export function linhasDaMeia(itens: ItemDeMeia[]): Array<Array<string | number>> {
  const linhas: Array<Array<string | number>> = [];
  for (const item of itens) {
    const pedido = item.order;
    const data = (pedido.paidAt ?? pedido.createdAt).toISOString();
    const tipo = textoSeguroParaPlanilha(item.ticketLot.ticketType.name);
    const lote = textoSeguroParaPlanilha(item.ticketLot.name);
    const canal = canalDoPedido(pedido);
    const nomeDoPedido = pedido.contactName ?? "";

    for (const ingresso of item.tickets) {
      linhas.push([
        data,
        tipo,
        lote,
        textoSeguroParaPlanilha(ingresso.attendeeName ?? nomeDoPedido),
        ingresso.code,
        canal,
        situacaoDoIngresso(ingresso.status),
        pedido.publicToken,
      ]);
    }

    if (pedido.status === "PAID") {
      const faltam = Math.max(item.quantity - item.tickets.length, 0);
      for (let i = 0; i < faltam; i += 1) {
        linhas.push([
          data,
          tipo,
          lote,
          textoSeguroParaPlanilha(nomeDoPedido),
          "",
          canal,
          SITUACAO_SEM_INGRESSO,
          pedido.publicToken,
        ]);
      }
    }
  }
  return linhas;
}
