"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { api, type EventListItem, type EventCategory } from "../lib/api";
import { getFavorites } from "../lib/favorites";
import { FavoriteButton } from "../components/FavoriteButton";
import { GridCard, MiniCard, priceLabel, shortDate } from "../components/EventCards";
import { EventImage } from "../components/EventImage";
import { captureAttributionFromUrl } from "../lib/attribution";
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


/** "Hoje, 21:00" / "Amanhã, 20:00" / "sáb., 12 de set · 22:00" — faixa do destaque. */
function featureWhen(iso: string): string {
  const d = new Date(iso);
  const hora = d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });
  const hoje = new Date();
  if (d.toDateString() === hoje.toDateString()) return `Hoje, ${hora}`;
  if (d.toDateString() === new Date(hoje.getTime() + 86_400_000).toDateString()) return `Amanhã, ${hora}`;
  const data = d.toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "short", timeZone: "America/Sao_Paulo" }).replace(".", "");
  return `${data} · ${hora}`;
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





export default function HomePage() {
  const [events, setEvents] = useState<EventListItem[] | null>(null);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<EventCategory | null>(null);

  const [cities, setCities] = useState<Array<{ city: string; state: string }>>([]);
  // cidade escolhida fica no aparelho; null = todas as cidades
  const [city, setCity] = useState<string | null>(null);
  const [cityOpen, setCityOpen] = useState(false);

  // atribuição: os links de promoter (/?pr=) e vendedor (/?vd=) aterrissam AQUI,
  // na home — captura na entrada, antes de navegar para o evento (que descarta a query)
  useEffect(() => {
    captureAttributionFromUrl();
  }, []);

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

  // favoritos do aparelho (bf.favs) cruzados com os eventos já carregados
  const favoritos = (() => {
    if (!favIds.length) return [] as EventListItem[];
    const pool = new Map<string, EventListItem>();
    const fontes = [
      ...(events ?? []),
      ...(sections ? [...sections.highlights, ...sections.upcoming, ...sections.shelves.flatMap((s) => s.events)] : []),
    ];
    for (const e of fontes) pool.set(e.id, e);
    return favIds.map((id) => pool.get(id)).filter(Boolean) as EventListItem[];
  })();

  const PANEL = process.env.NEXT_PUBLIC_PANEL_URL ?? "http://localhost:3001";

  return (
    <main className="px-5 pb-10 pt-6 lg:mx-auto lg:max-w-6xl lg:px-6">
      {/* hero desktop */}
      {highlight && (
        <section className="mb-8 hidden lg:block">
          <Link href={`/evento/${highlight.slug}`}
            className="relative flex min-h-[420px] flex-col justify-end overflow-hidden rounded-3xl bg-brand-gradient p-12 pb-10 text-white">
            {highlight.bannerUrl && (
              // a arte preenche o hero igual ao card do mobile; o hero mais alto (min-h-420)
              // evita o corte ultra-wide que espremia o flyer numa faixa fina.
              <EventImage src={highlight.bannerUrl} priority sizes="(min-width: 1200px) 1160px, 100vw" className="object-cover object-center" />
            )}
            <div className={`absolute inset-0 ${highlight.bannerUrl ? "bg-gradient-to-t from-black/85 via-black/25 to-transparent" : ""}`}>
              {!highlight.bannerUrl && (
                <div className="absolute -right-16 -top-16 h-72 w-72 rounded-full bg-accent/40 blur-3xl" />
              )}
            </div>
            <div className="relative">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-black/25 px-3 py-1 text-[12px] font-bold backdrop-blur">
                <span className="h-1.5 w-1.5 animate-pulseDot rounded-full bg-emerald-400" />
                {highlightBadge(highlight)}
              </span>
              <h2 className="mt-3 max-w-2xl truncate text-[36px] font-extrabold leading-tight">{highlight.title}</h2>
              <p className="mt-2 text-[15px] font-semibold text-white/85">
                {highlight.venue ? `${highlight.venue.name} · ${highlight.venue.city}` : "Em breve"}
              </p>
              {priceLabel(highlight.fromPriceCents) && (
                <span className="mt-4 inline-block rounded-full bg-white px-6 py-3 text-[15px] font-extrabold text-ink">
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
          {/* mesmo padrão do header desktop: B gradiente + nome em ink — o SVG
              horizontal tem letras brancas e sumia no fundo claro (aviso do Arthur) */}
          <h1 className="flex items-center gap-2">
            {/* eslint-disable-next-line @next/next/no-img-element -- logo local, svg leve */}
            <img src="/brand/logo-b.svg" alt="" className="h-8 w-8" />
            <span className="text-[21px] font-extrabold italic tracking-tight text-ink">BoraFest</span>
          </h1>
          <p className="mt-1 text-[12.5px] font-semibold text-muted">Seu próximo rolê começa aqui</p>
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
          {/* destaque (mobile) — "O que vai rolar?" (mockup do Arthur, 2026-08-17) */}
          {highlight && (
            <section className="mt-6 lg:hidden">
              <div className="flex items-end justify-between">
                <div>
                  <p className="text-[11px] font-extrabold uppercase tracking-[.09em] text-primary">
                    {featureWhen(highlight.startsAt).startsWith("Hoje") ? "Para hoje" : "Em destaque"}
                  </p>
                  <h2 className="mt-0.5 text-[19px] font-extrabold leading-tight">O que vai rolar?</h2>
                </div>
                <Link href="/explorar" className="text-[12.5px] font-extrabold text-primary">Ver tudo</Link>
              </div>
              <div className="relative mt-3 overflow-hidden rounded-3xl">
                <Link href={`/evento/${highlight.slug}`} className="block">
                  <div className="relative h-[200px] bg-brand-gradient p-5 text-white">
                    {highlight.bannerUrl && (
                      <EventImage src={highlight.bannerUrl} priority sizes="430px" className="object-cover" />
                    )}
                    {highlight.bannerUrl ? (
                      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/25 to-black/20" />
                    ) : (
                      <div className="absolute -right-10 -top-10 h-40 w-40 rounded-full bg-accent/40 blur-2xl" />
                    )}
                    <span className="absolute left-4 top-4 inline-flex items-center gap-1.5 rounded-full bg-black/35 px-3 py-1 text-[11px] font-bold backdrop-blur">
                      <span className="h-1.5 w-1.5 animate-pulseDot rounded-full bg-emerald-400" />
                      {highlightBadge(highlight)}
                    </span>
                    <div className="absolute inset-x-5 bottom-4">
                      <h3 className="truncate text-[23px] font-extrabold leading-tight">{highlight.title}</h3>
                      <p className="mt-0.5 truncate text-[12px] font-semibold text-white/85">
                        {highlight.venue ? `${highlight.venue.name} · ${highlight.venue.city}` : "Em breve"}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center justify-between gap-3 bg-ink px-5 py-3.5 text-white">
                    <div className="min-w-0">
                      <p className="text-[11.5px] font-semibold text-white/65">{featureWhen(highlight.startsAt)}</p>
                      <p className="truncate text-[15px] font-extrabold">
                        {priceLabel(highlight.fromPriceCents) ?? "Garanta seu lugar"}
                      </p>
                    </div>
                    <span className="shrink-0 rounded-full bg-primary px-5 py-2.5 text-[13.5px] font-extrabold shadow-cta">
                      Quero ir →
                    </span>
                  </div>
                </Link>
                <div className="absolute right-4 top-4">
                  <FavoriteButton eventId={highlight.id} />
                </div>
              </div>
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

          {/* Seus favoritos (coração do evento — guardado no aparelho) */}
          {sectionsView && favoritos.length > 0 && (
            <section className="mt-7 lg:hidden">
              <h2 className="text-[15px] font-extrabold">Seus favoritos ♥</h2>
              <div className="-mx-5 mt-3 flex gap-3 overflow-x-auto px-5 pb-2">
                {favoritos.map((event) => (
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

          {/* perto de você / próximos — grade 2 col (mockup 2026-08-17) */}
          {rest.length > 0 && (
            <section className="mt-7 lg:hidden">
              <div className="flex items-baseline justify-between">
                <h2 className="text-[15px] font-extrabold">{city ? "Perto de você" : "Próximos eventos"}</h2>
                <span className="text-[12px] font-semibold text-muted">
                  {rest.length} {rest.length === 1 ? "opção" : "opções"}
                </span>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-3">
                {rest.map((event) => (
                  <GridCard key={event.id} event={event} />
                ))}
              </div>
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

          {/* Seus favoritos desktop */}
          {sectionsView && favoritos.length > 0 && (
            <section className="hidden lg:block">
              <h2 className="text-[20px] font-extrabold">Seus favoritos ♥</h2>
              <div className="mt-4 grid grid-cols-4 gap-5">
                {favoritos.slice(0, 8).map((event) => (
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
          <section className="mt-12 lg:mt-14">
            <a
              href={`${PANEL}/cadastro`}
              aria-label="Criar conta de produtor — do bora ao ingresso vendido em minutos, sem burocracia"
              className="group block overflow-hidden rounded-2xl shadow-card transition-transform duration-200 hover:-translate-y-0.5 lg:rounded-3xl"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/brand/banner-produtores.webp"
                alt="Do bora? ao ingresso vendido em minutos. Sem burocracia — publique em minutos, Pix direto na tela, sem trava de verificação. Grátis para começar."
                loading="lazy" decoding="async" className="h-auto w-full transition-transform duration-300 group-hover:scale-[1.01]"
              />
            </a>
          </section>
        </>
      )}
    </main>
  );
}
