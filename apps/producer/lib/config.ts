export const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3333";

/** Site público / checkout: origem dos hotsites e das páginas legais. */
export const CHECKOUT_URL = process.env.NEXT_PUBLIC_CHECKOUT_URL ?? "http://localhost:3000";

export const TERMS_URL = `${CHECKOUT_URL}/legal?aba=termos`;
export const PRIVACY_URL = `${CHECKOUT_URL}/legal`;

/**
 * Link curto do evento (borafest.com.br/<slug>). 2026-10-12: montava
 * /evento/<slug>, rota antiga que só redireciona — o produtor copiava e
 * divulgava o endereço longo, com um salto a mais até a página.
 */
export function hotsiteUrl(slug: string): string {
  return `${CHECKOUT_URL}/${slug}`;
}
