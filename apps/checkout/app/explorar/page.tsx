"use client";

import { useEffect, useState } from "react";
import { api, type EventCategory, type EventListItem } from "../../lib/api";
import { GridCard } from "../../components/EventCards";
import { Icon, paths } from "../../components/icons";

const CATEGORIES: Array<{ label: string; value: EventCategory | null }> = [
  { label: "Tudo", value: null },
  { label: "Shows", value: "SHOWS" },
  { label: "Festas", value: "FESTAS" },
  { label: "Esportes", value: "ESPORTES" },
  { label: "Teatro", value: "TEATRO" },
];

/** Aba Explorar (redesenho mobile 2026-08-17): busca + categorias + cidade num lugar só. */
export default function ExplorarPage() {
  const [events, setEvents] = useState<EventListItem[] | null>(null);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<EventCategory | null>(null);
  const [cities, setCities] = useState<Array<{ city: string; state: string }>>([]);
  const [city, setCity] = useState<string | null>(null);
  const [cityOpen, setCityOpen] = useState(false);

  useEffect(() => {
    api.listPublicCities().then(setCities).catch(() => setCities([]));
    const saved = localStorage.getItem("bf.cidade");
    if (saved) setCity(saved);
  }, []);

  useEffect(() => {
    setEvents(null);
    api
      .listPublicEventsByCity(city ?? undefined, category ?? undefined)
      .then(setEvents)
      .catch(() => setEvents([]));
  }, [city, category]);

  function pickCity(next: string | null) {
    setCity(next);
    setCityOpen(false);
    if (next) localStorage.setItem("bf.cidade", next);
    else localStorage.removeItem("bf.cidade");
  }

  const q = query.trim().toLowerCase();
  const filtered = (events ?? []).filter((e) => !q || e.title.toLowerCase().includes(q));

  return (
    <main className="px-5 pb-10 pt-6 lg:mx-auto lg:max-w-6xl lg:px-6">
      <div className="flex items-center justify-between">
        <h1 className="text-[22px] font-extrabold">Explorar</h1>
        <button
          type="button"
          onClick={() => setCityOpen((v) => !v)}
          className="flex items-center gap-1 text-[13px] font-semibold text-primary"
        >
          <Icon d={paths.pin} size={14} /> {city ?? "Todas as cidades"} ▾
        </button>
      </div>

      {cityOpen && (
        <div className="mt-3 rounded-2xl border border-line bg-surface p-2">
          <button
            type="button"
            onClick={() => pickCity(null)}
            className={`block w-full rounded-xl px-3 py-2 text-left text-[13.5px] font-bold ${city === null ? "bg-primary/10 text-primary" : ""}`}
          >
            Todas as cidades
          </button>
          {cities.map((c) => (
            <button
              key={`${c.city}-${c.state}`}
              type="button"
              onClick={() => pickCity(c.city)}
              className={`block w-full rounded-xl px-3 py-2 text-left text-[13.5px] font-bold ${city === c.city ? "bg-primary/10 text-primary" : ""}`}
            >
              {c.city}, {c.state}
            </button>
          ))}
        </div>
      )}

      <div className="mt-4 flex h-[50px] items-center gap-2 rounded-2xl border-[1.5px] border-line-input bg-surface px-4">
        <Icon d={paths.search} size={18} className="text-muted-3" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar shows, festas, esportes..."
          className="w-full bg-transparent text-[16px] font-medium outline-none placeholder:text-muted-3"
        />
      </div>

      <div className="mt-4 flex gap-2 overflow-x-auto pb-1">
        {CATEGORIES.map((c) => (
          <button
            key={c.label}
            onClick={() => setCategory(c.value)}
            className={`shrink-0 rounded-full px-4 py-2 text-[12px] font-bold ${
              category === c.value ? "bg-ink text-white" : "border border-line-input bg-surface text-muted"
            }`}
          >
            {c.label}
          </button>
        ))}
      </div>

      {events === null ? (
        <p className="mt-10 text-center text-[13px] text-muted">Carregando eventos…</p>
      ) : filtered.length === 0 ? (
        <p className="mt-10 text-center text-[13px] text-muted">
          Nenhum evento encontrado{city ? ` em ${city}` : ""}.
        </p>
      ) : (
        <>
          <p className="mt-5 text-[12px] font-semibold text-muted">
            {filtered.length} {filtered.length === 1 ? "opção" : "opções"}
          </p>
          <div className="mt-2 grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-5">
            {filtered.map((event) => (
              <GridCard key={event.id} event={event} />
            ))}
          </div>
        </>
      )}
    </main>
  );
}
