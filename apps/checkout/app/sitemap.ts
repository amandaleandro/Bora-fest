import type { MetadataRoute } from "next";
import { API_BASE_URL, SITE_URL } from "../lib/config";

interface EventListItem {
  slug: string;
}

interface HouseListItem {
  slug: string;
}

async function listAllPublicSlugs(): Promise<string[]> {
  try {
    const res = await fetch(`${API_BASE_URL}/v1/public/events?pageSize=50`, { next: { revalidate: 300 } });
    if (!res.ok) return [];
    const data = (await res.json()) as { events: EventListItem[] };
    return data.events.map((e) => e.slug);
  } catch {
    return [];
  }
}

async function listAllPublicHouseSlugs(): Promise<string[]> {
  try {
    const pageSize = 100;
    let page = 1;
    const slugs: string[] = [];

    while (true) {
      const res = await fetch(`${API_BASE_URL}/v1/public/casas?page=${page}&pageSize=${pageSize}`, {
        next: { revalidate: 300 },
      });
      if (!res.ok) return [];

      const data = (await res.json()) as {
        total: number;
        page: number;
        pageSize: number;
        houses: HouseListItem[];
      };
      slugs.push(...data.houses.map((house) => house.slug));

      if (page * pageSize >= data.total) break;
      page += 1;
    }

    return slugs;
  } catch {
    return [];
  }
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [eventSlugs, houseSlugs] = await Promise.all([listAllPublicSlugs(), listAllPublicHouseSlugs()]);

  return [
    { url: SITE_URL, changeFrequency: "daily", priority: 1 },
    ...eventSlugs.map((slug) => ({
      url: `${SITE_URL}/${slug}`,
      changeFrequency: "hourly" as const,
      priority: 0.8,
    })),
    ...houseSlugs.map((slug) => ({
      url: `${SITE_URL}/casa/${slug}`,
      changeFrequency: "daily" as const,
      priority: 0.7,
    })),
  ];
}
