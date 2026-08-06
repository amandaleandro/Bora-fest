import type { MetadataRoute } from "next";
import { API_BASE_URL, SITE_URL } from "../lib/config";

interface EventListItem {
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

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const slugs = await listAllPublicSlugs();

  return [
    { url: SITE_URL, changeFrequency: "daily", priority: 1 },
    ...slugs.map((slug) => ({
      url: `${SITE_URL}/evento/${slug}`,
      changeFrequency: "hourly" as const,
      priority: 0.8,
    })),
  ];
}
