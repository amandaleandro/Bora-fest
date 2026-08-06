const STORAGE_KEY = "bf.partner";
const ATTRIBUTION_WINDOW_MS = 7 * 24 * 60 * 60 * 1000; // 7 dias, last-click

/** Captura `?p=slug` da URL do hotsite e guarda com janela de atribuição de 7 dias. */
export function capturePartnerFromUrl() {
  const slug = new URLSearchParams(window.location.search).get("p");
  if (!slug) return;
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
