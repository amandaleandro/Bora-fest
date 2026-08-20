"use client";

import Link from "next/link";
import { type EventListItem } from "../lib/api";
import { formatCents } from "../lib/format";
import { FavoriteButton } from "./FavoriteButton";
import { EventImage } from "./EventImage";

/** "R$ 45,00" honesto (com taxas) ou "Grátis" — nunca um preço que muda depois. */
export function priceLabel(cents: number | null): string | null {
  if (cents === null) return null;
  return cents === 0 ? "Grátis" : `a partir de ${formatCents(cents)}`;
}

export function shortDate(iso: string): string {
  return new Date(iso)
    .toLocaleDateString("pt-BR", { day: "2-digit", month: "short", timeZone: "America/Sao_Paulo" })
    .replace(".", "");
}

/** Cartão compacto das fileiras horizontais (Em alta / prateleiras, mobile). */
export function MiniCard({ event }: { event: EventListItem }) {
  return (
    <div className="relative w-[240px] shrink-0">
      <Link
        href={`/${event.slug}`}
        className="block overflow-hidden rounded-2xl border border-line bg-surface"
      >
        {event.bannerUrl ? (
          <div className="relative h-28 w-full">
            <EventImage src={event.bannerUrl} sizes="240px" className="object-cover" />
          </div>
        ) : (
          <div className="flex h-28 items-center justify-center bg-brand-gradient text-[28px] font-extrabold text-white/85">
            {event.title.slice(0, 1).toUpperCase()}
          </div>
        )}
        <div className="p-3">
          <p className="truncate text-[13px] font-extrabold">{event.title}</p>
          <p className="mt-0.5 truncate text-[11px] font-medium text-muted">
            {shortDate(event.startsAt)}
            {event.venue ? ` · ${event.venue.city}` : ""}
          </p>
          {priceLabel(event.fromPriceCents) && (
            <p className="mt-1.5 text-[12px] font-extrabold text-primary">{priceLabel(event.fromPriceCents)}</p>
          )}
        </div>
      </Link>
      <div className="absolute right-2 top-2">
        <FavoriteButton eventId={event.id} small />
      </div>
    </div>
  );
}

/** Cartão de grade (2 col no mobile, 3–4 no desktop). */
export function GridCard({ event }: { event: EventListItem }) {
  return (
    <div className="relative">
      <Link
        href={`/${event.slug}`}
        className="block overflow-hidden rounded-2xl border border-line bg-surface transition-shadow hover:shadow-card"
      >
        {event.bannerUrl ? (
          <div className="relative h-32 w-full lg:h-36">
            <EventImage src={event.bannerUrl} sizes="(min-width: 1024px) 25vw, 50vw" className="object-cover" />
          </div>
        ) : (
          <div className="flex h-32 items-center justify-center bg-brand-gradient text-[36px] font-extrabold text-white/80 lg:h-36">
            {event.title.slice(0, 1).toUpperCase()}
          </div>
        )}
        <div className="p-3.5 lg:p-4">
          <p className="truncate text-[14px] font-extrabold lg:text-[15px]">{event.title}</p>
          <p className="mt-0.5 truncate text-[11.5px] font-medium text-muted lg:text-[12px]">
            {shortDate(event.startsAt)}
            {event.venue ? ` · ${event.venue.city}` : ""}
          </p>
          {priceLabel(event.fromPriceCents) && (
            <p className="mt-1.5 truncate text-[12.5px] font-extrabold text-primary lg:text-[13px]">
              {priceLabel(event.fromPriceCents)}
              {event.fromPriceCents ? (
                <span className="font-semibold text-muted"> · com taxas</span>
              ) : null}
            </p>
          )}
        </div>
      </Link>
      <div className="absolute right-2.5 top-2.5">
        <FavoriteButton eventId={event.id} small />
      </div>
    </div>
  );
}
