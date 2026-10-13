/**
 * QUAL ITEM DA LATERAL FICA MARCADO (2026-10-12).
 *
 * A lateral do desktop comparava a rota EXATA com o link do item. Toda tela que
 * mora "dentro" de uma seção ficava sem nada marcado: o convite por e-mail de
 * um lote (/eventos/[id]/convites), a próxima edição (/recorrencia), o check-in
 * ao vivo e a lista de convidados, as sub-telas de Clientes. Agora compara por
 * PREFIXO e agrupa como as pílulas do evento (components/EventTabs.tsx) e as
 * de Clientes (components/ClientesTabs.tsx) já fazem.
 *
 * Funções puras (sem React) para o teste rodar sem navegador.
 */

/** A rota é `base` ou algo abaixo dela — `/eventos/ab` não casa com `/eventos/abc`. */
function dentroDe(pathname: string, base: string): boolean {
  return pathname === base || pathname.startsWith(`${base}/`);
}

/** Seções do evento que a lateral conhece; o resto cai no item da seção-mãe. */
const SECOES_DO_EVENTO = new Set(["dashboard", "editar", "vip", "divulgue", "vendas", "promoters", "participantes", "portaria"]);

/**
 * Link da lateral do EVENTO que corresponde à rota, ou `null` se a rota não é
 * deste evento (ex.: o financeiro da produtora com o evento em foco guardado).
 */
export function itemDoEventoAtivo(pathname: string, eventId: string): string | null {
  const base = `/eventos/${eventId}`;
  if (!dentroDe(pathname, base)) return null;
  const segmento = pathname.slice(base.length).replace(/^\//, "").split("/")[0] ?? "";
  // o convite por e-mail é de um lote: fica em Ingressos, como na pílula
  if (segmento === "" || segmento === "convites") return base;
  // a próxima edição nasce do evento: fica em Geral, como na pílula
  if (segmento === "recorrencia") return `${base}/dashboard`;
  // check-in ao vivo e lista de convidados são do Check-in
  if (segmento === "checkin-ao-vivo" || segmento === "lista-convidados") return `${base}/portaria`;
  if (SECOES_DO_EVENTO.has(segmento)) return `${base}/${segmento}`;
  return null;
}

/**
 * Link da lateral da PRODUTORA que corresponde à rota, ou `null`.
 * `eventsHref` é o link de "Meus eventos" (a página da produtora, ou a lista
 * de produtoras quando nenhuma está em foco).
 */
export function itemDaProdutoraAtivo(pathname: string, organizationId?: string): string | null {
  if (dentroDe(pathname, "/resumo")) return "/resumo";
  // criar evento sai de "Meus eventos"
  const eventsHref = organizationId ? `/organizacoes/${organizationId}` : "/organizacoes";
  if (dentroDe(pathname, "/eventos/novo")) return eventsHref;
  if (!organizationId) return pathname === "/organizacoes" ? "/organizacoes" : null;

  const base = `/organizacoes/${organizationId}`;
  if (!dentroDe(pathname, base)) return null;
  const resto = pathname.slice(base.length).replace(/^\//, "");
  if (resto === "") return base;
  const segmento = resto.split("/")[0];
  // a lateral só tem "Clientes": as sete telas da barra de Clientes ficam nele
  if (segmento === "clientes" || segmento === "fidelidade" || segmento === "inteligencia") return `${base}/clientes`;
  if (segmento === "perfil-publico" || segmento === "financeiro" || segmento === "reembolsos") return `${base}/${segmento}`;
  return null;
}

/**
 * Índice do item marcado numa lista da lateral: o PRIMEIRO com o link ativo.
 * "Meus eventos" e "Equipe e promoters" levam à mesma página da produtora —
 * antes os dois acendiam juntos; fica marcado só o primeiro.
 */
export function indiceAtivo(links: ReadonlyArray<{ href: string }>, hrefAtivo: string | null): number {
  if (!hrefAtivo) return -1;
  return links.findIndex((l) => l.href === hrefAtivo);
}
