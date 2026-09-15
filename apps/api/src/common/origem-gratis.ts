/**
 * ORIGEM DE INGRESSO GRÁTIS — fonte única da regra.
 *
 * Extraído em 2026-09-07: esta derivação estava COPIADA em dois lugares
 * (carteira do comprador e etiqueta do portão) e já tinha começado a divergir
 * quando a cortesia saiu do balcão. Regra de dinheiro/identidade duplicada é
 * questão de tempo até uma metade mudar sozinha — agora tem um dono só.
 *
 * A regra (decisões do Arthur, 2026-08-31 e 2026-09-07): pedido de R$ 0
 * nascido da LISTA DE CONVIDADOS, cadastrado antes do evento. Quem cadastrou
 * separa os dois rótulos:
 *   - parceiro/atlética  -> CORTESIA  (sóbrio, leva o nome da atlética)
 *   - produção           -> CONVIDADO (charme dourado)
 * O ramo `soldByUserId` cobre os pedidos históricos, de quando o promoter
 * ainda emitia cortesia no balcão (hoje bloqueado em createManualSale).
 */
export type OrigemGratis = { kind: "CONVIDADO" | "CORTESIA"; por: string } | null;

/** Aceita tanto a forma com o parceiro carregado (carteira) quanto só o id (portaria). */
export interface PedidoParaOrigem {
  totalCents: number;
  soldByUserId?: string | null;
  salesPartnerId?: string | null;
  salesPartner?: { name: string } | null;
  /** promoter pessoa que cadastrou o convidado (cota própria, desde 2026-09-08) */
  promoterLinkId?: string | null;
  promoterLink?: { promoterUser?: { name: string | null } | null } | null;
  guestListEntries?: Array<{ id: string }>;
}

/**
 * DE QUEM É A LISTA (2026-09-15) — mesma fonte da etiqueta, de propósito.
 *
 * A portaria separa "Ingressos" (tem ingresso em mãos; a posse já prova quem é)
 * de cada lista (só o nome cadastrado; exige CPF). `null` significa a primeira
 * aba. Mora aqui junto de `origemGratis` porque lê exatamente os mesmos campos —
 * separar as duas em arquivos diferentes recriaria a divergência que este
 * arquivo existe para evitar.
 *
 * O id é o que o filtro da porta usa; o nome é o que a pessoa fala na fila
 * ("tô na lista do João").
 */
export type ListaDoPedido = { id: string; nome: string } | null;

export function listaDoPedido(order: PedidoParaOrigem): ListaDoPedido {
  if ((order.guestListEntries?.length ?? 0) === 0) return null;

  const promoterId = order.promoterLinkId ?? null;
  if (promoterId) {
    return { id: promoterId, nome: order.promoterLink?.promoterUser?.name ?? "Promoter" };
  }
  const parceiroId = order.salesPartnerId ?? null;
  if (parceiroId) {
    return { id: parceiroId, nome: order.salesPartner?.name ?? "Parceiro" };
  }
  // cadastrado pela própria casa: uma lista só, sempre com o mesmo id
  return { id: "producao", nome: "Produção" };
}

export function origemGratis(order: PedidoParaOrigem): OrigemGratis {
  if (order.totalCents !== 0) return null;

  const nomeParceiro = order.salesPartner?.name ?? null;
  const temParceiro = Boolean(order.salesPartnerId ?? order.salesPartner);
  const daLista = (order.guestListEntries?.length ?? 0) > 0;

  if (daLista) {
    // quem cadastrou define o rótulo. PROMOTER pessoa (cota própria) e
    // atlética/parceiro saem como CORTESIA, com o nome de quem convidou;
    // só a produção sai como CONVIDADO ("da produção", charme dourado).
    const nomePromoter = order.promoterLink?.promoterUser?.name ?? null;
    const temPromoter = Boolean(order.promoterLinkId ?? order.promoterLink);
    if (temPromoter) return { kind: "CORTESIA", por: nomePromoter ?? "equipe do evento" };
    return temParceiro
      ? { kind: "CORTESIA", por: nomeParceiro ?? "equipe do evento" }
      : { kind: "CONVIDADO", por: "produção" };
  }
  // histórico: cortesia emitida no balcão antes do bloqueio de 2026-09-07
  if (order.soldByUserId) {
    return { kind: "CORTESIA", por: nomeParceiro ?? "equipe do evento" };
  }
  return null;
}
