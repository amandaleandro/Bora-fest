import type { Metadata } from "next";
import { API_BASE_URL, SITE_URL } from "../../../lib/config";
import type { PublicEvent } from "../../../lib/api";
import { EventPageClient } from "./EventPageClient";

/** Fetch direto (sem passar pelo helper `request` do client) — roda no servidor, sem localStorage/window. */
async function fetchEvent(slug: string): Promise<PublicEvent | null> {
  try {
    const res = await fetch(`${API_BASE_URL}/v1/public/events/${slug}`, { next: { revalidate: 30 } });
    if (!res.ok) return null;
    return (await res.json()) as PublicEvent;
  } catch {
    return null;
  }
}

export async function generateMetadata({ params }: { params: { slug: string } }): Promise<Metadata> {
  const event = await fetchEvent(params.slug);
  if (!event) {
    return { title: "Evento não encontrado — BoraFest" };
  }

  const url = `${SITE_URL}/evento/${event.slug}`;
  const description =
    event.description?.slice(0, 200) ??
    `Garanta seu ingresso para ${event.title}${event.venue ? ` em ${event.venue.city}` : ""} na BoraFest.`;

  return {
    title: `${event.title} — BoraFest`,
    description,
    alternates: { canonical: url },
    openGraph: {
      title: event.title,
      description,
      url,
      type: "website",
      images: event.bannerUrl ? [{ url: event.bannerUrl }] : undefined,
    },
    twitter: {
      card: "summary_large_image",
      title: event.title,
      description,
      images: event.bannerUrl ? [event.bannerUrl] : undefined,
    },
  };
}

export default async function EventPage({ params }: { params: { slug: string } }) {
  const event = await fetchEvent(params.slug);

  // dados estruturados (schema.org Event) — ajuda o Google a mostrar data/local/preço direto na busca
  const jsonLd = event
    ? {
        "@context": "https://schema.org",
        "@type": "Event",
        name: event.title,
        description: event.description ?? undefined,
        startDate: event.startsAt,
        endDate: event.endsAt,
        eventStatus: "https://schema.org/EventScheduled",
        eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode",
        location: event.venue
          ? {
              "@type": "Place",
              name: event.venue.name,
              address: {
                "@type": "PostalAddress",
                streetAddress: event.venue.address,
                addressLocality: event.venue.city,
                addressRegion: event.venue.state,
                addressCountry: "BR",
              },
            }
          : undefined,
        image: event.bannerUrl ? [event.bannerUrl] : undefined,
        organizer: { "@type": "Organization", name: event.organization.name },
        offers: event.ticketTypes.flatMap((type) =>
          type.lots
            .filter((lot) => lot.status === "ACTIVE")
            .map((lot) => ({
              "@type": "Offer",
              name: `${type.name} — ${lot.name}`,
              price: (lot.priceCents / 100).toFixed(2),
              priceCurrency: "BRL",
              availability: "https://schema.org/InStock",
              url: `${SITE_URL}/evento/${event.slug}`,
            })),
        ),
      }
    : null;

  return (
    <>
      {jsonLd && (
        // eslint-disable-next-line react/no-danger -- JSON-LD estático montado no servidor, sem input de usuário
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      )}
      <EventPageClient slug={params.slug} />
    </>
  );
}
