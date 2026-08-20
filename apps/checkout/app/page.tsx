import { API_BASE_URL } from "../lib/config";
import type { EventListItem } from "../lib/api";
import { HomeClient, type HomeSections } from "./HomeClient";

/**
 * Home renderizada no SERVIDOR (2026-08-17, achado do GTmetrix): antes a página
 * chegava vazia ("Carregando eventos…") e o navegador só descobria o banner do
 * destaque depois de baixar o JS, hidratar e chamar a API — 4 idas e voltas em
 * série antes da primeira imagem pintar. Agora o HTML já sai com os eventos e a
 * URL do banner, então o download da imagem começa no primeiro instante.
 *
 * revalidate: 60 — a home fica em cache por 1 min; evento novo aparece sozinho.
 */
export const revalidate = 60;

async function buscar<T>(caminho: string): Promise<T | null> {
  try {
    const res = await fetch(`${API_BASE_URL}${caminho}`, { next: { revalidate: 60 } });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export default async function HomePage() {
  // sem cidade: é o que o visitante novo vê. Quem já escolheu cidade recebe
  // isto no primeiro quadro e o cliente ajusta em seguida.
  const [sections, lista, banners] = await Promise.all([
    buscar<HomeSections>("/v1/public/events/home/sections"),
    buscar<{ total: number; events: EventListItem[] }>("/v1/public/events"),
    buscar<{ desktopUrl: string | null; mobileUrl: string | null }>("/v1/public/banners"),
  ]);

  return <HomeClient initialSections={sections} initialEvents={lista?.events ?? null} banners={banners} />;
}
