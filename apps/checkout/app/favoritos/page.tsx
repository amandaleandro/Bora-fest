"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api, type EventListItem } from "../../lib/api";
import { getFavorites } from "../../lib/favorites";
import { GridCard } from "../../components/EventCards";
import { Icon, paths } from "../../components/icons";

/** Aba Favoritos (redesenho mobile 2026-08-17): tudo que ganhou coração. */
export default function FavoritosPage() {
  const [events, setEvents] = useState<EventListItem[] | null>(null);
  const [favIds, setFavIds] = useState<string[]>([]);

  useEffect(() => {
    const read = () => setFavIds(getFavorites());
    read();
    window.addEventListener("bf.favs", read);
    window.addEventListener("storage", read);
    return () => {
      window.removeEventListener("bf.favs", read);
      window.removeEventListener("storage", read);
    };
  }, []);

  useEffect(() => {
    api.listPublicEventsByCity().then(setEvents).catch(() => setEvents([]));
  }, []);

  const favoritos = favIds
    .map((id) => (events ?? []).find((e) => e.id === id))
    .filter(Boolean) as EventListItem[];

  return (
    <main className="px-5 pb-10 pt-6 lg:mx-auto lg:max-w-6xl lg:px-6">
      <h1 className="text-[22px] font-extrabold">Favoritos ♥</h1>
      <p className="mt-0.5 text-[12.5px] font-semibold text-muted">
        Guardados neste aparelho — toque no coração de qualquer evento pra salvar.
      </p>

      {events === null ? (
        <p className="mt-10 text-center text-[13px] text-muted">Carregando…</p>
      ) : favoritos.length === 0 ? (
        <div className="mt-12 text-center">
          <div className="mx-auto flex h-[92px] w-[92px] items-center justify-center rounded-[28px] bg-primary/10 text-primary">
            <Icon d={paths.heart} size={38} />
          </div>
          <p className="mt-4 text-[15px] font-extrabold">Nada por aqui ainda</p>
          <p className="mx-auto mt-1 max-w-[300px] text-[13px] font-medium leading-relaxed text-muted">
            Viu um evento que te interessou? Toca no coração e ele fica guardado aqui.
          </p>
          <Link
            href="/explorar"
            className="mt-5 inline-block rounded-2xl bg-primary px-6 py-3.5 text-[14px] font-extrabold text-white shadow-cta"
          >
            Explorar eventos
          </Link>
        </div>
      ) : (
        <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-5">
          {favoritos.map((event) => (
            <GridCard key={event.id} event={event} />
          ))}
        </div>
      )}
    </main>
  );
}
