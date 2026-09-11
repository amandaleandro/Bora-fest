import { API_BASE_URL } from "../lib/config";
import type { EventListItem } from "../lib/api";
import type { HouseListResponse } from "../lib/houses-api";
import { HomeClient, type HomeSections } from "./HomeClient";
import { HomeHouses } from "./HomeHouses";

/**
 * Home renderizada no servidor: eventos, banners e Casas chegam no HTML inicial.
 * revalidate: 60 — evento/Casa novo aparece sozinho sem transformar a home em SSR por request.
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
  const [sections, lista, banners, houses] = await Promise.all([
    buscar<HomeSections>("/v1/public/events/home/sections"),
    buscar<{ total: number; events: EventListItem[] }>("/v1/public/events"),
    buscar<{ desktopUrl: string | null; mobileUrl: string | null }>("/v1/public/banners"),
    buscar<HouseListResponse>("/v1/public/casas?pageSize=8"),
  ]);

  return (
    <>
      <HomeClient initialSections={sections} initialEvents={lista?.events ?? null} banners={banners} />
      <HomeHouses initialHouses={houses?.houses ?? []} />
    </>
  );
}
