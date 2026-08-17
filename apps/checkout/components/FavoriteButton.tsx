"use client";

import { useEffect, useState } from "react";
import { paths } from "./icons";
import { isFavorite, toggleFavorite } from "../lib/favorites";

/**
 * Coração de favoritar — no hero do evento e sobre os cards da vitrine.
 * Dentro de um card que é <Link>, o preventDefault impede a navegação:
 * tocar no coração favorita, tocar no card abre o evento.
 */
export function FavoriteButton({ eventId, small }: { eventId: string; small?: boolean }) {
  const [fav, setFav] = useState(false);

  useEffect(() => {
    setFav(isFavorite(eventId));
  }, [eventId]);

  return (
    <button
      type="button"
      aria-label={fav ? "Remover dos favoritos" : "Adicionar aos favoritos"}
      aria-pressed={fav}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setFav(toggleFavorite(eventId));
      }}
      className={`flex items-center justify-center rounded-full backdrop-blur transition-colors ${
        small ? "h-8 w-8" : "h-10 w-10"
      } ${fav ? "bg-white text-primary" : small ? "bg-black/30 text-white" : "bg-white/20 text-white"}`}
    >
      <svg
        width={small ? 15 : 18}
        height={small ? 15 : 18}
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
