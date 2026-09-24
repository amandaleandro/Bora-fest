"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { api, type EventListItem, type EventCategory, type SearchSuggestions } from "../lib/api";
import { getFavorites } from "../lib/favorites";
import { FavoriteButton } from "../components/FavoriteButton";
import { GridCard, MiniCard, priceLabel, shortDate } from "../components/EventCards";
import { EventImage } from "../components/EventImage";
import { PromoBanner } from "../components/PromoBanner";
import { captureAttributionFromUrl } from "../lib/attribution";
import { Icon, paths } from "../components/icons";

const CATEGORY_LABELS: Record<string, string> = {
  SHOWS: "Shows",
  FESTAS: "Festas",
  ESPORTES: "Esportes",
  TEATRO: "Teatro",
};

export type HomeSections = {
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
function normalizeSearch(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

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





function SearchSuggestionsPanel({
  data,
  query,
}: {
  data: SearchSuggestions | null;
  query: string;
}) {
  if (query.trim().length < 2 || !data) return null;
  const hasAny = data.events.length > 0 || data.houses.length > 0 || data.attractions.length > 0;

  return (
    <div className="absolute left-0 right-0 top-full z-50 mt-2 max-h-[420px] overflow-y-auto rounded-2xl border border-line bg-surface p-3 text-ink shadow-card">
      {!hasAny ? (
        <p className="px-2 py-3 text-[12.5px] font-semibold text-muted">
          Nenhuma sugestão para “{query.trim()}”.
        </p>
      ) : null}

      {data.events.length > 0 ? (
        <div>
          <p className="px-2 pb-1.5 text-[10px] font-extrabold uppercase tracking-[.08em] text-muted-2">Eventos</p>
          {data.events.map((event) => (
            <Link
              key={event.id}
              href={`/${event.slug}`}
              className="flex items-center justify-between gap-3 rounded-xl px-2 py-2.5 hover:bg-bg"
            >
              <div className="min-w-0">
                <p className="truncate text-[13px] font-extrabold">{event.title}</p>
                <p className="truncate text-[11px] font-semibold text-muted">
                  {event.venue ? `${event.venue.name} · ${event.venue.city}/${event.venue.state}` : event.organization?.name ?? "BoraFest"}
                </p>
              </div>
              <span className="text-[11px] font-extrabold text-primary">Ver →</span>
            </Link>
          ))}
        </div>
      ) : null}

      {data.houses.length > 0 ? (
        <div className={data.events.length > 0 ? "mt-3 border-t border-line pt-3" : ""}>
          <p className="px-2 pb-1.5 text-[10px] font-extrabold uppercase tracking-[.08em] text-muted-2">Casas e produtores</p>
          {data.houses.map((house) => (
            <Link
              key={house.id}
              href={`/casa/${house.slug}`}
              className="flex items-center justify-between gap-3 rounded-xl px-2 py-2.5 hover:bg-bg"
            >
              <div className="min-w-0">
                <p className="truncate text-[13px] font-extrabold">{house.name}</p>
                <p className="truncate text-[11px] font-semibold text-muted">
                  {house.location ? `${house.location.city}/${house.location.state}` : "Perfil na BoraFest"}
                </p>
              </div>
              <span className="text-[11px] font-extrabold text-primary">Casa →</span>
            </Link>
          ))}
        </div>
      ) : null}

      {data.attractions.length > 0 ? (
        <div className={data.events.length > 0 || data.houses.length > 0 ? "mt-3 border-t border-line pt-3" : ""}>
          <p className="px-2 pb-1.5 text-[10px] font-extrabold uppercase tracking-[.08em] text-muted-2">Atrações</p>
          {data.attractions.map((item) => (
            <Link
              key={`${item.name}-${item.eventSlug}`}
              href={`/${item.eventSlug}`}
              className="block rounded-xl px-2 py-2.5 hover:bg-bg"
            >
              <p className="text-[13px] font-extrabold">{item.name}</p>
              <p className="mt-0.5 truncate text-[11px] font-semibold text-muted">
                {item.eventTitle} · {item.houseName}
              </p>
            </Link>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function HomeClient({
  initialSections,
  initialEvents,
  banners,
}: {
  initialSections: HomeSections | null;
  initialEvents: EventListItem[] | null;
  banners?: { desktopUrl: string | null; mobileUrl: string | null } | null;
}) {
  const [events, setEvents] = useState<EventListItem[] | null>(initialEvents);
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<SearchSuggestions | null>(null);
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
    const q = query.trim();
    if (q.length < 2) {
      setSuggestions(null);
      return;
    }

    const timer = window.setTimeout(() => {
      api.searchSuggestions(q, city ?? undefined).then(setSuggestions).catch(() => setSuggestions(null));
    }, 180);

    return () => window.clearTimeout(timer);
  }, [query, city]);



  // o servidor já entregou a 1ª carga (cidade/categoria padrão) — só refaz
  // quando o visitante mexe no filtro, senão duplica request e pisca a tela
  const primeiraCarga = useRef(true);
  useEffect(() => {
    if (primeiraCarga.current && initialEvents !== null && city === null && category === null && query.trim() === "") {
      primeiraCarga.current = false;
      return;
    }
    primeiraCarga.current = false;

    const timer = window.setTimeout(() => {
      api
        .listPublicEventsByCity(city ?? undefined, category ?? undefined, query.trim() || undefined)
        .then(setEvents)
        .catch(() => setEvents([]));
    }, query.trim() ? 250 : 0);

    return () => window.clearTimeout(timer);
  }, [city, category, query, initialEvents]);

  // home viva: Em alta (placar de vendas) + prateleiras por categoria
  const [sections, setSections] = useState<HomeSections | null>(initialSections);
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
  const primeiraSecao = useRef(true);
  useEffect(() => {
    if (primeiraSecao.current && initialSections !== null && city === null) {
      primeiraSecao.current = false;
      return;
    }
    primeiraSecao.current = false;
    api
      .getHomeSections(city ?? undefined)
      .then(setSections)
      .catch(() => setSections(null));
  }, [city, initialSections]);

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
    const q = normalizeSearch(query);
    if (!q) return events;

    return events.filter((e) => {
      const searchable = [
        e.title,
        e.venue?.name,
        e.venue?.city,
        e.venue?.state,
        e.organization?.name,
        e.lineup,
        e.category ? CATEGORY_LABELS[e.category] ?? e.category : null,
      ]
        .filter(Boolean)
        .join(" ");
      return normalizeSearch(searchable).includes(q);
    });
  }, [events, query]);

  const sectionsView = !browsing && sections !== null;
  // O hero de evento só existe quando o backend classificou procura real em highlights.
  // Próximo evento não vira "destaque" automaticamente.
  const highlight = sectionsView ? sections.highlights[0] ?? null : null;
  const showInstitutionalHero = !browsing && !highlight;
  const emAlta = sectionsView ? sections.highlights : [];
  const shelves = sectionsView ? sections.shelves : [];
  const rest = sectionsView
    ? sections.upcoming.filter((e) => e.id !== highlight?.id)
    : filtered;

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
      {/* Hero institucional: aparece quando não existe destaque real de vendas. */}
      {showInstitutionalHero && (
        <section className="mb-8 hidden min-h-[390px] overflow-hidden rounded-3xl bg-brand-gradient text-white lg:grid lg:grid-cols-[1.25fr_.75fr]">
          <div className="flex flex-col justify-center p-12">
            <span className="w-fit rounded-full bg-white/15 px-3 py-1 text-[12px] font-extrabold backdrop-blur">
              Descubra. Compre. Entre.
            </span>
            <h2 className="mt-5 max-w-2xl text-[44px] font-extrabold leading-[1.04]">
              Seu próximo rolê começa aqui.
            </h2>
            <p className="mt-4 max-w-xl text-[16px] font-medium leading-relaxed text-white/80">
              Encontre eventos na sua cidade, compre sem complicação e leve seu ingresso no celular.
            </p>
            <div className="mt-7 flex flex-wrap gap-3">
              <Link href="/explorar" className="rounded-xl bg-white px-5 py-3 text-[13px] font-extrabold text-ink shadow-card">
                Explorar eventos
              </Link>
              <Link href="/casas" className="rounded-xl border border-white/25 bg-white/10 px-5 py-3 text-[13px] font-extrabold text-white">
                Descobrir Casas
              </Link>
            </div>
            <div className="mt-4 flex items-center gap-4 text-[13px] font-bold">
              <Link href="/para-produtores" className="text-white underline decoration-white/40 underline-offset-4">
                Produzo eventos
              </Link>
              <span className="text-white/50">•</span>
              <span className="text-white/75">{city ?? "Eventos em várias cidades"}</span>
            </div>
          </div>
          <div className="relative hidden overflow-hidden lg:block">
            <div className="absolute -right-20 -top-20 h-80 w-80 rounded-full bg-accent/45 blur-3xl" />
            <div className="absolute bottom-8 right-8 w-[290px] rounded-3xl border border-white/15 bg-white/10 p-6 backdrop-blur">
              <p className="text-[12px] font-extrabold uppercase tracking-[.12em] text-white/65">BoraFest</p>
              <p className="mt-3 text-[25px] font-extrabold leading-tight">Do ingresso à entrada, sem complicação.</p>
              <div className="mt-5 space-y-3 text-[13px] font-semibold text-white/80">
                <p>✓ Compra rápida e transparente</p>
                <p>✓ Ingresso com QR individual</p>
                <p>✓ Sem app obrigatório para entrar</p>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* hero de evento — somente com destaque real */}
      {highlight && (
        <section className="mb-8 hidden lg:block">
          <Link href={`/${highlight.slug}`}
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

      <div className="relative mt-5 hidden lg:block">
        <div className="flex h-[54px] max-w-2xl items-center gap-2 rounded-2xl border border-line bg-surface px-4 shadow-sm">
          <Icon d={paths.search} size={19} className="shrink-0 text-muted-3" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar eventos, Casas, atrações, locais ou cidades"
            className="min-w-0 flex-1 bg-transparent px-2 text-[14px] font-semibold text-ink outline-none placeholder:text-muted-3"
          />
          {(query || category) ? (
            <button
              type="button"
              onClick={() => { setQuery(""); setCategory(null); setSuggestions(null); }}
              className="rounded-xl px-3 py-2 text-[12px] font-extrabold text-muted hover:bg-bg"
            >
              Limpar
            </button>
          ) : null}
        </div>
        <div className="max-w-2xl">
          <SearchSuggestionsPanel data={suggestions} query={query} />
        </div>
      </div>

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
      <div className="relative mt-5 lg:hidden">
        <div className="flex h-[50px] items-center gap-2 rounded-2xl border-[1.5px] border-line-input bg-surface px-4">
          <Icon d={paths.search} size={18} className="text-muted-3" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar eventos, Casas ou atrações..."
            className="w-full bg-transparent text-[14px] font-medium outline-none placeholder:text-muted-3"
          />
        </div>
        <SearchSuggestionsPanel data={suggestions} query={query} />
      </div>

      {showInstitutionalHero && (
        <section className="relative mt-5 overflow-hidden rounded-3xl bg-brand-gradient p-6 text-white lg:hidden">
          <div className="absolute -right-12 -top-12 h-40 w-40 rounded-full bg-accent/40 blur-2xl" />
          <div className="relative">
            <p className="text-[11px] font-extrabold uppercase tracking-[.12em] text-white/70">BoraFest</p>
            <h2 className="mt-2 text-[27px] font-extrabold leading-[1.05]">Seu próximo rolê começa aqui.</h2>
            <p className="mt-3 max-w-[300px] text-[13px] font-semibold leading-relaxed text-white/80">
              Descubra eventos, compre pelo celular e entre com seu QR.
            </p>
            <div className="mt-5 flex gap-2">
              <Link href="/explorar" className="rounded-xl bg-white px-4 py-3 text-[12.5px] font-extrabold text-ink">
                Explorar eventos
              </Link>
              <Link href="/para-produtores" className="rounded-xl border border-white/25 bg-white/10 px-4 py-3 text-[12.5px] font-extrabold text-white">
                Produzo eventos
              </Link>
            </div>
          </div>
        </section>
      )}

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
        <div className="mt-10 rounded-2xl border border-line bg-surface p-6 text-center">
          <p className="text-[14px] font-extrabold text-ink">Nenhum evento encontrado</p>
          <p className="mt-1 text-[13px] font-medium text-muted">Tente outro nome, local, cidade ou categoria.</p>
          {(query || category) && (
            <button
              type="button"
              onClick={() => { setQuery(""); setCategory(null); }}
              className="mt-4 rounded-xl bg-primary px-4 py-2.5 text-[12.5px] font-extrabold text-white"
            >
              Limpar filtros
            </button>
          )}
        </div>
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
                <Link href={`/${highlight.slug}`} className="block">
                  <div className="relative h-[200px] overflow-hidden bg-brand-gradient p-5 text-white">
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

          {/* faixa Produza seu evento — arte trocável no admin (desktop|mobile) */}
          <PromoBanner panelUrl={PANEL} desktopUrl={banners?.desktopUrl} mobileUrl={banners?.mobileUrl} />
        </>
      )}
    </main>
  );
}
