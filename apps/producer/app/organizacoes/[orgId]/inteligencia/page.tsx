"use client";

import Link from "next/link";
import { ClientesTabs } from "@/components/ClientesTabs";
import { useEffect, useMemo, useState } from "react";
import { GuardedPanelShell } from "@/components/PanelShell";
import { useAuth } from "@/lib/auth";
import {
  getRevenueIntelligence,
  type RevenueIntelligenceResponse,
} from "@/lib/revenue-intelligence-api";

function money(cents: number) {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function pct(value: number) {
  return `${value.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
}

function monthLabel(value: string) {
  return new Date(value).toLocaleDateString("pt-BR", { month: "short", year: "2-digit", timeZone: "UTC" }).replace(".", "");
}

export default function RevenueIntelligencePage({ params }: { params: { orgId: string } }) {
  const { token } = useAuth();
  const [data, setData] = useState<RevenueIntelligenceResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    let active = true;
    setLoading(true);
    setError(null);
    getRevenueIntelligence(token, params.orgId)
      .then((result) => {
        if (active) setData(result);
      })
      .catch((err) => {
        if (active) setError(err instanceof Error ? err.message : "Não foi possível carregar a inteligência");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [token, params.orgId]);

  const maxMonthlyGross = useMemo(() => {
    if (!data?.trend.length) return 1;
    return Math.max(...data.trend.map((item) => item.ticketGrossCents + item.vipGrossCents), 1);
  }, [data]);

  return (
    <GuardedPanelShell title="Inteligência" organizationId={params.orgId}>
      <main className="mx-auto max-w-7xl px-5 py-7 lg:px-8 lg:py-9">
        <ClientesTabs orgId={params.orgId} />
        <div>
          <p className="text-[11px] font-extrabold uppercase tracking-[.08em] text-primary">Inteligência</p>
          <h1 className="mt-1 text-[27px] font-black tracking-tight text-ink">Inteligência da Casa</h1>
          <p className="mt-2 max-w-3xl text-[13px] font-semibold leading-relaxed text-muted">
            Ingressos, proteção, VIP, promoters, estornos, taxas e líquido na mesma leitura. Os valores vêm do ledger; esta tela não cria uma segunda contabilidade.
            {" "}
            <Link href={`/organizacoes/${params.orgId}/financeiro`} className="font-extrabold text-primary underline underline-offset-2">Ver o financeiro</Link>
          </p>
        </div>

        {error ? <p className="mt-5 rounded-2xl border border-danger/25 bg-danger/5 p-4 text-[12px] font-bold text-danger">{error}</p> : null}
        {loading && !data ? <div className="mt-6 rounded-3xl border border-line bg-surface p-12 text-center text-[13px] font-semibold text-muted">Consolidando receita…</div> : null}

        {data ? (
          <>
            <section className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <div className="rounded-3xl bg-brand-gradient p-5 text-white sm:col-span-2 xl:col-span-1">
                <p className="text-[10.5px] font-extrabold uppercase tracking-[.06em] text-white/75">Receita bruta</p>
                <p className="mt-2 text-[28px] font-black tabular-nums">{money(data.summary.grossCents)}</p>
                <p className="mt-1 text-[11px] font-semibold text-white/70">Ingressos + proteção + VIP antes das saídas.</p>
              </div>
              <div className="rounded-3xl border border-line bg-surface p-5">
                <p className="text-[10.5px] font-extrabold uppercase tracking-[.06em] text-muted-2">Líquido operacional</p>
                <p className="mt-2 text-[26px] font-black tabular-nums text-ink">{money(data.summary.netCents)}</p>
                <p className="mt-1 text-[11px] font-semibold text-muted">Depois de taxas, comissões e estornos ligados às vendas.</p>
              </div>
              <div className="rounded-3xl border border-line bg-surface p-5">
                <p className="text-[10.5px] font-extrabold uppercase tracking-[.06em] text-muted-2">VIP</p>
                <p className="mt-2 text-[26px] font-black tabular-nums text-ink">{money(data.summary.vipGrossCents)}</p>
                <p className="mt-1 text-[11px] font-semibold text-muted">{pct(data.summary.vipRevenueSharePct)} da receita bruta.</p>
              </div>
              <div className="rounded-3xl border border-line bg-surface p-5">
                <p className="text-[10.5px] font-extrabold uppercase tracking-[.06em] text-muted-2">Via promoters</p>
                <p className="mt-2 text-[26px] font-black tabular-nums text-ink">{money(data.summary.promoterGrossCents)}</p>
                <p className="mt-1 text-[11px] font-semibold text-muted">{pct(data.summary.promoterRevenueSharePct)} da receita de ingressos.</p>
              </div>
            </section>

            <section className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {[
                ["Ingressos + proteção", data.summary.ticketGrossCents],
                ["Estornos", data.summary.refundCents],
                ["Taxas BoraFest", data.summary.platformFeeCents],
                ["Comissões", data.summary.commissionCents],
              ].map(([label, value]) => (
                <div key={String(label)} className="rounded-2xl border border-line bg-surface p-4">
                  <p className="text-[10px] font-extrabold uppercase tracking-[.04em] text-muted-2">{label}</p>
                  <p className="mt-1.5 text-[19px] font-black tabular-nums text-ink">{money(Number(value))}</p>
                </div>
              ))}
            </section>

            <section className="mt-6 grid gap-5 xl:grid-cols-[1fr_1.35fr]">
              <div className="rounded-3xl border border-line bg-surface p-5">
                <div className="flex items-end justify-between gap-3">
                  <div><p className="text-[10.5px] font-extrabold uppercase tracking-[.06em] text-primary">6 meses</p><h2 className="mt-1 text-[17px] font-black text-ink">Evolução da receita</h2></div>
                  <p className="text-[10.5px] font-semibold text-muted">bruto × líquido</p>
                </div>
                <div className="mt-5 space-y-4">
                  {data.trend.map((item) => {
                    const gross = item.ticketGrossCents + item.vipGrossCents;
                    const width = Math.max(2, Math.round((gross / maxMonthlyGross) * 100));
                    return (
                      <div key={item.month}>
                        <div className="flex items-center justify-between gap-3 text-[11px] font-bold"><span className="uppercase text-muted">{monthLabel(item.month)}</span><span className="text-ink">{money(gross)}</span></div>
                        <div className="mt-1.5 h-2.5 overflow-hidden rounded-full bg-bg"><div className="h-full rounded-full bg-primary" style={{ width: `${width}%` }} /></div>
                        <div className="mt-1 flex justify-between text-[10px] font-semibold text-muted-2"><span>líquido {money(item.netCents)}</span>{item.vipGrossCents > 0 ? <span>VIP {money(item.vipGrossCents)}</span> : null}</div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="rounded-3xl border border-line bg-surface p-5">
                <div className="flex items-end justify-between gap-3"><div><p className="text-[10.5px] font-extrabold uppercase tracking-[.06em] text-primary">Por evento</p><h2 className="mt-1 text-[17px] font-black text-ink">Onde o dinheiro está vindo</h2></div><span className="text-[10.5px] font-semibold text-muted">até 20 eventos</span></div>
                {data.events.length === 0 ? <p className="mt-6 text-[12px] font-semibold text-muted">Ainda não há receita registrada.</p> : (
                  <div className="mt-4 overflow-x-auto">
                    <table className="w-full min-w-[720px] text-left text-[11px]">
                      <thead className="text-[9.5px] font-extrabold uppercase tracking-[.04em] text-muted-2"><tr><th className="pb-3">Evento</th><th className="pb-3 text-right">Bruto</th><th className="pb-3 text-right">VIP</th><th className="pb-3 text-right">Promoter</th><th className="pb-3 text-right">Estornos</th><th className="pb-3 text-right">Líquido</th></tr></thead>
                      <tbody className="divide-y divide-line">
                        {data.events.map((event) => (
                          <tr key={event.eventId}>
                            <td className="py-3 pr-4"><Link href={`/eventos/${event.eventId}/dashboard`} className="font-extrabold text-ink hover:text-primary">{event.title}</Link><p className="mt-0.5 text-[10px] font-semibold text-muted">{new Date(event.startsAt).toLocaleDateString("pt-BR")}</p></td>
                            <td className="py-3 text-right font-bold text-ink">{money(event.grossCents)}</td>
                            <td className="py-3 text-right font-semibold text-muted">{money(event.vipGrossCents)}</td>
                            <td className="py-3 text-right font-semibold text-muted">{money(event.promoterGrossCents)}</td>
                            <td className="py-3 text-right font-semibold text-danger">{money(event.refundCents)}</td>
                            <td className="py-3 text-right font-black text-ink">{money(event.netCents)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </section>
          </>
        ) : null}
      </main>
    </GuardedPanelShell>
  );
}
