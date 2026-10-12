export const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3333";

/**
 * Endereço público do site — fonte ÚNICA de toda URL absoluta do checkout
 * (metadataBase, canonical, og:url, JSON-LD, robots.txt e sitemap.xml).
 *
 * 2026-10-12: o build de produção não recebia NEXT_PUBLIC_SITE_URL e o
 * fallback era localhost:3100 — robots, sitemap e canonical foram ao ar
 * apontando para localhost. Sem a variável, o build de produção agora cai no
 * domínio real; localhost só em dev (porta do `next dev`). Vazio conta como
 * ausente e a barra final sai, para `${SITE_URL}/slug` não virar `//slug`.
 */
export function resolverSiteUrl(valor: string | undefined, nodeEnv: string | undefined): string {
  const padrao = nodeEnv === "production" ? "https://borafest.com.br" : "http://localhost:3000";
  return (valor?.trim() || padrao).replace(/\/+$/, "");
}

export const SITE_URL = resolverSiteUrl(process.env.NEXT_PUBLIC_SITE_URL, process.env.NODE_ENV);
