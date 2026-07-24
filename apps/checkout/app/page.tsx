"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { api, type EventListItem } from "../lib/api";
import { formatCents } from "../lib/format";
import { Icon, paths } from "../components/icons";

const CATEGORIES = ["Todos", "Shows", "Festas", "Esportes", "Teatro"];

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
  const [category, setCategory] = useState("Todos");

  useEffect(() => {
    api.listPublicEvents().then(setEvents).catch(() => setEvents([]));
  }, []);

  const filtered = useMemo(() => {
    if (!events) return [];
    const q = query.trim().toLowerCase();
    return q ? events.filter((e) => e.title.toLowerCase().includes(q)) : events;
  }, [events, query]);

  const highlight = filtered[0];
  const rest = filtered.slice(1);

  const PANEL = process.env.NEXT_PUBLIC_PANEL_URL ?? "http://localhost:3001";

  return (
    <main className="px-5 pb-10 pt-6 lg:mx-auto lg:max-w-6xl lg:px-6">
      {/* hero desktop */}
      {highlight && (
        <section className="mb-8 hidden lg:block">
          <Link href={`/evento/${highlight.slug}`}
            className="relative block overflow-hidden rounded-3xl bg-brand-gradient p-12 text-white">
            <div className="absolute -right-16 -top-16 h-72 w-72 rounded-full bg-accent/40 blur-3xl" />
            <span className="inline-flex items-center gap-1.5 rounded-full bg-black/25 px-3 py-1 text-[12px] font-bold backdrop-blur">
              <span className="h-1.5 w-1.5 animate-pulseDot rounded-full bg-emerald-400" />
              Em alta agora
            </span>
            <h2 className="mt-4 max-w-2xl text-[40px] font-extrabold leading-tight">{highlight.title}</h2>
            <p className="mt-2 text-[15px] font-semibold text-white/85">
              {highlight.venue ? `${highlight.venue.name} · ${highlight.venue.city}` : "Em breve"}
            </p>
            {highlight.fromPriceCents !== null && (
              <span className="mt-6 inline-block rounded-full bg-white px-6 py-3 text-[15px] font-extrabold text-ink">
                a partir de {formatCents(highlight.fromPriceCents)}
              </span>
            )}
          </Link>
        </section>
      )}

      {/* saudação + avatar (mobile) */}
      <header className="flex items-center justify-between lg:hidden">
        <div>
          <h1 className="text-[22px] font-extrabold">Olá! 👋</h1>
          <p className="mt-0.5 flex items-center gap-1 text-[13px] font-semibold text-primary">
            <Icon d={paths.pin} size={14} /> São Paulo, SP
          </p>
        </div>
        <Link
          href="/perfil"
          aria-label="Perfil"
          className="flex h-11 w-11 items-center justify-center rounded-full bg-gradient-to-br from-accent to-primary text-white"
        >
          <Icon d={paths.user} size={20} />
        </Link>
      </header>

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
      <div className="mt-4 flex gap-2 lg:hidden overflow-x-auto pb-1">
        {CATEGORIES.map((c) => (
          <button
            key={c}
            onClick={() => setCategory(c)}
            className={`shrink-0 rounded-full px-4 py-2 text-[12px] font-bold ${
              category === c
                ? "bg-ink text-white"
                : "border border-line-input bg-surface text-muted"
            }`}
          >
            {c}
          </button>
        ))}
      </div>

      {events === null ? (
        <p className="mt-10 text-center text-[13px] text-muted">Carregando eventos…</p>
      ) : filtered.length === 0 ? (
        <p className="mt-10 text-center text-[13px] text-muted">Nenhum evento encontrado.</p>
      ) : (
        <>
          {/* destaque "Em alta" (mobile) */}
          {highlight && (
            <section className="mt-6 lg:hidden">
              <h2 className="text-[15px] font-extrabold">Em alta</h2>
              <Link
                href={`/evento/${highlight.slug}`}
                className="relative mt-3 block h-[190px] overflow-hidden rounded-3xl bg-brand-gradient p-5 text-white"
              >
                <div className="absolute -right-10 -top-10 h-40 w-40 rounded-full bg-accent/40 blur-2xl" />
                <span className="inline-flex items-center gap-1.5 rounded-full bg-black/25 px-3 py-1 text-[11px] font-bold backdrop-blur">
                  <span className="h-1.5 w-1.5 animate-pulseDot rounded-full bg-emerald-400" />
                  Últimos ingressos
                </span>
                <h3 className="mt-3 max-w-[85%] text-[22px] font-extrabold leading-tight">
                  {highlight.title}
                </h3>
                <p className="mt-1 text-[12px] font-semibold text-white/85">
                  {highlight.venue ? `${highlight.venue.name} · ${highlight.venue.city}` : "Em breve"}
                </p>
                {highlight.fromPriceCents !== null && (
                  <span className="absolute bottom-5 left-5 rounded-full bg-white px-4 py-2 text-[13px] font-extrabold text-ink">
                    a partir de {formatCents(highlight.fromPriceCents!)}
                  </span>
                )}
              </Link>
            </section>
          )}

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
                        <DateBlock iso={event.startsAt} />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[14px] font-bold">{event.title}</p>
                          <p className="truncate text-[12px] font-medium text-muted">
                            {event.venue ? `${event.venue.name} · ${event.venue.city}` : "Local a definir"}
                          </p>
                        </div>
                        {min !== null && (
                          <span className="shrink-0 text-[13px] font-extrabold text-primary">
                            {formatCents(min)}
                          </span>
                        )}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}
          {/* grade desktop */}
          <section className="hidden lg:block">
            <h2 className="text-[20px] font-extrabold">Próximos eventos</h2>
            <div className="mt-4 grid grid-cols-3 gap-5">
              {filtered.map((event) => (
                <Link key={event.id} href={`/evento/${event.slug}`}
                  className="overflow-hidden rounded-2xl border border-line bg-surface transition-shadow hover:shadow-card">
                  <div className="h-36 bg-brand-gradient" />
                  <div className="p-4">
                    <p className="truncate text-[15px] font-extrabold">{event.title}</p>
                    <p className="mt-0.5 truncate text-[12px] font-medium text-muted">
                      {new Date(event.startsAt).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })}
                      {event.venue ? ` · ${event.venue.city}` : ""}
                    </p>
                    {event.fromPriceCents !== null && (
                      <p className="mt-2 text-[13px] font-extrabold text-primary">a partir de {formatCents(event.fromPriceCents)}</p>
                    )}
                  </div>
                </Link>
              ))}
            </div>
          </section>

          {/* faixa Produza seu evento (desktop) */}
          <section className="mt-10 hidden overflow-hidden rounded-3xl bg-gradient-to-br from-[#17131f] to-[#2b1157] p-10 text-white lg:block">
            <h2 className="text-[26px] font-extrabold">Produza seu evento com a BoraFest</h2>
            <p className="mt-1 max-w-xl text-[14px] font-semibold text-white/80">
              Publique em minutos, venda com Pix na tela e sem travar aguardando verificação.
            </p>
            <a href={`${PANEL}/cadastro`}
              className="mt-5 inline-block rounded-2xl bg-white px-6 py-3 text-[14px] font-extrabold text-ink">
              Criar conta de produtor
            </a>
          </section>
        </>
      )}
    </main>
  );
}
