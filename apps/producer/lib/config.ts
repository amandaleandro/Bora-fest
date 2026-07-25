export const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3333";

/** Site público / checkout: origem dos hotsites e das páginas legais. */
export const CHECKOUT_URL = process.env.NEXT_PUBLIC_CHECKOUT_URL ?? "http://localhost:3000";

export const TERMS_URL = `${CHECKOUT_URL}/legal?aba=termos`;
export const PRIVACY_URL = `${CHECKOUT_URL}/legal`;

export function hotsiteUrl(slug: string): string {
  return `${CHECKOUT_URL}/evento/${slug}`;
}
