"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/lib/auth";
import { useEventShell } from "@/lib/eventContext";
import { dashboardApi, type Dashboard } from "@/lib/api";

function formatDate(iso: string) {
  return new Date(iso).toLocaleString("pt-BR", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function money(cents: number) {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export default function EventPreviewPage({ params }: { params: { eventId: string } }) {
  const { token } = useAuth();
  const { event } = useEventShell();
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);

  useEffect(() => {
    if (!token) return;
    dashboardApi.get(token, params.eventId).then(setDashboard).catch(() => setDashboard(null));
  }, [token, params.eventId]);

  const publicLots = useMemo(() => {
    const now = Date.now();
    return (
      dashboard?.lots.filter(
        (lot) =>
          lot.status === "ACTIVE" &&
          !lot.pdvOnly &&
          !lot.promoterOnly &&
          (!lot.startsAt || new Date(lot.startsAt).getTime() <= now) &&
          (!lot.endsAt || new Date(lot.endsAt).getTime() > now),
      ) ?? []
    );
  }, [dashboard]);

  const promoterLots = useMemo(() => {
    const now = Date.now();
    return (
      dashboard?.lots.filter(
        (lot) =>
          lot.status === "ACTIVE" &&
          !lot.pdvOnly &&
          Boolean(lot.promoterOnly) &&
          (!lot.startsAt || new Date(lot.startsAt).getTime() <= now) &&
          (!lot.endsAt || new Date(lot.endsAt).getTime() > now),
      ) ?? []
    );
  }, [dashboard]);

  if (!event || !dashboard) {
    return <p className="mt-4 text-[13px] font-semibold text-muted">Carregando prévia…</p>;
  }

  const lineup = (event.lineup ?? "").split("\n").map((item) => item.trim()).filter(Boolean);
  const amenities = (event.amenities ?? "").split("\n").map((item) => item.trim()).filter(Boolean);

  return (
    <main className="pb-10">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-primary/20 bg-primary/5 p-4">
        <div>
          <p className="text-[11px] font-extrabold uppercase tracking-[.12em] text-primary">Prévia privada</p>
          <p className="mt-1 text-[13px] font-semibold text-ink-soft">
            Esta tela mostra como o conteúdo principal será percebido pelo comprador. Ela não publica o evento.
          </p>
        </div>
        <Link href={`/eventos/${params.eventId}`} className="btn-secondary px-4 py-2">
          Voltar ao evento
        </Link>
      </div>

      <section className="overflow-hidden rounded-[28px] border border-line bg-surface shadow-sm">
        <div className="grid lg:grid-cols-[360px_1fr]">
          <div className="flex min-h-[360px] items-center justify-center bg-ink/[0.04]">
            {dashboard.event.bannerUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- URL de upload dinâmica
              <img
                src={dashboard.event.bannerUrl}
                alt={event.title}
                className="max-h-[520px] w-full object-contain"
              />
            ) : (
              <div className="px-8 text-center">
                <p className="text-[15px] font-extrabold text-ink">Sem arte do evento</p>
                <p className="mt-1 text-[12.5px] font-semibold text-muted">
                  O comprador verá uma página muito mais forte quando houver banner/flyer.
                </p>
              </div>
            )}
          </div>

          <div className="p-6 lg:p-8">
            <div className="flex flex-wrap gap-2">
              <span className="rounded-full bg-primary/10 px-3 py-1 text-[11px] font-extrabold text-primary">
                {event.category ?? "Sem categoria"}
              </span>
              <span className="rounded-full bg-line px-3 py-1 text-[11px] font-extrabold text-muted">
                {dashboard.event.status === "PUBLISHED" ? "Publicado" : "Prévia"}
              </span>
            </div>

            <h1 className="mt-4 text-[30px] font-black leading-tight text-ink lg:text-[38px]">{event.title}</h1>

            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <div className="rounded-2xl border border-line bg-bg p-4">
                <p className="text-[11px] font-extrabold uppercase tracking-[.08em] text-muted-2">Quando</p>
                <p className="mt-1 text-[13px] font-extrabold text-ink">{formatDate(event.startsAt)}</p>
              </div>
              <div className="rounded-2xl border border-line bg-bg p-4">
                <p className="text-[11px] font-extrabold uppercase tracking-[.08em] text-muted-2">Onde</p>
                <p className="mt-1 text-[13px] font-extrabold text-ink">
                  {dashboard.event.venue
                    ? `${dashboard.event.venue.name} · ${dashboard.event.venue.city}/${dashboard.event.venue.state}`
                    : "Local ainda não informado"}
                </p>
              </div>
            </div>

            {event.description?.trim() ? (
              <div className="mt-6">
                <h2 className="text-[16px] font-extrabold text-ink">Sobre o evento</h2>
                <p className="mt-2 whitespace-pre-line text-[13px] font-medium leading-relaxed text-ink-soft">
                  {event.description}
                </p>
              </div>
            ) : null}

            {lineup.length > 0 ? (
              <div className="mt-6">
                <h2 className="text-[16px] font-extrabold text-ink">Atrações</h2>
                <div className="mt-2 flex flex-wrap gap-2">
                  {lineup.map((item) => (
                    <span key={item} className="rounded-full border border-line bg-bg px-3 py-1.5 text-[12px] font-bold text-ink">
                      {item}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}

            {amenities.length > 0 ? (
              <div className="mt-6">
                <h2 className="text-[16px] font-extrabold text-ink">O que está incluso</h2>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  {amenities.map((item) => (
                    <div key={item} className="rounded-xl border border-line bg-bg px-3 py-2 text-[12px] font-semibold text-ink-soft">
                      ✓ {item}
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="mt-7">
              <h2 className="text-[16px] font-extrabold text-ink">Ingressos públicos agora</h2>
              {publicLots.length > 0 ? (
                <div className="mt-3 space-y-2">
                  {publicLots.map((lot) => (
                    <div key={lot.id} className="flex items-center justify-between gap-3 rounded-2xl border border-line bg-bg p-4">
                      <div>
                        <p className="text-[13px] font-extrabold text-ink">{lot.typeName} · {lot.name}</p>
                        <p className="mt-0.5 text-[11.5px] font-semibold text-muted">{lot.available} disponíveis</p>
                      </div>
                      <p className="text-[14px] font-black text-ink">{money(lot.priceCents + (lot.feeMode !== "PRODUCER" ? lot.feeCents : 0))}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="mt-3 rounded-2xl border border-warning/30 bg-warning/5 p-4">
                  <p className="text-[13px] font-extrabold text-ink">Nenhum lote online ativo</p>
                  <p className="mt-1 text-[12px] font-semibold text-muted">
                    Não há lote online público dentro da janela de venda neste momento. Lotes de PDV e promoter ficam fora desta lista.
                  </p>
                </div>
              )}
            </div>

            {promoterLots.length > 0 ? (
              <div className="mt-6 rounded-2xl border border-primary/20 bg-primary/5 p-4">
                <h2 className="text-[14px] font-extrabold text-ink">Exclusivos por promoter</h2>
                <p className="mt-1 text-[11.5px] font-semibold text-muted">
                  Estes lotes só aparecem para quem entra por um link válido de promoter ou vendedor.
                </p>
                <div className="mt-3 space-y-2">
                  {promoterLots.map((lot) => (
                    <div key={lot.id} className="flex items-center justify-between gap-3 rounded-xl border border-line bg-surface p-3">
                      <div>
                        <p className="text-[12.5px] font-extrabold text-ink">{lot.typeName} · {lot.name}</p>
                        <p className="mt-0.5 text-[11px] font-semibold text-muted">{lot.available} disponíveis</p>
                      </div>
                      <p className="text-[13px] font-black text-ink">
                        {money(lot.priceCents + (lot.feeMode !== "PRODUCER" ? lot.feeCents : 0))}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </section>
    </main>
  );
}
