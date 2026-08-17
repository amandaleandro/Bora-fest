"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AuthGuard } from "@/components/AuthGuard";
import { useAuth } from "@/lib/auth";
import { CHECKOUT_URL } from "@/lib/config";
import { useEventShell } from "@/lib/eventContext";
import { dashboardApi, type Dashboard } from "@/lib/api";

function formatCents(cents: number): string {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

/** "R$ 96,1 mil" — valor grande não quebra linha no celular. */
function brlCompact(cents: number): string {
  const v = cents / 100;
  if (v >= 1_000_000) return `R$ ${(v / 1_000_000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mi`;
  if (v >= 10_000) return `R$ ${(v / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mil`;
  return formatCents(cents);
}

const STATUS_CHIP: Record<string, { bg: string; fg: string; label: string }> = {
  PUBLISHED: { bg: "bg-success/10", fg: "text-success", label: "Publicado" },
  DRAFT: { bg: "bg-warning/10", fg: "text-warning", label: "Rascunho" },
  SALES_PAUSED: { bg: "bg-warning/10", fg: "text-warning", label: "Pausado" },
  UNPUBLISHED: { bg: "bg-line", fg: "text-muted", label: "Despublicado" },
};

/** Enums do banco viravam texto cru na tela (FULFILLED, CHECKED_IN…). */
const ORDER_STATUS_PT: Record<string, string> = {
  PENDING: "Aguardando pagamento",
  PAID: "Pago",
  FULFILLED: "Concluído",
  EXPIRED: "Expirado",
  CANCELLED: "Cancelado",
  CANCELED: "Cancelado",
  REFUNDED: "Reembolsado",
  REFUND_PENDING: "Reembolso em análise",
};
const TICKET_STATUS_PT: Record<string, string> = {
  ISSUED: "Emitido",
  CHECKED_IN: "Check-in feito",
  TRANSFERRED: "Transferido",
  REFUNDED: "Reembolsado",
  VOID: "Cancelado",
  CANCELLED: "Cancelado",
  CANCELED: "Cancelado",
};

const KPI_STYLES = [
  { bg: "bg-primary/10", fg: "text-primary" },
  { bg: "bg-pix/10", fg: "text-pix" },
  { bg: "bg-success/10", fg: "text-success" },
  { bg: "bg-warning/10", fg: "text-warning" },
];

function DashboardContent({ eventId }: { eventId: string }) {
  const { token } = useAuth();
  const { event } = useEventShell();
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  // check-in ao vivo (polling 10s — §13 checkin-live)
  const [live, setLive] = useState<{ totalTickets: number; checkedIn: number; perMinute: number } | null>(null);

  useEffect(() => {
    if (!token) return;
    setLoading(true);
    setError(null);
    dashboardApi
      .get(token, eventId)
      .then(setDashboard)
      .catch((err) => setError(err instanceof Error ? err.message : "Não foi possível carregar o dashboard"))
      .finally(() => setLoading(false));
    const fetchLive = () =>
      fetch(`${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3333"}/v1/events/${eventId}/checkin-live`, {
        headers: { Authorization: `Bearer ${token}` },
      })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => d && setLive(d))
        .catch(() => {});
    fetchLive();
    const id = setInterval(fetchLive, 10_000);
    return () => clearInterval(id);
  }, [token, eventId, attempt]);

  if (error) {
    return (
      <main>
        <div className="mt-6 rounded-2xl border border-danger/30 bg-danger/5 p-6 text-center">
          <p className="text-[13px] font-bold text-danger">{error}</p>
          <button
            onClick={() => setAttempt((a) => a + 1)}
            className="mt-3 h-10 rounded-xl bg-primary px-5 text-[13px] font-extrabold text-white shadow-cta"
          >
            Tentar novamente
          </button>
        </div>
      </main>
    );
  }

  if (loading || !dashboard) {
    return (
      <main>
          <p className="mt-6 text-muted">Carregando...</p>
      </main>
    );
  }

  const approved = dashboard.orders.byStatus["FULFILLED"] ?? 0;
  const paid = dashboard.orders.byStatus["PAID"] ?? 0;
  const hasSales = dashboard.orders.total > 0;

  const kpis = [
    { label: "Valor vendido", value: brlCompact(dashboard.revenueCents) },
    { label: "Ingressos emitidos", value: String(dashboard.tickets.total) },
    { label: "Vendas aprovadas", value: String(approved + paid), delta: approved + paid > 0 ? `+${approved + paid}` : undefined },
    { label: "Pedidos no total", value: String(dashboard.orders.total) },
  ];

  const slug = (dashboard.event as { slug?: string }).slug ?? event?.slug ?? "";
  const chip = event ? (STATUS_CHIP[event.status] ?? { bg: "bg-line", fg: "text-muted", label: event.status }) : null;

  return (
    <main>
      {/* cartão de identidade do evento — mesmo padrão do Resumo */}
      <div className="mt-1 flex items-center gap-3.5 rounded-[20px] border border-line bg-surface p-4 lg:mt-6">
        {event?.startsAt ? (
          <span className="flex h-[52px] w-[52px] shrink-0 flex-col items-center justify-center rounded-xl bg-brand-gradient text-white">
            <span className="text-[15px] font-extrabold leading-none">
              {new Date(event.startsAt).toLocaleDateString("pt-BR", { day: "2-digit" })}
            </span>
            <span className="text-[9px] font-bold uppercase">
              {new Date(event.startsAt).toLocaleDateString("pt-BR", { month: "short" }).replace(".", "")}
            </span>
          </span>
        ) : (
          <span className="h-[52px] w-[52px] shrink-0 rounded-xl bg-brand-gradient" />
        )}
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-[17px] font-extrabold leading-tight">{dashboard.event.title}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            {chip && (
              <span className={`rounded-full px-2 py-0.5 text-[10.5px] font-bold ${chip.bg} ${chip.fg}`}>{chip.label}</span>
            )}
            {slug && (
              <a
                href={`${CHECKOUT_URL}/evento/${slug}`}
                target="_blank"
                rel="noopener"
                className="text-[12px] font-extrabold text-primary"
              >
                Ver no site ↗
              </a>
            )}
            <Link href={`/eventos/${eventId}/editar`} className="text-[12px] font-extrabold text-primary">
              Editar dados ✎
            </Link>
          </div>
        </div>
        <Link href={`/eventos/${eventId}`} className="hidden shrink-0 text-sm font-bold text-primary lg:inline">
          Gerenciar evento →
        </Link>
      </div>

      {/* 4 KPIs — receita em destaque no gradiente da marca */}
      <div className="mt-4 grid grid-cols-2 gap-3 lg:mt-5 lg:grid-cols-4 lg:gap-4">
        {kpis.map((kpi, i) =>
          i === 0 ? (
            <div key={kpi.label} className="rounded-2xl bg-brand-gradient p-4 text-white">
              <p className="text-[10.5px] font-extrabold uppercase tracking-[.06em] text-white/80">{kpi.label}</p>
              <p className="mt-1 truncate text-[22px] font-extrabold">{kpi.value}</p>
            </div>
          ) : (
            <div key={kpi.label} className="rounded-2xl border border-line bg-surface p-4">
              <div className={`mb-2 flex h-9 w-9 items-center justify-center rounded-xl text-[15px] font-extrabold ${KPI_STYLES[i].bg} ${KPI_STYLES[i].fg}`}>
                {["R$", "🎟", "✓", "Σ"][i]}
              </div>
              <p className="text-[12px] font-bold text-muted">{kpi.label}</p>
              <p className="mt-0.5 text-[22px] font-extrabold">
                {kpi.value}
                {kpi.delta && <span className="ml-2 text-[12px] font-bold text-success">{kpi.delta}</span>}
              </p>
            </div>
          ),
        )}
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        {/* vendas por lote (barras) ou estado vazio */}
        <section className="rounded-2xl border border-line bg-surface p-5">
          <h2 className="text-[15px] font-extrabold">Vendas por lote</h2>
          {!hasSales ? (
            <div className="mt-6 rounded-xl bg-bg p-6 text-center text-[13px] font-semibold text-muted">
              Nenhuma venda ainda — compartilhe o link do hotsite na seção Publicação.
            </div>
          ) : (
            <div className="mt-4 space-y-3">
              {dashboard.lots.map((lot) => {
                const pct = lot.capacity ? Math.round((lot.sold / lot.capacity) * 100) : 0;
                return (
                  <div key={lot.id}>
                    <div className="flex justify-between text-[12px] font-bold">
                      <span>{lot.typeName} — {lot.name}</span>
                      <span className="text-muted">{lot.sold} de {lot.capacity}</span>
                    </div>
                    <div className="mt-1 h-2.5 rounded-full bg-line">
                      <div className="h-2.5 rounded-full bg-primary" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* check-in ao vivo */}
        <section className="rounded-2xl border border-line bg-surface p-5">
          <h2 className="flex items-center gap-2 text-[15px] font-extrabold">
            <span className="h-2 w-2 animate-pulse rounded-full bg-success" />
            Check-in ao vivo
          </h2>
          {live ? (
            <>
              <p className="mt-4 text-[28px] font-extrabold">
                {live.checkedIn}
                <span className="text-[15px] font-bold text-muted">/{live.totalTickets} presentes</span>
              </p>
              <div className="mt-2 h-2.5 rounded-full bg-line">
                <div
                  className="h-2.5 rounded-full bg-success"
                  style={{ width: `${live.totalTickets ? Math.round((live.checkedIn / live.totalTickets) * 100) : 0}%` }}
                />
              </div>
              <p className="mt-2 text-[12px] font-bold text-muted">+{live.perMinute} no último minuto</p>
            </>
          ) : (
            <p className="mt-4 text-[13px] font-semibold text-muted">Sem dados de portaria ainda.</p>
          )}
        </section>
      </div>

      {/* pedidos/ingressos por status */}
      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <section className="rounded-2xl border border-line bg-surface p-5">
          <h2 className="text-[15px] font-extrabold">Pedidos por status</h2>
          <div className="mt-3 space-y-1.5">
            {Object.entries(dashboard.orders.byStatus).map(([status, count]) => (
              <p key={status} className="flex justify-between text-[13px] font-semibold">
                <span className="text-muted">{ORDER_STATUS_PT[status] ?? status}</span><span>{count}</span>
              </p>
            ))}
          </div>
        </section>
        <section className="rounded-2xl border border-line bg-surface p-5">
          <h2 className="text-[15px] font-extrabold">Ingressos por status</h2>
          <div className="mt-3 space-y-1.5">
            {Object.entries(dashboard.tickets.byStatus).map(([status, count]) => (
              <p key={status} className="flex justify-between text-[13px] font-semibold">
                <span className="text-muted">{TICKET_STATUS_PT[status] ?? status}</span><span>{count}</span>
              </p>
            ))}
          </div>
        </section>
      </div>

      {/* avaliação pós-evento */}
      {dashboard.reviews.count > 0 ? (
        <section className="mt-5 rounded-2xl border border-line bg-surface p-5">
          <h2 className="text-[15px] font-extrabold">Avaliação do evento</h2>
          <p className="mt-2 text-[28px] font-extrabold">
            {dashboard.reviews.average?.toFixed(1)}
            <span className="text-[15px] font-bold text-muted"> / 5 · {dashboard.reviews.count} avaliações</span>
          </p>
        </section>
      ) : null}
    </main>
  );
}

export default function DashboardPage({ params }: { params: { eventId: string } }) {
  return (
    <AuthGuard>
      <DashboardContent eventId={params.eventId} />
    </AuthGuard>
  );
}
