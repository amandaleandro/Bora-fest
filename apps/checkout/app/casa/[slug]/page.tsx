import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { EventImage } from "../../../components/EventImage";
import { GridCard } from "../../../components/EventCards";
import { FollowButton } from "../../../components/FollowButton";
import { API_BASE_URL, SITE_URL } from "../../../lib/config";
import type { EventListItem } from "../../../lib/api";

interface HouseProfile {
  id: string;
  slug: string;
  name: string;
  producerType: "CASA" | "ATLETICA" | "PRODUTORA" | "INDEPENDENTE" | "OUTRO" | null;
  since: string;
  followersCount: number;
  eventsCount: number;
  location: { name: string; city: string; state: string } | null;
  heroImageUrl: string | null;
  events: EventListItem[];
}

const TYPE_LABELS: Record<string, string> = {
  CASA: "Casa de shows / balada",
  ATLETICA: "Atlética",
  PRODUTORA: "Produtora de eventos",
  INDEPENDENTE: "Produtor independente",
  OUTRO: "Organizador",
};

async function getHouse(slug: string): Promise<HouseProfile | null> {
  const response = await fetch(`${API_BASE_URL}/v1/public/casas/${encodeURIComponent(slug)}`, {
    next: { revalidate: 30 },
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Casa HTTP ${response.status}`);
  return (await response.json()) as HouseProfile;
}

export async function generateMetadata({ params }: { params: { slug: string } }): Promise<Metadata> {
  const house = await getHouse(params.slug);
  if (!house) return { title: "Casa não encontrada | BoraFest" };

  const location = house.location ? ` em ${house.location.city}/${house.location.state}` : "";
  const description = `Veja os próximos eventos de ${house.name}${location}, acompanhe a agenda e compre ingressos pela BoraFest.`;

  return {
    title: `${house.name} | BoraFest`,
    description,
    alternates: { canonical: `${SITE_URL}/casa/${house.slug}` },
    openGraph: {
      title: `${house.name} | BoraFest`,
      description,
      url: `${SITE_URL}/casa/${house.slug}`,
      type: "website",
      images: house.heroImageUrl ? [{ url: house.heroImageUrl }] : undefined,
    },
    twitter: {
      card: house.heroImageUrl ? "summary_large_image" : "summary",
      title: `${house.name} | BoraFest`,
      description,
      images: house.heroImageUrl ? [house.heroImageUrl] : undefined,
    },
  };
}

export default async function HousePage({ params }: { params: { slug: string } }) {
  const house = await getHouse(params.slug);
  if (!house) notFound();

  const typeLabel = TYPE_LABELS[house.producerType ?? "OUTRO"] ?? "Organizador";
  const initials = house.name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");

  return (
    <main className="min-h-dvh bg-bg pb-20">
      <section className="relative overflow-hidden border-b border-line bg-surface">
        <div className="relative h-48 bg-brand-gradient sm:h-60 lg:h-72">
          {house.heroImageUrl ? (
            <>
              <EventImage
                src={house.heroImageUrl}
                priority
                sizes="100vw"
                className="object-cover opacity-55 blur-[1px]"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/65 via-black/20 to-black/10" />
            </>
          ) : null}
        </div>

        <div className="mx-auto max-w-6xl px-5 sm:px-6">
          <div className="relative -mt-14 flex flex-col gap-4 pb-6 sm:-mt-12 sm:flex-row sm:items-end sm:justify-between">
            <div className="flex items-end gap-4">
              <div className="flex h-24 w-24 shrink-0 items-center justify-center rounded-[28px] border-4 border-surface bg-brand-gradient text-[28px] font-black text-white shadow-card sm:h-28 sm:w-28">
                {initials || "BF"}
              </div>
              <div className="pb-1">
                <span className="inline-flex rounded-full bg-primary/10 px-2.5 py-1 text-[11px] font-extrabold text-primary">
                  {typeLabel}
                </span>
                <h1 className="mt-2 text-[26px] font-black leading-tight text-ink sm:text-[32px]">{house.name}</h1>
                <p className="mt-1 text-[13px] font-semibold text-muted">
                  {house.location ? `${house.location.city}/${house.location.state}` : "Agenda na BoraFest"}
                  {house.followersCount > 0
                    ? ` · ${house.followersCount.toLocaleString("pt-BR")} seguidor${house.followersCount === 1 ? "" : "es"}`
                    : ""}
                </p>
              </div>
            </div>
            <div className="pb-1">
              <FollowButton organizationId={house.id} organizationName={house.name} />
            </div>
          </div>
        </div>
      </section>

      <div className="mx-auto max-w-6xl px-5 py-8 sm:px-6 lg:py-10">
        <div className="grid gap-8 lg:grid-cols-[1fr_280px]">
          <section>
            <div className="flex items-end justify-between gap-4">
              <div>
                <p className="text-[12px] font-extrabold uppercase tracking-[.08em] text-primary">Agenda</p>
                <h2 className="mt-1 text-[22px] font-black text-ink">Próximos eventos</h2>
              </div>
              <Link href="/explorar" className="text-[13px] font-extrabold text-primary">
                Explorar BoraFest →
              </Link>
            </div>

            {house.events.length > 0 ? (
              <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-2 lg:grid-cols-3 lg:gap-4">
                {house.events.map((event) => (
                  <GridCard key={event.id} event={event} />
                ))}
              </div>
            ) : (
              <div className="mt-5 rounded-3xl border border-line bg-surface p-8 text-center">
                <p className="text-[15px] font-extrabold text-ink">Nenhum evento anunciado agora</p>
                <p className="mt-1 text-[13px] font-medium text-muted">
                  Siga {house.name} para receber aviso quando a próxima data entrar no ar.
                </p>
              </div>
            )}
          </section>

          <aside className="space-y-3">
            <div className="rounded-3xl border border-line bg-surface p-5">
              <p className="text-[12px] font-extrabold uppercase tracking-[.06em] text-muted-2">Sobre</p>
              <p className="mt-3 text-[14px] font-semibold leading-relaxed text-ink-soft">
                Página oficial de {house.name} na BoraFest. Acompanhe a agenda e compre pelos canais oficiais da plataforma.
              </p>
              <dl className="mt-5 space-y-3 border-t border-line pt-4 text-[13px]">
                <div className="flex items-center justify-between gap-3">
                  <dt className="font-semibold text-muted">Eventos cadastrados</dt>
                  <dd className="font-extrabold text-ink">{house.eventsCount}</dd>
                </div>
                {house.location ? (
                  <div className="flex items-start justify-between gap-3">
                    <dt className="font-semibold text-muted">Local principal</dt>
                    <dd className="text-right font-extrabold text-ink">
                      {house.location.name}<br />
                      <span className="text-[11px] font-semibold text-muted">{house.location.city}/{house.location.state}</span>
                    </dd>
                  </div>
                ) : null}
              </dl>
            </div>

            <div className="rounded-3xl border border-primary/20 bg-primary/5 p-5">
              <p className="text-[14px] font-extrabold text-ink">Não perca a próxima festa</p>
              <p className="mt-1 text-[12px] font-semibold leading-relaxed text-muted">
                Quem segue recebe aviso quando um novo evento é publicado.
              </p>
              <div className="mt-4">
                <FollowButton organizationId={house.id} organizationName={house.name} />
              </div>
            </div>
          </aside>
        </div>
      </div>
    </main>
  );
}
