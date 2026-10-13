/**
 * Por que o servidor recusou a ENTRADA de quem acabou de comprar na porta
 * (PDV, components/PdvPorta.tsx). O servidor responde com um enum; na porta o
 * operador precisa da AÇÃO, não do código — "OTHER_EVENT" não diz a ele que o
 * portão preso no aparelho é de outro evento, que é a causa mais comum e a
 * mais silenciosa.
 *
 * Função pura, fora do componente (2026-10-12), para o teste conferir os
 * textos sem navegador — como lib/nao-vou-mais.ts.
 */
export function motivoLegivel(result: string, reason?: string): string {
  if (reason === "OTHER_EVENT") return "O portão selecionado é de outro evento — troque o portão";
  if (reason === "NOT_FOUND") return "O servidor não achou este ingresso";
  if (reason === "BAD_SIGNATURE" || reason === "MALFORMED") return "QR não reconhecido pelo servidor";
  if (reason === "EVENT_WITHOUT_KEY") return "Evento sem chave de validação — chame o produtor";
  // QR ANTIGO (2026-10-12): o ingresso foi transferido e o QR foi trocado; o
  // servidor recusa o código velho com este motivo. Sem esta linha a tela
  // dizia só "o servidor recusou", e o operador não sabia o que pedir.
  if (reason === "OLD_QR") return "Este ingresso foi transferido — o QR mudou";
  if (result === "CANCELED") return "Ingresso cancelado";
  if (result === "UNVERIFIED") return "Não deu para verificar a entrada";
  return "O servidor recusou a entrada";
}
