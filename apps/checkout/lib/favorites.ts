/**
 * Favoritos do comprador (2026-08-17): guardados no aparelho (localStorage),
 * sem exigir login — o coração do hero funciona pra qualquer visitante.
 * Sincronizar com a conta (multi-aparelho) fica pra uma fase com backend.
 */
const KEY = "bf.favs";

export function getFavorites(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(raw) ? raw.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export function isFavorite(eventId: string): boolean {
  return getFavorites().includes(eventId);
}

/** Alterna e devolve o novo estado; avisa a home aberta na mesma aba via evento. */
export function toggleFavorite(eventId: string): boolean {
  const list = getFavorites();
  const has = list.includes(eventId);
  const next = has ? list.filter((id) => id !== eventId) : [...list, eventId];
  localStorage.setItem(KEY, JSON.stringify(next));
  window.dispatchEvent(new Event("bf.favs"));
  return !has;
}
