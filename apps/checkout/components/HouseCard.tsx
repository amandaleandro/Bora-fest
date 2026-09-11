import Link from "next/link";
import { EventImage } from "./EventImage";
import type { HouseListItem } from "../lib/houses-api";

function dateLabel(iso?: string | null) {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString("pt-BR", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    timeZone: "America/Sao_Paulo",
  });
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

export function HouseCard({ house, compact = false }: { house: HouseListItem; compact?: boolean }) {
  const nextDate = dateLabel(house.nextEvent?.startsAt);

  return (
    <Link
      href={`/casa/${house.slug}`}
      className={`${compact ? "w-[245px] shrink-0" : "w-full"} group overflow-hidden rounded-3xl border border-line bg-surface shadow-sm transition hover:-translate-y-0.5 hover:shadow-md`}
    >
      <div className={`${compact ? "h-[120px]" : "h-[150px]"} relative overflow-hidden bg-brand-gradient`}>
        {house.heroImageUrl ? (
          <EventImage
            src={house.heroImageUrl}
            sizes={compact ? "245px" : "(min-width: 1024px) 280px, 90vw"}
            className="object-cover transition duration-300 group-hover:scale-[1.02]"
          />
        ) : null}
        <div className="absolute inset-0 bg-gradient-to-t from-black/55 via-black/10 to-transparent" />
        <div className="absolute bottom-3 left-3 flex items-center gap-2.5">
          <div className="relative flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-2xl border-2 border-white/80 bg-white text-[12px] font-extrabold text-primary shadow-sm">
            {house.logoUrl ? (
              <EventImage src={house.logoUrl} sizes="44px" className="object-cover" />
            ) : (
              initials(house.name)
            )}
          </div>
          <div className="min-w-0 text-white">
            <p className="truncate text-[15px] font-extrabold">{house.name}</p>
            <p className="truncate text-[11px] font-semibold text-white/80">
              {house.location ? `${house.location.city}, ${house.location.state}` : "BoraFest Casa"}
            </p>
          </div>
        </div>
      </div>

      <div className="p-4">
        {house.nextEvent ? (
          <>
            <p className="text-[10px] font-extrabold uppercase tracking-[.08em] text-primary">Próximo evento</p>
            <p className="mt-1 truncate text-[13.5px] font-extrabold text-ink">{house.nextEvent.title}</p>
            <p className="mt-0.5 text-[11.5px] font-semibold text-muted">
              {nextDate} · {house.upcomingEventsCount} {house.upcomingEventsCount === 1 ? "evento na agenda" : "eventos na agenda"}
            </p>
          </>
        ) : (
          <p className="text-[12px] font-semibold text-muted">Acompanhe a agenda desta Casa.</p>
        )}
        <div className="mt-3 flex items-center justify-between text-[11px] font-bold text-muted">
          <span>{house.followersCount} {house.followersCount === 1 ? "seguidor" : "seguidores"}</span>
          <span className="text-primary">Ver Casa →</span>
        </div>
      </div>
    </Link>
  );
}
