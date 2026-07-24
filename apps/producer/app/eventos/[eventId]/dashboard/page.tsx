"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AuthGuard } from "@/components/AuthGuard";
import { Nav } from "@/components/Nav";
import { useAuth } from "@/lib/auth";
import { dashboardApi, type Dashboard } from "@/lib/api";

function formatCents(cents: number): string {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

const KPI_STYLES = [
  { bg: "bg-primary/10", fg: "text-primary" },
  { bg: "bg-pix/10", fg: "text-pix" },
  { bg: "bg-success/10", fg: "text-success" },
  { bg: "bg-warning/10", fg: "text-warning" },
];

function DashboardContent({ eventId }: { eventId: string }) {
  const { token } = useAuth();
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [loading, setLoading] = useState(true);

  // check-in ao vivo (polling 10s — §13 checkin-live)
  const [live, setLive] = useState<{ totalTickets: number; checkedIn: number; perMinute: number } | null>(null);

  useEffect(() => {
    if (!token) return;
    dashboardApi.get(token, eventId).then(setDashboard).finally(() => setLoading(false));
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
  }, [token, eventId]);

  if (loading || !dashboard) {
    return (
      <main>
        <Nav />
        <p className="mt-6 text-muted">Carregando...</p>
      </main>
    );
  }

  const approved = dashboard.orders.byStatus["FULFILLED"] ?? 0;
  const paid = dashboard.orders.byStatus["PAID"] ?? 0;
  const hasSales = dashboard.orders.total > 0;

  const kpis = [
    { label: "Valor vendido", value: formatCents(dashboard.revenueCents) },
    { label: "Ingressos emitidos", value: String(dashboard.tickets.total) },
    { label: "Vendas aprovadas", value: String(approved + paid), delta: approved + paid > 0 ? `+${approved + paid}` : undefined },
    { label: "Pedidos no total", value: String(dashboard.orders.total) },
  ];

  return (
    <main>
      <Nav />
      <div className="mt-6 flex items-center justify-between">
        <h1 className="text-[22px] font-extrabold">{dashboard.event.title} — Geral</h1>
        <Link href={`/eventos/${eventId}`} className="text-sm font-bold text-primary">Gerenciar evento →</Link>
      </div>

      {/* 4 KPIs do protótipo */}
      <div className="mt-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
        {kpis.map((kpi, i) => (
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
        ))}
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
                <span className="text-muted">{status}</span><span>{count}</span>
              </p>
            ))}
          </div>
        </section>
        <section className="rounded-2xl border border-line bg-surface p-5">
          <h2 className="text-[15px] font-extrabold">Ingressos por status</h2>
          <div className="mt-3 space-y-1.5">
            {Object.entries(dashboard.tickets.byStatus).map(([status, count]) => (
              <p key={status} className="flex justify-between text-[13px] font-semibold">
                <span className="text-muted">{status}</span><span>{count}</span>
              </p>
            ))}
          </div>
        </section>
      </div>
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
