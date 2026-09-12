"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { GuardedPanelShell } from "@/components/PanelShell";
import { useAuth } from "@/lib/auth";
import {
  getRetentionIntelligence,
  type RetentionIntelligenceResponse,
} from "@/lib/retention-intelligence-api";

function money(cents: number) {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function pct(value: number) {
  return `${value.toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: 1 })}%`;
}

function monthLabel(value: string) {
  return new Date(value).toLocaleDateString("pt-BR", { month: "short", year: "2-digit" }).replace(" de ", "/");
}

function dateLabel(value: string) {
  return new Date(value).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" });
}

function MetricCard({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <article className="rounded-2xl border border-line bg-surface p-4">
      <p className="text-[10.5px] font-extrabold uppercase tracking-[.04em] text-muted-2">{label}</p>
      <p className="mt-1.5 text-[24px] font-black tracking-tight text-ink">{value}</p>
      <p className="mt-1 text-[10.5px] font-semibold leading-relaxed text-muted">{hint}</p>
    </article>
  );
}

export default function RetentionPage({ params }: { params: { orgId: string } }) {
  const { token } = useAuth();
  const [data, setData] = useState<RetentionIntelligenceResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    let active = true;
    setLoading(true);
    setError(null);
    getRetentionIntelligence(token, params.orgId)
      .then((result) => {
        if (active) setData(result);
      })
      .catch((err) => {
        if (active) setError(err instanceof Error ? err.message : "Não foi possível carregar retenção");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [token, params.orgId]);

  const maxTrendCustomers = useMemo(
    () => Math.max(1, ...(data?.trend.map((item) => item.uniqueCustomers) ?? [1])),
    [data],
  );

  return (
    <GuardedPanelShell title="Retenção" organizationId={params.orgId}>
      <main className="mx-auto max-w-7xl px-5 py-7 lg:px-8 lg:py-9">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-[11px] font-extrabold uppercase tracking-[.08em] text-primary">N6 · inteligência</p>
            <h1 className="mt-1 text-[27px] font-black tracking-tight text-ink">Retenção da Casa</h1>
            <p className="mt-2 max-w-3xl text-[13px] font-semibold leading-relaxed text-muted">
              Veja se a Casa está construindo público recorrente — e não apenas vendendo cada evento do zero.
            </p>
          </div>
          <Link
            href={`/organizacoes/${params.orgId}/clientes`}
            className="inline-flex h-10 items-center justify-center rounded-xl border border-line-input bg-surface px-4 text-[12px] font-extrabold text-primary"
          >
            Ver base de clientes →
          </Link>
        </div>

        {error ? (
          <p className="mt-5 rounded-2xl border border-danger/25 bg-danger/5 p-4 text-[12px] font-bold text-danger">{error}</p>
        ) : null}

        {loading && !data ? (
          <div className="mt-6 rounded-3xl border border-line bg-surface p-12 text-center text-[13px] font-semibold text-muted">
            Calculando retenção e recorrência…
          </div>
        ) : null}

        {data ? (
          <>
            <section className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <MetricCard
                label="Taxa de retorno"
                value={pct(data.summary.repeatRatePct)}
                hint={`${data.summary.repeatCustomers.toLocaleString("pt-BR")} de ${data.summary.totalCustomers.toLocaleString("pt-BR")} clientes compraram em 2+ eventos.`}
              />
              <MetricCard
                label="Receita recorrente"
                value={pct(data.summary.repeatRevenueSharePct)}
                hint={`${money(data.summary.repeatRevenueCents)} vieram de clientes que já compraram mais de um evento.`}
              />
              <MetricCard
                label="Receita por cliente"
                value={money(data.summary.avgRevenuePerCustomerCents)}
                hint={`Média sobre ${data.summary.totalCustomers.toLocaleString("pt-BR")} clientes únicos pagos.`}
              />
              <MetricCard
                label="Origem promoter"
                value={pct(data.summary.promoterRevenueSharePct)}
                hint={`${money(data.summary.promoterRevenueCents)} da receita teve promoter atribuído.`}
              />
            </section>

            <section className="mt-3 grid gap-3 sm:grid-cols-3">
              <MetricCard
                label="Frequentes"
                value={data.summary.frequentCustomers.toLocaleString("pt-BR")}
                hint="Clientes que já compraram em 3 ou mais eventos da Casa."
              />
              <MetricCard
                label="Em risco · 30d"
                value={data.summary.lapsed30Customers.toLocaleString("pt-BR")}
                hint="Já vieram à Casa, não têm próxima compra e o último evento foi há mais de 30 dias."
              />
              <MetricCard
                label="No-show"
                value={data.summary.noShowCustomers.toLocaleString("pt-BR")}
                hint="Compraram evento passado, mas ainda não têm presença registrada em nenhum evento."
              />
            </section>

            <section className="mt-6 rounded-3xl border border-line bg-surface p-5 lg:p-6">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <p className="text-[11px] font-extrabold uppercase tracking-[.05em] text-muted-2">Últimos 6 meses</p>
                  <h2 className="mt-1 text-[18px] font-black text-ink">Novos x recorrentes</h2>
                </div>
                <p className="text-[11px] font-semibold text-muted">Por mês da compra paga</p>
              </div>

              <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {data.trend.map((item) => {
                  const total = Math.max(1, item.uniqueCustomers);
                  const returningShare = (item.returningCustomers / total) * 100;
                  const width = Math.max(4, Math.round((item.uniqueCustomers / maxTrendCustomers) * 100));
                  return (
                    <article key={item.month} className="rounded-2xl border border-line bg-bg/45 p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-[12px] font-extrabold text-ink">{monthLabel(item.month)}</p>
                          <p className="mt-1 text-[10.5px] font-semibold text-muted">{money(item.revenueCents)} em vendas</p>
                        </div>
                        <p className="text-[18px] font-black text-ink">{item.uniqueCustomers}</p>
                      </div>
                      <div className="mt-4 h-2 overflow-hidden rounded-full bg-line">
                        <div className="h-full rounded-full bg-primary" style={{ width: `${width}%` }} />
                      </div>
                      <div className="mt-3 grid grid-cols-2 gap-2 text-[10.5px] font-bold">
                        <div className="rounded-xl bg-surface p-2.5 text-muted">
                          <span className="block text-[14px] font-black text-ink">{item.newCustomers}</span>
                          novos
                        </div>
                        <div className="rounded-xl bg-surface p-2.5 text-muted">
                          <span className="block text-[14px] font-black text-success">{item.returningCustomers}</span>
                          recorrentes · {pct(returningShare)}
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>

            <section className="mt-6 overflow-hidden rounded-3xl border border-line bg-surface">
              <div className="border-b border-line px-5 py-5 lg:px-6">
                <p className="text-[11px] font-extrabold uppercase tracking-[.05em] text-muted-2">Eventos realizados</p>
                <h2 className="mt-1 text-[18px] font-black text-ink">Quais festas fazem o cliente voltar?</h2>
              </div>

              {data.events.length === 0 ? (
                <div className="p-10 text-center text-[12px] font-semibold text-muted">Ainda não há eventos passados com dados suficientes.</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[820px] text-left text-[12px]">
                    <thead>
                      <tr className="border-b border-line bg-bg/40 text-[10px] font-extrabold uppercase tracking-[.04em] text-muted-2">
                        <th className="px-5 py-3">Evento</th>
                        <th className="px-4 py-3 text-right">Compradores</th>
                        <th className="px-4 py-3 text-right">Novos</th>
                        <th className="px-4 py-3 text-right">Recorrentes</th>
                        <th className="px-4 py-3 text-right">Retorno</th>
                        <th className="px-4 py-3 text-right">Presença</th>
                        <th className="px-5 py-3 text-right">Receita</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.events.map((event) => (
                        <tr key={event.eventId} className="border-b border-line-divider last:border-0">
                          <td className="px-5 py-4">
                            <p className="font-extrabold text-ink">{event.title}</p>
                            <p className="mt-0.5 text-[10.5px] font-semibold text-muted">{dateLabel(event.startsAt)}</p>
                          </td>
                          <td className="px-4 py-4 text-right font-bold text-ink">{event.buyers}</td>
                          <td className="px-4 py-4 text-right font-bold text-muted">{event.newCustomers}</td>
                          <td className="px-4 py-4 text-right font-bold text-success">{event.returningCustomers}</td>
                          <td className="px-4 py-4 text-right font-extrabold text-primary">{pct(event.returnRatePct)}</td>
                          <td className="px-4 py-4 text-right font-bold text-ink">{pct(event.attendanceRatePct)}</td>
                          <td className="px-5 py-4 text-right font-extrabold text-ink">{money(event.revenueCents)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </>
        ) : null}
      </main>
    </GuardedPanelShell>
  );
}
