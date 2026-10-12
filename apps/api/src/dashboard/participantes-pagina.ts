import type { Prisma } from "@borafest/database";

/**
 * LISTA DE PARTICIPANTES EM PÁGINAS (2026-10-12). A rota devolvia TODOS os
 * ingressos do evento de uma vez (findMany sem take/skip): num evento grande
 * eram milhares de linhas numa resposta só, e a busca da tela rodava em cima
 * disso no navegador. Agora vem por página, com o total, e a busca vai para o
 * servidor (senão ela só acharia quem está na página aberta). O CSV continua
 * com a lista inteira — exportar é justamente para ter tudo.
 */
export const PARTICIPANTES_POR_PAGINA = 50;
export const PARTICIPANTES_POR_PAGINA_MAX = 100;
/** teto da página: mantém o skip dentro do inteiro do Postgres mesmo com lixo na URL */
const PAGINA_MAX = 100_000;
const BUSCA_MAX = 100;

/** page/pageSize vindos da query string: lixo, zero ou negativo viram o padrão — nunca 500. */
export function paginaDeParticipantes(page: unknown, pageSize: unknown): { page: number; pageSize: number } {
  const p = Math.floor(Number(page));
  const s = Math.floor(Number(pageSize));
  return {
    page: Number.isFinite(p) && p >= 1 ? Math.min(p, PAGINA_MAX) : 1,
    pageSize: Number.isFinite(s) && s >= 1 ? Math.min(s, PARTICIPANTES_POR_PAGINA_MAX) : PARTICIPANTES_POR_PAGINA,
  };
}

/**
 * termo de busca limpo (ou null): espaços nas pontas fora, tamanho com teto.
 * `?q=a&q=b` chega como array — não é texto, vira "sem busca" em vez de 500.
 */
export function buscaDeParticipantes(q: unknown): string | null {
  if (typeof q !== "string") return null;
  const termo = q.trim().slice(0, BUSCA_MAX);
  return termo.length > 0 ? termo : null;
}

/**
 * Filtro da lista. A busca cobre o que a tela mostra: código do ingresso e
 * nome/e-mail do participante — e, como o nome exibido cai para o do
 * comprador quando o ingresso não tem nome próprio, também o contato do pedido.
 */
export function filtroDeParticipantes(eventId: string, busca: string | null): Prisma.TicketWhereInput {
  if (!busca) return { eventId };
  const contem = { contains: busca, mode: "insensitive" as const };
  return {
    eventId,
    OR: [
      { code: contem },
      { attendeeName: contem },
      { attendeeEmail: contem },
      { order: { contactName: contem } },
      { order: { contactEmail: contem } },
    ],
  };
}
