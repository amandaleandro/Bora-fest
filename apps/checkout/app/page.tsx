"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { api, type EventListItem, type EventCategory } from "../lib/api";
import { formatCents } from "../lib/format";
import { Icon, paths } from "../components/icons";

const CATEGORY_LABELS: Record<string, string> = {
  SHOWS: "Shows",
  FESTAS: "Festas",
  ESPORTES: "Esportes",
  TEATRO: "Teatro",
};

type HomeSections = {
  highlights: EventListItem[];
  shelves: Array<{ category: EventCategory; events: EventListItem[] }>;
  upcoming: EventListItem[];
};

const CATEGORIES: Array<{ label: string; value: EventCategory | null }> = [
  { label: "Todos", value: null },
  { label: "Shows", value: "SHOWS" },
  { label: "Festas", value: "FESTAS" },
  { label: "Esportes", value: "ESPORTES" },
  { label: "Teatro", value: "TEATRO" },
];

/** "R$ 45,00" honesto (com taxas) ou "Grátis" — nunca um preço que muda depois. */
function priceLabel(cents: number | null): string | null {
  if (cents === null) return null;
  return cents === 0 ? "Grátis" : `a partir de ${formatCents(cents)}`;
}

/** Selo do destaque: urgência REAL (fim de lote < 48h) ou "Em alta" — nunca inventado. */
function highlightBadge(event: EventListItem): string {
  if (event.currentLotEndsAt) {
    const diffMs = new Date(event.currentLotEndsAt).getTime() - Date.now();
    if (diffMs > 0 && diffMs <= 48 * 60 * 60 * 1000) {
      const hours = Math.floor(diffMs / 3_600_000);
      if (hours < 1) return "Lote atual termina em minutos";
      if (hours < 24) return `Lote atual termina em ${hours}h`;
      return "Lote atual termina amanhã";
    }
  }
  return "Em alta agora";
}

function shortDate(iso: string): string {
  return new Date(iso)
    .toLocaleDateString("pt-BR", { day: "2-digit", month: "short", timeZone: "America/Sao_Paulo" })
    .replace(".", "");
}

/** Cartão compacto das fileiras horizontais (Em alta / prateleiras, mobile). */
function MiniCard({ event }: { event: EventListItem }) {
  return (
    <Link
      href={`/evento/${event.slug}`}
      className="w-[240px] shrink-0 overflow-hidden rounded-2xl border border-line bg-surface"
    >
      {event.bannerUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={event.bannerUrl} alt="" className="h-28 w-full object-cover" />
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
        {event.fromPriceCents !== null && (
          <p className="mt-1 text-[12px] font-extrabold text-primary">
            {event.fromPriceCents === 0 ? "Grátis" : formatCents(event.fromPriceCents)}
            {event.fromPriceCents !== 0 && (
              <span className="font-semibold text-muted"> · com taxas</span>
            )}
          </p>
        )}
      </div>
    </Link>
  );
}

/** Cartão da grade desktop (Em alta / prateleiras / próximos). */
function GridCard({ event }: { event: EventListItem }) {
  return (
    <Link
      href={`/evento/${event.slug}`}
      className="overflow-hidden rounded-2xl border border-line bg-surface transition-shadow hover:shadow-card"
    >
      {event.bannerUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={event.bannerUrl} alt="" className="h-36 w-full object-cover" />
      ) : (
        <div className="flex h-36 items-center justify-center bg-brand-gradient text-[40px] font-extrabold text-white/80">
          {event.title.slice(0, 1).toUpperCase()}
        </div>
      )}
      <div className="p-4">
        <p className="truncate text-[15px] font-extrabold">{event.title}</p>
        <p className="mt-0.5 truncate text-[12px] font-medium text-muted">
          {shortDate(event.startsAt)}
          {event.venue ? ` · ${event.venue.city}` : ""}
        </p>
        {priceLabel(event.fromPriceCents) && (
          <p className="mt-2 text-[13px] font-extrabold text-primary">
            {priceLabel(event.fromPriceCents)}
            {event.fromPriceCents ? (
              <span className="font-semibold text-muted"> · com taxas</span>
            ) : null}
          </p>
        )}
      </div>
    </Link>
  );
}

function DateBlock({ iso }: { iso: string }) {
  const d = new Date(iso);
  const day = d.toLocaleDateString("pt-BR", { day: "2-digit", timeZone: "America/Sao_Paulo" });
  const month = d
    .toLocaleDateString("pt-BR", { month: "short", timeZone: "America/Sao_Paulo" })
    .replace(".", "");
  return (
    <div className="flex h-14 w-14 shrink-0 flex-col items-center justify-center rounded-2xl bg-brand-gradient text-white">
      <span className="text-lg font-extrabold leading-none">{day}</span>
      <span className="text-[11px] font-bold uppercase">{month}</span>
    </div>
  );
}

