/**
 * CÓDIGO DO PROMOTER NO CHECKOUT (2026-10-12) — regras puras da tela.
 *
 * O servidor já aceitava `promoterCode` no pedido (orders.service), mas o site
 * não tinha campo: quem perdia o link do promoter (outro aparelho, navegador do
 * Instagram) comprava sem atribuição. A regra que vale é a do SERVIDOR:
 *  - o código tem 3 a 16 letras ou números (o mesmo do cadastro do promoter);
 *  - o link do promoter (?pr=, ?vd=) tem prioridade sobre o código;
 *  - código que não existe, é de outra Casa ou de outro evento é IGNORADO —
 *    o pedido sai normal, sem promoter. Não há rota para conferir antes, então
 *    a tela só sabe o resultado pelo pedido criado (`promoterLinkId`).
 */

/** Só letras e números, em maiúsculas, até 16 — o mesmo que o servidor aceita. */
export function limparCodigoPromoter(valor: string): string {
  return valor
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 16);
}

export const TEXTO_CODIGO_CURTO = "Código do promoter: use de 3 a 16 letras ou números, ou deixe em branco.";

/**
 * O que vai no pedido. Vazio = nada (o campo é opcional). Curto demais: o
 * servidor recusaria o pedido inteiro com uma mensagem técnica — a tela pega
 * antes e diz o que fazer.
 */
export function codigoPromoterParaEnviar(valor: string): { codigo?: string; erro?: string } {
  const codigo = limparCodigoPromoter(valor);
  if (!codigo) return {};
  if (codigo.length < 3) return { erro: TEXTO_CODIGO_CURTO };
  return { codigo };
}

export type AvisoCodigoPromoter = { tipo: "ok" | "nao-valeu"; texto: string };

/**
 * Depois de criar o pedido: o código valeu?
 *  - promoterLinkId null: nenhum promoter ficou com a venda — o código não vale
 *    para este evento (com ou sem link, porque o link também não pegou);
 *  - promoterLinkId preenchido sem link: foi o código que atribuiu;
 *  - preenchido com link: pode ter sido o link (ele vence) — a tela não chuta;
 *  - campo ausente (API que não manda): não dá para saber — nada é dito.
 */
export function avisoDoCodigoPromoter(args: {
  codigo: string | undefined;
  promoterLinkId: string | null | undefined;
  veioDeLink: boolean;
}): AvisoCodigoPromoter | null {
  const { codigo, promoterLinkId, veioDeLink } = args;
  if (!codigo || promoterLinkId === undefined) return null;
  if (promoterLinkId === null) {
    return {
      tipo: "nao-valeu",
      texto: `O código ${codigo} não vale para este evento — sua compra segue normalmente, só sem promoter.`,
    };
  }
  if (veioDeLink) return null;
  return { tipo: "ok", texto: `Código do promoter ${codigo} registrado nesta compra.` };
}
