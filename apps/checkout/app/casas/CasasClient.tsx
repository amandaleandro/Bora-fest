"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { api } from "../../lib/api";
import { HouseCard } from "../../components/HouseCard";
import { housesApi, type HouseListItem } from "../../lib/houses-api";

export function CasasClient({ initialHouses }: { initialHouses: HouseListItem[] }) {
  const [houses, setHouses] = useState(initialHouses);
  const [followed, setFollowed] = useState<HouseListItem[]>([]);
  const [cities, setCities] = useState<Array<{ city: string; state: string }>>([]);
  const [city, setCity] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api.listPublicCities().then(setCities).catch(() => setCities([]));
    const saved = localStorage.getItem("bf.cidade");
    if (saved) setCity(saved);
  }, []);

  useEffect(() => {
    let active = true;
    setLoading(true);
    housesApi
      .listAll(city ?? undefined)
      .then((result) => {
        if (active) setHouses(result);
      })
      .catch(() => {
        if (active) setHouses([]);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    const token = localStorage.getItem("bf.token");
    if (token) {
      housesApi
        .followed(token, city ?? undefined)
        .then((result) => {
          if (active) setFollowed(result);
        })
        .catch(() => {
          if (active) setFollowed([]);
        });
    } else {
      setFollowed([]);
    }

    return () => {
      active = false;
    };
  }, [city]);

  function chooseCity(next: string | null) {
    setCity(next);
    if (next) localStorage.setItem("bf.cidade", next);
    else localStorage.removeItem("bf.cidade");
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLocaleLowerCase("pt-BR");
    if (!q) return houses;
    const pool = new Map<string, HouseListItem>();
    for (const house of [...followed, ...houses]) pool.set(house.id, house);
    return Array.from(pool.values()).filter((house) => {
      const searchable = [house.name, house.bio, house.location?.city, house.location?.state, house.nextEvent?.title]
        .filter(Boolean)
        .join(" ")
        .toLocaleLowerCase("pt-BR");
      return searchable.includes(q);
    });
  }, [houses, followed, query]);

  const followedIds = new Set(followed.map((house) => house.id));
  const discover = query.trim()
    ? filtered
    : filtered.filter((house) => !followedIds.has(house.id));

  return (
    <main className="px-5 pb-10 pt-6 lg:mx-auto lg:max-w-6xl lg:px-6 lg:pt-10">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[11px] font-extrabold uppercase tracking-[.1em] text-primary">BoraFest Casa</p>
          <h1 className="mt-1 text-[28px] font-extrabold tracking-tight text-ink lg:text-[38px]">Encontre sua próxima Casa</h1>
          <p className="mt-2 max-w-2xl text-[13px] font-medium leading-relaxed text-muted lg:text-[15px]">
            Siga casas, atléticas e produtores para acompanhar a agenda sem depender de descobrir cada evento do zero.
          </p>
        </div>
        <Link href="/" className="shrink-0 rounded-full border border-line-input px-3.5 py-2 text-[12px] font-bold text-muted hover:text-primary">
          ← Início
        </Link>
      </div>

      <div className="mt-6 grid gap-3 lg:grid-cols-[1fr_280px]">
        <label className="flex h-12 items-center gap-2 rounded-2xl border border-line-input bg-surface px-4">
          <span className="text-muted">⌕</span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Buscar Casa, cidade ou próximo evento"
            className="w-full bg-transparent text-[13.5px] font-semibold outline-none placeholder:text-muted-3"
          />
        </label>
        <select
          value={city ?? ""}
          onChange={(event) => chooseCity(event.target.value || null)}
          className="h-12 rounded-2xl border border-line-input bg-surface px-4 text-[13px] font-bold text-ink outline-none"
        >
          <option value="">Todas as cidades</option>
          {cities.map((item) => (
            <option key={`${item.city}-${item.state}`} value={item.city}>
              {item.city}, {item.state}
            </option>
          ))}
        </select>
      </div>

      {followed.length > 0 && !query.trim() ? (
        <section className="mt-8">
          <div className="flex items-end justify-between gap-3">
            <div>
              <p className="text-[11px] font-extrabold uppercase tracking-[.08em] text-primary">Sua rede</p>
              <h2 className="mt-1 text-[19px] font-extrabold text-ink lg:text-[23px]">Casas que você segue</h2>
            </div>
            <span className="text-[12px] font-semibold text-muted">{followed.length} seguindo</span>
          </div>
          <div className="-mx-5 mt-4 flex gap-3 overflow-x-auto px-5 pb-2 lg:mx-0 lg:grid lg:grid-cols-4 lg:overflow-visible lg:px-0">
            {followed.map((house) => (
              <HouseCard key={house.id} house={house} compact />
            ))}
          </div>
        </section>
      ) : null}

      <section className="mt-8">
        <div className="flex items-end justify-between gap-3">
          <div>
            <p className="text-[11px] font-extrabold uppercase tracking-[.08em] text-primary">Descobrir</p>
            <h2 className="mt-1 text-[19px] font-extrabold text-ink lg:text-[23px]">
              {query.trim() ? "Resultados" : city ? `Casas em ${city}` : "Casas com agenda ativa"}
            </h2>
          </div>
          <span className="text-[12px] font-semibold text-muted">{discover.length} encontradas</span>
        </div>

        {loading ? (
          <p className="mt-8 text-center text-[13px] font-semibold text-muted">Atualizando Casas…</p>
        ) : discover.length === 0 ? (
          <div className="mt-5 rounded-3xl border border-line bg-surface p-8 text-center">
            <p className="text-[15px] font-extrabold text-ink">Nenhuma Casa encontrada com esse filtro.</p>
            <p className="mt-1 text-[12px] font-medium text-muted">Tente outra cidade ou retire a busca.</p>
          </div>
        ) : (
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {discover.map((house) => (
              <HouseCard key={house.id} house={house} />
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
