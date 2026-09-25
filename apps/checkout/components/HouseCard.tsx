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

/**
 * Card da Casa no mesmo molde do card de evento (pedido do Arthur, 2026-09-25):
 * a arte fica LIMPA em cima — nada de logo, nome ou degradê por cima do banner
 * que o produtor subiu — e a identificação vem embaixo, como o GridCard faz
 * com título e data.
 */
export function HouseCard({ house, compact = false }: { house: HouseListItem; compact?: boolean }) {
  const nextDate = dateLabel(house.nextEvent?.startsAt);

  return (
    <Link
      href={`/casa/${house.slug}`}
      className={`${compact ? "w-[245px] shrink-0" : "w-full"} group overflow-hidden rounded-3xl border border-line bg-surface shadow-sm transition hover:-translate-y-0.5 hover:shadow-md`}
    >
      {house.heroImageUrl ? (
        <div className={`${compact ? "h-[120px]" : "h-[150px]"} relative overflow-hidden`}>
          <EventImage
            src={house.heroImageUrl}
            sizes={compact ? "245px" : "(min-width: 1024px) 280px, 90vw"}
            className="object-cover transition duration-300 group-hover:scale-[1.02]"
          />
        </div>
      ) : (
        <div
          className={`${compact ? "h-[120px]" : "h-[150px]"} flex items-center justify-center bg-brand-gradient text-[36px] font-extrabold text-white/80`}
        >
          {initials(house.name)}
        </div>
      )}

      <div className="p-4">
        <div className="flex items-center gap-2.5">
          <div className="relative flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-line bg-bg text-[11px] font-extrabold text-primary">
            {house.logoUrl ? (
              <EventImage src={house.logoUrl} sizes="36px" className="object-cover" />
            ) : (
              initials(house.name)
            )}
          </div>
          <div className="min-w-0">
            <p className="truncate text-[14px] font-extrabold text-ink lg:text-[15px]">{house.name}</p>
            <p className="truncate text-[11.5px] font-medium text-muted lg:text-[12px]">
              {house.location ? `${house.location.city}, ${house.location.state}` : "BoraFest Casa"}
            </p>
          </div>
        </div>

        <div className="mt-3 border-t border-line pt-3">
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
      </div>
    </Link>
  );
}
