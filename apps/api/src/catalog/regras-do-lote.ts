import { BadRequestException } from "@nestjs/common";
import type { Prisma } from "@borafest/database";
import { abaixoDoMinimoOnline, emReais, minimoDaCobrancaCents } from "../common/minimo-cobranca";

/**
 * REGRAS DO LOTE (2026-10-12): moravam só dentro do createLot. Com a edição de
 * lote, as mesmas regras valem nos dois caminhos — senão bastava criar um lote
 * certo e depois editá-lo para o estado que a criação recusa (R$ 0 só de
 * balcão, abaixo do mínimo do banco, fim antes do início, duas restrições).
 * Aqui se confere sempre o estado FINAL do lote, não só o que veio no pedido.
 */

export type ModoDeConvite = "NONE" | "LINK" | "EMAIL";

export type LoteParaConferir = {
  priceCents: number;
  /** taxa que o lote vai cobrar (calculada pelo servidor, nunca digitada) */
  feeCents: number;
  feeMode: "BUYER" | "PRODUCER";
  halfPriceEnabled: boolean;
  pdvOnly: boolean;
  promoterOnly: boolean;
  inviteMode: ModoDeConvite;
  startsAt: Date | null;
  endsAt: Date | null;
};

/** Lote grátis não tem meia (2026-10-11): metade de zero só faria a porta pedir documento à toa. */
export function meiaDoLote(priceCents: number, halfPriceEnabled: boolean): boolean {
  return priceCents > 0 ? halfPriceEnabled : false;
}

export function conferirRegrasDoLote(lote: LoteParaConferir): void {
  // DISPONIBILIDADE (2026-10-10): um lote tem UM jeito de ser restrito —
  // só balcão, exclusivo do promoter ou convidado (link ou e-mail). Dois ao
  // mesmo tempo não têm leitura possível pra quem compra.
  const restricoes = [lote.pdvOnly, lote.promoterOnly, lote.inviteMode !== "NONE"].filter(Boolean).length;
  if (restricoes > 1) {
    throw new BadRequestException("Escolha só uma forma de disponibilidade para o lote");
  }

  // SÓ BALCÃO PRECISA DE PREÇO (2026-10-12): desde 07/09 cortesia não sai na
  // porta — o balcão (listPdvLots) esconde lote grátis e a venda recusa R$ 0.
  // Um lote R$ 0 só de balcão nascia morto: some do site e não aparece na
  // porta. Entrada grátis se cadastra antes, na lista de convidados.
  if (lote.pdvOnly && lote.priceCents === 0) {
    throw new BadRequestException(
      "Lote só de balcão precisa ter preço — a porta não emite cortesia. Para entrada grátis, cadastre a pessoa na Lista de convidados do evento (ou emita uma Cortesia).",
    );
  }

  // MÍNIMO DO PAGAMENTO ONLINE (2026-10-11): o painel aceitava lote de R$ 3 e
  // ninguém conseguia comprar — o pedido travava no "Gerar Pix". Barra na
  // origem o que o comprador paga por 1 ingresso (preço + taxa se ele paga a
  // taxa; só o preço se o produtor absorve) e, com meia, a meia também. Lote
  // só de balcão fica de fora: na porta tem dinheiro, sem banco no meio.
  if (lote.priceCents > 0 && !lote.pdvOnly) {
    const minimo = minimoDaCobrancaCents();
    const taxaDoComprador = lote.feeMode === "PRODUCER" ? 0 : lote.feeCents;
    const inteira = lote.priceCents + taxaDoComprador;
    if (abaixoDoMinimoOnline(inteira)) {
      throw new BadRequestException(
        `Ingresso pago precisa sair por pelo menos ${emReais(minimo)} para o comprador (mínimo que o banco aceita) — este sairia por ${emReais(inteira)}. Para dar de graça, use R$ 0.`,
      );
    }
    // meia = metade do preço com a taxa cheia, a mesma conta da reserva
    const meia = Math.round(lote.priceCents / 2) + taxaDoComprador;
    if (lote.halfPriceEnabled && abaixoDoMinimoOnline(meia)) {
      throw new BadRequestException(
        `A meia-entrada sairia por ${emReais(meia)} para o comprador, abaixo do mínimo de ${emReais(minimo)} que o banco aceita. Aumente o preço do lote ou desmarque a meia-entrada.`,
      );
    }
  }

  // JANELA DO LOTE (2026-10-12): a reserva respeita início e fim do lote —
  // fim antes do início criaria um lote que nunca vende
  if (lote.startsAt && lote.endsAt && lote.endsAt.getTime() <= lote.startsAt.getTime()) {
    throw new BadRequestException("O fim das vendas do lote precisa ser depois do início");
  }
}

// ---------------------------------------------------------------------------
// O que mudou numa edição de lote (vai para a auditoria 'lot.update')
// ---------------------------------------------------------------------------

type ValorJson = Prisma.InputJsonValue | null;

/** Campos que o registro guarda com o valor de antes e o de depois. */
const CAMPOS_DO_LOTE = [
  "name",
  "priceCents",
  "feeCents",
  "capacity",
  "maxPerOrder",
  "limitPerCpf",
  "startsAt",
  "endsAt",
  "inviteMode",
  "promoterOnly",
  "pdvOnly",
  "halfPriceEnabled",
  "activateAfterLotId",
] as const;

export type CampoDoLote = (typeof CAMPOS_DO_LOTE)[number];

export type LoteParaComparar = { [K in CampoDoLote]: string | number | boolean | Date | null } & {
  inviteToken: string | null;
};

export type AlteracoesDoLote = {
  /** nomes dos campos que mudaram — o código do convite entra só aqui, sem valor */
  campos: string[];
  antes: Record<string, ValorJson>;
  depois: Record<string, ValorJson>;
};

function paraJson(valor: string | number | boolean | Date | null): ValorJson {
  if (valor === null) return null;
  if (valor instanceof Date) return valor.toISOString();
  return valor;
}

/**
 * O que mudou entre o lote de antes e o de depois de salvar. O código do link
 * de convite é a chave do lote: nunca vai para o histórico, só a marca de que
 * mudou (mesma regra do token do CAPI na edição de evento).
 */
export function alteracoesDoLote(antes: LoteParaComparar, depois: LoteParaComparar): AlteracoesDoLote {
  const campos: string[] = [];
  const de: Record<string, ValorJson> = {};
  const para: Record<string, ValorJson> = {};
  for (const campo of CAMPOS_DO_LOTE) {
    const a = paraJson(antes[campo]);
    const d = paraJson(depois[campo]);
    if (a === d) continue;
    campos.push(campo);
    de[campo] = a;
    para[campo] = d;
  }
  if ((antes.inviteToken ?? null) !== (depois.inviteToken ?? null)) campos.push("inviteToken");
  return { campos, antes: de, depois: para };
}