export default function HomePage() {
  const [events, setEvents] = useState<EventListItem[] | null>(null);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<EventCategory | null>(null);

  const [cities, setCities] = useState<Array<{ city: string; state: string }>>([]);
  // cidade escolhida fica no aparelho; null = todas as cidades
  const [city, setCity] = useState<string | null>(null);
  const [cityOpen, setCityOpen] = useState(false);

  useEffect(() => {
    api.listPublicCities().then(setCities).catch(() => setCities([]));
    const saved = typeof window !== "undefined" ? window.localStorage.getItem("bf.cidade") : null;
    if (saved) setCity(saved);
  }, []);

  useEffect(() => {
    api
      .listPublicEventsByCity(city ?? undefined, category ?? undefined)
      .then(setEvents)
      .catch(() => setEvents([]));
  }, [city, category]);

  // home viva: Em alta (placar de vendas) + prateleiras por categoria
  const [sections, setSections] = useState<HomeSections | null>(null);
  useEffect(() => {
    api
      .getHomeSections(city ?? undefined)
      .then(setSections)
      .catch(() => setSections(null));
  }, [city]);

  // buscando ou filtrando por chip => lista plana (comportamento atual)
  const browsing = query.trim().length > 0 || category !== null;

  function pickCity(next: string | null) {
    setCity(next);
    setCityOpen(false);
    if (typeof window !== "undefined") {
      if (next) window.localStorage.setItem("bf.cidade", next);
      else window.localStorage.removeItem("bf.cidade");
    }
  }

  const filtered = useMemo(() => {
    if (!events) return [];
    const q = query.trim().toLowerCase();
    return q ? events.filter((e) => e.title.toLowerCase().includes(q)) : events;
  }, [events, query]);

  const sectionsView = !browsing && sections !== null;
  const highlight = sectionsView
    ? sections.highlights[0] ?? sections.upcoming[0] ?? filtered[0]
    : filtered[0];
  const emAlta = sectionsView ? sections.highlights : [];
  const shelves = sectionsView ? sections.shelves : [];
  const upcoming = sectionsView
    ? sections.upcoming.filter((e) => e.id !== highlight?.id)
    : filtered.slice(1);
  const rest = upcoming;

  const PANEL = process.env.NEXT_PUBLIC_PANEL_URL ?? "http://localhost:3001";

  return (
    <main className="px-5 pb-10 pt-6 lg:mx-auto lg:max-w-6xl lg:px-6">
      {/* hero desktop */}
      {highlight && (
        <section className="mb-8 hidden lg:block">
          <Link href={`/evento/${highlight.slug}`}
            className="relative block overflow-hidden rounded-3xl bg-brand-gradient p-12 text-white">
            {highlight.bannerUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={highlight.bannerUrl} alt="" className="absolute inset-0 h-full w-full object-cover" />
            )}
            <div className={`absolute inset-0 ${highlight.bannerUrl ? "bg-gradient-to-r from-black/75 via-black/40 to-transparent" : ""}`}>
              {!highlight.bannerUrl && (
                <div className="absolute -right-16 -top-16 h-72 w-72 rounded-full bg-accent/40 blur-3xl" />
              )}
            </div>
            <div className="relative">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-black/25 px-3 py-1 text-[12px] font-bold backdrop-blur">
                <span className="h-1.5 w-1.5 animate-pulseDot rounded-full bg-emerald-400" />
                {highlightBadge(highlight)}
              </span>
              <h2 className="mt-4 max-w-2xl text-[40px] font-extrabold leading-tight">{highlight.title}</h2>
              <p className="mt-2 text-[15px] font-semibold text-white/85">
                {highlight.venue ? `${highlight.venue.name} · ${highlight.venue.city}` : "Em breve"}
              </p>
              {priceLabel(highlight.fromPriceCents) && (
                <span className="mt-6 inline-block rounded-full bg-white px-6 py-3 text-[15px] font-extrabold text-ink">
                  {priceLabel(highlight.fromPriceCents)}
                  {highlight.fromPriceCents ? <span className="font-bold text-muted"> · com taxas</span> : null}
                </span>
              )}
            </div>
          </Link>
        </section>
      )}

      {/* saudação + avatar (mobile) */}
      <header className="flex items-center justify-between lg:hidden">
        <div>
          <h1 className="text-[22px] font-extrabold">Olá! 👋</h1>
          <button
            type="button"
            onClick={() => setCityOpen((v) => !v)}
            className="mt-0.5 flex items-center gap-1 text-[13px] font-semibold text-primary"
          >
            <Icon d={paths.pin} size={14} /> {city ?? "Todas as cidades"} ▾
          </button>
        </div>
        <Link
          href="/perfil"
          aria-label="Perfil"
          className="flex h-11 w-11 items-center justify-center rounded-full bg-gradient-to-br from-accent to-primary text-white"
        >
          <Icon d={paths.user} size={20} />
        </Link>
      </header>

      {cityOpen && (
        <div className="mt-3 rounded-2xl border border-line bg-surface p-2 lg:hidden">
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
          {cities.length === 0 && (
            <p className="px-3 py-2 text-[12.5px] font-semibold text-muted">
              As cidades aparecem aqui conforme os eventos são publicados.
            </p>
          )}
        </div>
      )}

      {/* busca */}
      <div className="mt-5 flex h-[50px] lg:hidden items-center gap-2 rounded-2xl border-[1.5px] border-line-input bg-surface px-4">
        <Icon d={paths.search} size={18} className="text-muted-3" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar shows, festas, esportes..."
          className="w-full bg-transparent text-[14px] font-medium outline-none placeholder:text-muted-3"
        />
      </div>

      {/* chips de categoria */}
      <div className="mt-4 flex gap-2 overflow-x-auto pb-1">
        {CATEGORIES.map((c) => (
          <button
            key={c.label}
            onClick={() => setCategory(c.value)}
            className={`shrink-0 rounded-full px-4 py-2 text-[12px] font-bold ${
              category === c.value
                ? "bg-ink text-white"
                : "border border-line-input bg-surface text-muted"
            }`}
          >
            {c.label}
          </button>
        ))}
      </div>

      {events === null ? (
        <p className="mt-10 text-center text-[13px] text-muted">Carregando eventos…</p>
      ) : filtered.length === 0 ? (
        <p className="mt-10 text-center text-[13px] text-muted">Nenhum evento encontrado.</p>
      ) : (
        <>
          {/* destaque (mobile) */}
          {highlight && (
            <section className="mt-6 lg:hidden">
              <h2 className="text-[15px] font-extrabold">{emAlta.length >= 2 ? "Destaque" : "Em alta"}</h2>
              <Link
                href={`/evento/${highlight.slug}`}
                className="relative mt-3 block h-[190px] overflow-hidden rounded-3xl bg-brand-gradient p-5 text-white"
              >
                {highlight.bannerUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={highlight.bannerUrl} alt="" className="absolute inset-0 h-full w-full object-cover" />
                )}
                {highlight.bannerUrl ? (
                  <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/30 to-black/20" />
                ) : (
                  <div className="absolute -right-10 -top-10 h-40 w-40 rounded-full bg-accent/40 blur-2xl" />
                )}
                <div className="relative">
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-black/25 px-3 py-1 text-[11px] font-bold backdrop-blur">
                    <span className="h-1.5 w-1.5 animate-pulseDot rounded-full bg-emerald-400" />
                    {highlightBadge(highlight)}
                  </span>
                  <h3 className="mt-3 max-w-[85%] text-[22px] font-extrabold leading-tight">
                    {highlight.title}
                  </h3>
                  <p className="mt-1 text-[12px] font-semibold text-white/85">
                    {highlight.venue ? `${highlight.venue.name} · ${highlight.venue.city}` : "Em breve"}
                  </p>
                </div>
                {priceLabel(highlight.fromPriceCents) && (
                  <span className="absolute bottom-5 left-5 rounded-full bg-white px-4 py-2 text-[13px] font-extrabold text-ink">
                    {priceLabel(highlight.fromPriceCents)}
                  </span>
                )}
              </Link>
            </section>
          )}

          {/* Em alta (placar de vendas) — só com procura real em 2+ eventos */}
          {emAlta.length >= 2 && (
            <section className="mt-7 lg:hidden">
              <h2 className="text-[15px] font-extrabold">Em alta 🔥</h2>
              <div className="-mx-5 mt-3 flex gap-3 overflow-x-auto px-5 pb-2">
                {emAlta.map((event) => (
                  <MiniCard key={event.id} event={event} />
                ))}
              </div>
            </section>
          )}

          {/* prateleiras por categoria (nascem com 3+ eventos) */}
          {shelves.map((shelf) => (
            <section key={shelf.category} className="mt-7 lg:hidden">
              <div className="flex items-center justify-between">
                <h2 className="text-[15px] font-extrabold">
                  {CATEGORY_LABELS[shelf.category] ?? shelf.category}
                </h2>
                <button
                  type="button"
                  onClick={() => setCategory(shelf.category)}
                  className="text-[12px] font-bold text-primary"
                >
                  Ver todos
                </button>
              </div>
              <div className="-mx-5 mt-3 flex gap-3 overflow-x-auto px-5 pb-2">
                {shelf.events.map((event) => (
                  <MiniCard key={event.id} event={event} />
                ))}
              </div>
            </section>
          ))}

          {/* próximos eventos */}
          {rest.length > 0 && (
            <section className="mt-7 lg:hidden">
              <h2 className="text-[15px] font-extrabold">Próximos eventos</h2>
              <ul className="mt-3 space-y-3">
                {rest.map((event) => {
                  const min = event.fromPriceCents;
                  return (
                    <li key={event.id}>
                      <Link
                        href={`/evento/${event.slug}`}
                        className="flex items-center gap-3.5 rounded-2xl border border-line bg-surface p-3.5"
                      >
                        {event.bannerUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={event.bannerUrl}
                            alt=""
                            className="h-14 w-14 shrink-0 rounded-2xl object-cover"
                          />
                        ) : (
                          <DateBlock iso={event.startsAt} />
                        )}
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[14px] font-bold">{event.title}</p>
                          <p className="truncate text-[12px] font-medium text-muted">
                            {event.bannerUrl
                              ? `${new Date(event.startsAt).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", timeZone: "America/Sao_Paulo" }).replace(".", "")} · `
                              : ""}
                            {event.venue ? `${event.venue.name} · ${event.venue.city}` : "Local a definir"}
                          </p>
                        </div>
                        {min !== null && (
                          <span className="shrink-0 text-right text-[13px] font-extrabold leading-tight text-primary">
                            {min === 0 ? "Grátis" : formatCents(min)}
                            {min !== 0 && (
                              <span className="block text-[10px] font-semibold text-muted">com taxas</span>
                            )}
                          </span>
                        )}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}
          {/* Em alta desktop (placar de vendas) */}
          {emAlta.length >= 2 && (
            <section className="hidden lg:block">
              <h2 className="text-[20px] font-extrabold">Em alta 🔥</h2>
              <div className="mt-4 grid grid-cols-4 gap-5">
                {emAlta.slice(0, 4).map((event) => (
                  <GridCard key={event.id} event={event} />
                ))}
              </div>
            </section>
          )}

          {/* prateleiras desktop */}
          {shelves.map((shelf) => (
            <section key={shelf.category} className="mt-8 hidden lg:block">
              <div className="flex items-center justify-between">
                <h2 className="text-[20px] font-extrabold">
                  {CATEGORY_LABELS[shelf.category] ?? shelf.category}
                </h2>
                <button
                  type="button"
                  onClick={() => setCategory(shelf.category)}
                  className="text-[13px] font-bold text-primary"
                >
                  Ver todos
                </button>
              </div>
              <div className="mt-4 grid grid-cols-3 gap-5">
                {shelf.events.slice(0, 6).map((event) => (
                  <GridCard key={event.id} event={event} />
                ))}
              </div>
            </section>
          ))}

          {/* grade desktop — próximos (ou lista filtrada quando navegando) */}
          {(sectionsView ? rest : filtered).length > 0 && (
            <section className="mt-8 hidden lg:block">
              <h2 className="text-[20px] font-extrabold">Próximos eventos</h2>
              <div className="mt-4 grid grid-cols-3 gap-5">
                {(sectionsView ? rest : filtered).map((event) => (
                  <GridCard key={event.id} event={event} />
                ))}
              </div>
            </section>
          )}

          {/* faixa Produza seu evento (desktop) — arte oficial da marca; o
              botão "Criar conta de produtor" faz parte da imagem, então o
              banner INTEIRO é o link */}
          <section className="mt-10 hidden lg:block">
            <a
              href={`${PANEL}/cadastro`}
              aria-label="Criar conta de produtor — do bora ao ingresso vendido em minutos, sem burocracia"
              className="group block overflow-hidden rounded-3xl shadow-card transition-transform duration-200 hover:-translate-y-0.5"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/brand/banner-produtores.webp"
                alt="Do bora? ao ingresso vendido em minutos. Sem burocracia — publique em minutos, Pix direto na tela, sem trava de verificação. Grátis para começar."
                className="w-full transition-transform duration-300 group-hover:scale-[1.01]"
              />
            </a>
          </section>
        </>
      )}
    </main>
  );
}
