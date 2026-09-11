import { API_BASE_URL } from "./config";

export interface HouseEventPreview {
  id: string;
  title: string;
  slug: string;
  bannerUrl: string | null;
  category: string | null;
  startsAt: string;
  timezone: string;
  venue: { name: string; city: string; state: string } | null;
  fromPriceCents: number | null;
  currentLotEndsAt: string | null;
}

export interface HouseListItem {
  id: string;
  slug: string;
  name: string;
  producerType: string | null;
  bio: string | null;
  logoUrl: string | null;
  coverUrl: string | null;
  heroImageUrl: string | null;
  followersCount: number;
  upcomingEventsCount: number;
  location: { name: string; city: string; state: string } | null;
  nextEvent: HouseEventPreview | null;
}

export interface HouseListResponse {
  total: number;
  page: number;
  pageSize: number;
  houses: HouseListItem[];
}

async function request<T>(path: string, token?: string): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    cache: "no-store",
  });
  if (!response.ok) throw new Error("Não foi possível carregar as Casas");
  return (await response.json()) as T;
}

function listPage(city?: string, pageSize = 50, page = 1) {
  const params = new URLSearchParams({ pageSize: String(pageSize), page: String(page) });
  if (city) params.set("city", city);
  return request<HouseListResponse>(`/v1/public/casas?${params.toString()}`);
}

export const housesApi = {
  list: listPage,

  /**
   * A busca de Casas é local/instantânea no navegador. Para ela não ficar
   * limitada às primeiras 100 Casas, percorremos as páginas da API em lotes
   * de 100 e entregamos a coleção completa ao filtro de texto.
   */
  listAll: async (city?: string): Promise<HouseListItem[]> => {
    const first = await listPage(city, 100, 1);
    const pages = Math.ceil(first.total / first.pageSize);
    if (pages <= 1) return first.houses;

    const remaining = await Promise.all(
      Array.from({ length: pages - 1 }, (_, index) => listPage(city, 100, index + 2)),
    );
    return [first, ...remaining].flatMap((result) => result.houses);
  },

  followed: (token: string, city?: string) => {
    const params = new URLSearchParams();
    if (city) params.set("city", city);
    const qs = params.toString();
    return request<HouseListItem[]>(`/v1/casas/following/mine${qs ? `?${qs}` : ""}`, token);
  },
};
