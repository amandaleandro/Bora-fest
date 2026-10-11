const STORAGE_KEY = "bf.partner";
const PROMOTER_STORAGE = "bf.promoter";
const SELLER_STORAGE = "bf.seller";

/**
 * Last-click DE VERDADE: capturar um canal apaga os outros. Sem isso, um slug
 * de vendedor guardado há dias vencia o clique novo no link de outro promoter
 * (o servidor prioriza vendedor > promoter > atlética) e a comissão ia para
 * quem não trouxe a venda — revisão adversarial 2026-08-11.
 */
function limparOutrosCanais(manter: string) {
  for (const chave of [STORAGE_KEY, PROMOTER_STORAGE, SELLER_STORAGE]) {
    if (chave !== manter) localStorage.removeItem(chave);
  }
}
const ATTRIBUTION_WINDOW_MS = 7 * 24 * 60 * 60 * 1000; // 7 dias, last-click

/** Captura `?p=slug` da URL do hotsite e guarda com janela de atribuição de 7 dias. */
export function capturePartnerFromUrl() {
  const slug = new URLSearchParams(window.location.search).get("p");
  if (!slug) return;
  limparOutrosCanais(STORAGE_KEY);
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ slug, expiresAt: Date.now() + ATTRIBUTION_WINDOW_MS }));
}

/** Slug do parceiro de vendas atribuído a este comprador, se ainda dentro da janela. */
export function getAttributedPartnerSlug(): string | undefined {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return undefined;
  try {
    const { slug, expiresAt } = JSON.parse(raw) as { slug: string; expiresAt: number };
    if (Date.now() > expiresAt) {
      localStorage.removeItem(STORAGE_KEY);
      return undefined;
    }
    return slug;
  } catch {
    return undefined;
  }
}

const PROMOTER_KEY = "bf.promoter";

/** Captura `?pr=slug` (link de promoter) — mesma janela de 7 dias, last-click. */
export function capturePromoterFromUrl() {
  const slug = new URLSearchParams(window.location.search).get("pr");
  if (!slug) return;
  limparOutrosCanais(PROMOTER_KEY);
  localStorage.setItem(PROMOTER_KEY, JSON.stringify({ slug, expiresAt: Date.now() + ATTRIBUTION_WINDOW_MS }));
}

export function getAttributedPromoterSlug(): string | undefined {
  const raw = localStorage.getItem(PROMOTER_KEY);
  if (!raw) return undefined;
  try {
    const { slug, expiresAt } = JSON.parse(raw) as { slug: string; expiresAt: number };
    if (Date.now() > expiresAt) {
      localStorage.removeItem(PROMOTER_KEY);
      return undefined;
    }
    return slug;
  } catch {
    return undefined;
  }
}

const SELLER_KEY = "bf.seller";

/** Captura `?vd=slug` (link de vendedor do promoter) — janela de 7 dias, last-click. */
export function captureSellerFromUrl() {
  const slug = new URLSearchParams(window.location.search).get("vd");
  if (!slug) return;
  limparOutrosCanais(SELLER_KEY);
  localStorage.setItem(SELLER_KEY, JSON.stringify({ slug, expiresAt: Date.now() + ATTRIBUTION_WINDOW_MS }));
}

export function getAttributedSellerSlug(): string | undefined {
  const raw = localStorage.getItem(SELLER_KEY);
  if (!raw) return undefined;
  try {
    const { slug, expiresAt } = JSON.parse(raw) as { slug: string; expiresAt: number };
    if (Date.now() > expiresAt) {
      localStorage.removeItem(SELLER_KEY);
      return undefined;
    }
    return slug;
  } catch {
    return undefined;
  }
}

/**
 * Captura de atribuição "na porta": lê ?p= (atlética) · ?pr= (promoter) · ?vd=
 * (vendedor) da URL de ENTRADA e persiste com last-click (capturar um zera os
 * outros). Precisa rodar em TODA página onde um link rastreável pode aterrissar
 * — inclusive a HOME, para onde o painel aponta os links de promoter/vendedor
 * (`/?pr=slug`, `/?vd=slug`). Antes, só a página de evento chamava a captura, e
 * como a home não capturava nada e a navegação para o evento descarta a query,
 * ?pr= e ?vd= se perdiam e a comissão do promoter ficava sempre zero.
 *
 * Chamar as três é seguro em qualquer página: cada função sai cedo se o seu
 * parâmetro não está na URL, sem apagar o que já foi atribuído.
 */
export function captureAttributionFromUrl() {
  capturePartnerFromUrl();
  capturePromoterFromUrl();
  captureSellerFromUrl();
}

const CONVITE_PREFIX = "bf.convite.";

/**
 * Link de convidado (`?convite=`) de UM evento (2026-10-10). Guardado por evento
 * porque a navegação para /ingressos descarta a query, e o código só vale
 * para o evento em que foi aberto.
 */
export function captureInviteFromUrl(slug: string) {
  try {
    const token = new URLSearchParams(window.location.search).get("convite")?.trim();
    // só guarda o que tem cara de código (base64url); link cortado/editado não
    // fica 7 dias grudado nas reservas deste evento
    if (!token || !/^[A-Za-z0-9_-]{8,80}$/.test(token)) return;
    localStorage.setItem(
      CONVITE_PREFIX + slug,
      JSON.stringify({ token, expiresAt: Date.now() + ATTRIBUTION_WINDOW_MS }),
    );
  } catch {
    /* armazenamento bloqueado: o lote restrito só aparece nesta página */
  }
}

export function getInviteToken(slug: string): string | undefined {
  try {
    const raw = localStorage.getItem(CONVITE_PREFIX + slug);
    if (!raw) return undefined;
    const { token, expiresAt } = JSON.parse(raw) as { token: string; expiresAt: number };
    if (Date.now() > expiresAt) {
      localStorage.removeItem(CONVITE_PREFIX + slug);
      return undefined;
    }
    return token;
  } catch {
    return undefined;
  }
}

/** O que libera lote restrito deste evento: link do promoter (?pr=) e link de convidado (?convite=). */
export function eventAccess(slug: string): { pr?: string; convite?: string } {
  let pr: string | undefined;
  try {
    pr = getAttributedPromoterSlug();
  } catch {
    pr = undefined;
  }
  return { pr, convite: getInviteToken(slug) };
}
