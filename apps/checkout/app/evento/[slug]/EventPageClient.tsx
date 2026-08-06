"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, type PublicEvent } from "../../../lib/api";
import { formatCents } from "../../../lib/format";
import { Icon, paths } from "../../../components/icons";
import { TicketSelector } from "../../../components/TicketSelector";
import { PixelTracker } from "../../../components/PixelTracker";
import { capturePartnerFromUrl } from "../../../lib/attribution";
import { FollowButton } from "../../../components/FollowButton";

function minPriceCents(event: PublicEvent): number | null {
  const prices = event.ticketTypes.flatMap((t) =>
    t.lots.filter((l) => l.status === "ACTIVE").map((l) => l.priceCents),
  );
  return prices.length ? Math.min(...prices) : null;
}

export function EventPageClient({ slug }: { slug: string }) {
  const router = useRouter();
  const [event, setEvent] = useState<PublicEvent | null>(null);
  const [error, setError] = useState(false);
  const [reviews, setReviews] = useState<{ average: number | null; count: number } | null>(null);

  useEffect(() => {
    capturePartnerFromUrl();
    api.getPublicEvent(slug).then(setEvent).catch(() => setError(true));
    api.getReviews(slug).then(setReviews).catch(() => {});
  }, [slug]);

  if (error) {
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center px-8 text-center">
        <h1 className="text-lg font-extrabold">Evento não encontrado</h1>
        <Link href="/" className="mt-4 text-[14px] font-bold text-primary">Ver outros eventos</Link>
      </main>
    );
  }
  if (!event) {
    return <main className="flex min-h-dvh items-center justify-center text-[13px] text-muted">Carregando…</main>;
  }

  const closed = event.status !== "PUBLISHED" || new Date(event.endsAt).getTime() < Date.now();
  const min = minPriceCents(event);
  const starts = new Date(event.startsAt);
  const dateLabel = starts.toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "long", timeZone: event.timezone });
  const timeLabel = starts.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: event.timezone });

  return (
    <main className="pb-32 lg:mx-auto lg:max-w-6xl lg:px-6 lg:pb-16 lg:pt-8">
      <PixelTracker pixelSettings={event.pixelSettings} />
      {/* ---------- hotsite desktop: 2 colunas ---------- */}
      <div className="hidden gap-8 lg:grid lg:grid-cols-[1fr_400px]">
        <div>
          <div className="relative h-[320px] overflow-hidden rounded-3xl bg-brand-gradient">
            {event.bannerUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={event.bannerUrl} alt="" className="absolute inset-0 h-full w-full object-cover" />
            )}
            <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent p-8">
              <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-bold backdrop-blur ${closed ? "bg-black/50 text-white/90" : "bg-black/25 text-white"}`}>
                {closed ? "Vendas encerradas" : "Vendas abertas"}
              </span>
              <h1 className="mt-2 text-[32px] font-extrabold leading-tight text-white">{event.title}</h1>
            </div>
          </div>
          <div className="mt-4 flex items-center justify-between gap-2">
            <p className="text-[13px] font-semibold text-muted">
              Por {event.organization.name}
              {reviews?.count ? ` · ★ ${reviews.average?.toFixed(1)} (${reviews.count})` : ""}
            </p>
            <FollowButton organizationId={event.organizationId} organizationName={event.organization.name} />
          </div>
          <div className="mt-5 grid grid-cols-2 gap-3">
            <div className="flex items-center gap-3 rounded-2xl border border-line bg-surface p-4">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary"><Icon d={paths.calendar} /></div>
              <div>
                <p className="text-[14px] font-bold capitalize">{dateLabel}</p>
                <p className="text-[12px] font-medium text-muted">a partir de {timeLabel}</p>
              </div>
            </div>
            <div className="flex items-center gap-3 rounded-2xl border border-line bg-surface p-4">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary"><Icon d={paths.pin} /></div>
              <div className="min-w-0">
                <p className="truncate text-[14px] font-bold">{event.venue?.name ?? "Local a confirmar"}</p>
                <p className="truncate text-[12px] font-medium text-muted">
                  {event.venue ? `${event.venue.address} · ${event.venue.city}/${event.venue.state}` : ""}
                </p>
              </div>
            </div>
          </div>
          {event.description && (
            <section className="mt-6">
              <h2 className="text-[18px] font-extrabold">Sobre o evento</h2>
              <p className="mt-2 whitespace-pre-line text-[14px] font-medium leading-relaxed text-ink-soft">{event.description}</p>
            </section>
          )}
        </div>
        <aside className="lg:sticky lg:top-6 lg:self-start">
          <div className="rounded-3xl border border-line bg-bg p-5 shadow-card">
            <h2 className="text-[16px] font-extrabold">Ingressos</h2>
            {closed ? (
              <p className="mt-4 rounded-xl bg-line p-4 text-center text-[13px] font-bold text-muted">Vendas encerradas</p>
            ) : (
              <div className="mt-3"><TicketSelector event={event} compact /></div>
            )}
          </div>
        </aside>
      </div>

      {/* ---------- mobile (como no PWA) ---------- */}
      <div className="lg:hidden">
      {/* hero */}
      <div className="relative h-[430px] overflow-hidden bg-brand-gradient">
        {event.bannerUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={event.bannerUrl} alt="" className="absolute inset-0 h-full w-full object-cover" />
        )}
        <div className="absolute inset-0 bg-gradient-to-b from-black/40 via-transparent to-black/60" />
        <div className="absolute inset-x-0 top-0 flex items-center justify-between p-5">
          <button
            onClick={() => router.back()}
            aria-label="Voltar"
            className="flex h-10 w-10 items-center justify-center rounded-full bg-white/20 text-white backdrop-blur"
          >
            <Icon d={paths.back} />
          </button>
          <div className="flex gap-2">
            <button aria-label="Favoritar" className="flex h-10 w-10 items-center justify-center rounded-full bg-white/20 text-white backdrop-blur">
              <Icon d={paths.heart} size={18} />
            </button>
            <button
              aria-label="Compartilhar"
              onClick={() => navigator.share?.({ title: event.title, url: location.href }).catch(() => {})}
              className="flex h-10 w-10 items-center justify-center rounded-full bg-white/20 text-white backdrop-blur"
            >
              <Icon d={paths.share} size={18} />
            </button>
          </div>
        </div>
        <div className="absolute inset-x-0 bottom-8 px-5">
          <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-bold backdrop-blur ${closed ? "bg-black/50 text-white/90" : "bg-black/25 text-white"}`}>
            {closed ? "Vendas encerradas" : (<><span className="h-1.5 w-1.5 animate-pulseDot rounded-full bg-emerald-400" />Vendas abertas</>)}
          </span>
          <h1 className="mt-2 text-[27px] font-extrabold leading-tight text-white">{event.title}</h1>
        </div>
      </div>

      {/* corpo sobreposto */}
      <div className="relative -mt-[22px] rounded-t-3xl bg-bg px-5 pt-6">
        <div className="mb-3 flex items-center justify-between gap-2">
          <p className="text-[13px] font-semibold text-muted">
            Por {event.organization.name}
            {reviews?.count ? ` · ★ ${reviews.average?.toFixed(1)} (${reviews.count})` : ""}
          </p>
          <FollowButton organizationId={event.organizationId} organizationName={event.organization.name} />
        </div>
        <div className="space-y-3">
          <div className="flex items-center gap-3 rounded-2xl border border-line bg-surface p-3.5">
            <div className="flex h-[46px] w-[46px] items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Icon d={paths.calendar} />
            </div>
            <div>
              <p className="text-[14px] font-bold capitalize">{dateLabel}</p>
              <p className="text-[12px] font-medium text-muted">a partir de {timeLabel}</p>
            </div>
          </div>
          <div className="flex items-center gap-3 rounded-2xl border border-line bg-surface p-3.5">
            <div className="flex h-[46px] w-[46px] items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Icon d={paths.pin} />
            </div>
            <div className="min-w-0">
              <p className="truncate text-[14px] font-bold">{event.venue?.name ?? "Local a confirmar"}</p>
              <p className="truncate text-[12px] font-medium text-muted">
                {event.venue ? `${event.venue.address} · ${event.venue.city}/${event.venue.state}` : ""}
              </p>
            </div>
          </div>
        </div>

        {event.description && (
          <section className="mt-6">
            <h2 className="text-[16px] font-extrabold">Sobre o evento</h2>
            <p className="mt-2 whitespace-pre-line text-[14px] font-medium leading-relaxed text-ink-soft">
              {event.description}
            </p>
          </section>
        )}
      </div>

      {/* CTA sticky */}
      <div className="fixed inset-x-0 bottom-0 z-10 mx-auto max-w-[430px] border-t border-line bg-surface/90 p-4 backdrop-blur">
        {closed ? (
          <div className="space-y-2">
            <div className="flex h-14 items-center justify-center rounded-2xl bg-line text-[15px] font-bold text-muted-3">
              Vendas encerradas
            </div>
            <Link href="/" className="flex h-12 items-center justify-center rounded-2xl border-[1.5px] border-line-input text-[14px] font-bold text-ink">
              Ver outros eventos
            </Link>
          </div>
        ) : (
          <Link
            href={`/evento/${event.slug}/ingressos`}
            className="flex h-14 items-center justify-center rounded-2xl bg-primary text-[15px] font-extrabold text-white shadow-cta"
          >
            Comprar ingressos{min !== null ? ` · a partir de ${formatCents(min)}` : ""}
          </Link>
        )}
      </div>
      </div>
    </main>
  );
}
