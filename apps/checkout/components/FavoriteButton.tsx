"use client";

import { useEffect, useState } from "react";
import { paths } from "./icons";
import { isFavorite, toggleFavorite } from "../lib/favorites";

/** Coração do hero do evento — estava morto no protótipo (report 2026-08-17). */
export function FavoriteButton({ eventId }: { eventId: string }) {
  const [fav, setFav] = useState(false);

  useEffect(() => {
    setFav(isFavorite(eventId));
  }, [eventId]);

  return (
    <button
      type="button"
      aria-label={fav ? "Remover dos favoritos" : "Adicionar aos favoritos"}
      aria-pressed={fav}
      onClick={() => setFav(toggleFavorite(eventId))}
      className={`flex h-10 w-10 items-center justify-center rounded-full backdrop-blur transition-colors ${
        fav ? "bg-white text-primary" : "bg-white/20 text-white"
      }`}
    >
      <svg
        width={18}
        height={18}
        viewBox="0 0 24 24"
        fill={fav ? "currentColor" : "none"}
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d={paths.heart} />
      </svg>
    </button>
  );
}
