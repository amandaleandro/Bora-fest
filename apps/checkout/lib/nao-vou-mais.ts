import { ApiError } from "./api";

/**
 * Textos do "Não vou mais" (protótipo aprovado em 2026-10-12) — um lugar só
 * para Minhas compras e a página do pedido não dizerem coisas diferentes.
 * Plural quando o pedido tem mais de um ingresso.
 */
export function textosConfirmacaoNaoVou(vagas: number): { titulo: string; explicacao: string; botao: string } {
  const varias = vagas > 1;
  return {
    titulo: varias ? "Liberar suas vagas?" : "Liberar sua vaga?",
    explicacao: `${
      varias
        ? "Os ingressos deixam de valer e as vagas voltam para outras pessoas."
        : "O ingresso deixa de valer e a vaga volta para outra pessoa."
    } Dá para fazer até o evento começar.`,
    botao: varias ? "Liberar minhas vagas" : "Liberar minha vaga",
  };
}

/** Depois do "Não vou mais": o que aconteceu, a partir do que o SERVIDOR fez. */
export function textoLiberou(liberou: { vagas: number; usados: number }): string {
  if (liberou.usados > 0) {
    // alguém do pedido já entrou: só os outros ingressos caíram
    return `${liberou.vagas === 1 ? "Você liberou 1 vaga." : `Você liberou ${liberou.vagas} vagas.`} ${
      liberou.usados === 1
        ? "O ingresso já usado na entrada continua registrado."
        : "Os ingressos já usados na entrada continuam registrados."
    }`;
  }
  return liberou.vagas > 1
    ? "Você liberou suas vagas. Estes QR codes não valem mais."
    : "Você liberou sua vaga. Este QR não vale mais.";
}

/** Sessão vencida (401) no meio do "Não vou mais". */
export const SESSAO_EXPIRADA_NAO_VOU = "Sua sessão expirou. Entre de novo na sua conta para liberar a vaga.";

/**
 * Erro do "Não vou mais", separado pelo que a pessoa pode fazer:
 *  - sessao: entrar de novo na conta (401, o mesmo tratamento do resto do site);
 *  - tentar: rede, servidor fora ou muitas tentativas — "Tentar novamente" resolve;
 *  - definitivo: o servidor recusou (evento começou, já cancelado, não é o dono)
 *    — tentar de novo daria o mesmo, então o botão de confirmar some.
 */
export interface ErroNaoVou {
  mensagem: string;
  tipo: "sessao" | "tentar" | "definitivo";
}

export function erroDoNaoVou(e: unknown, sessaoExpirada: ErroNaoVou): ErroNaoVou {
  if (e instanceof ApiError) {
    if (e.status === 401) return sessaoExpirada;
    if (e.status === 429) return { mensagem: e.message, tipo: "tentar" };
    if (e.status >= 500) {
      return { mensagem: "Não foi possível liberar a vaga agora. Tente de novo em instantes.", tipo: "tentar" };
    }
    return { mensagem: e.message, tipo: "definitivo" };
  }
  return { mensagem: "Não foi possível liberar a vaga agora. Confira sua internet e tente de novo.", tipo: "tentar" };
}
