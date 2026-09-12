"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth";
import { useEventShell } from "@/lib/eventContext";
import {
  getPromoterPerformance,
  type PromoterPerformanceResponse,
} from "@/lib/promoter-performance-api";

function money(cents: number) {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export default function PromotersPerformancePage() {
  const { token } = useAuth();
  const { event, organization, loading: contextLoading } = useEventShell();
  const [data, setData] = useState<PromoterPerformanceResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token || !event || !organization) return;
    let active = true;
    setLoading(true);
    setError(null);
    getPromoterPerformance(token, organization.id, event.id)
      .then((result) => {
        if (active) setData(result);
      })
      .catch((err) => {
        if (active) setError(err instanceof Error ? err.message : "Não foi possível carregar");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [token, event, organization]);

  if (contextLoading || !event || !organization) {
    return <p className="p-6 text-[13px] font-semibold text-muted">Carregando evento…</p>;
  }

  return (
    <main className="mx-auto max-w-7xl px-5 py-7 lg:px-8 lg:py-9">
      <div>
        <p className="text-[11px] font-extrabold uppercase tracking-[.08em] text-primary">N4 · operação de vendas</p>
        <h1 className="mt-1 text-[27px] font-black tracking-tight text-ink">Promoters</h1>
        <p className="mt-1.5 text-[13px] font-semibold text-muted">
          Desempenho de promoters em <strong className="text-ink">{event.title}</strong>. O histórico permanece mesmo depois de um vínculo ser removido.
        </p>
      </div>

      {error ? <p className="mt-6 rounded-2xl border border-danger/25 bg-danger/5 p-4 text-[12px] font-bold text-danger">{error}</p> : null}

      {loading && !data ? (
        <div className="mt-6 rounded-3xl border border-line bg-surface p-10 text-center text-[13px] font-semibold text-muted">Montando placar…</div>
      ) : null}

      {data ? (
        <>
          <section className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {[
              ["Ingressos", data.summary.ticketsSold.toLocaleString("pt-BR")],
              ["Faturamento", money(data.summary.grossCents)],
              ["Promoters ativos", data.summary.activePromoters.toLocaleString("pt-BR")],
              ["Comissões", money(data.summary.commissionCents)],
            ].map(([label, value]) => (
              <div key={label} className="rounded-2xl border border-line bg-surface p-4">
                <p className="text-[11px] font-extrabold uppercase tracking-[.05em] text-muted-2">{label}</p>
                <p className="mt-1.5 text-[24px] font-black tracking-tight text-ink">{value}</p>
              </div>
            ))}
          </section>

          <section className="mt-6 overflow-hidden rounded-3xl border border-line bg-surface">
            <div className="border-b border-line px-5 py-4">
              <h2 className="text-[15px] font-black text-ink">Ranking do evento</h2>
              <p className="mt-1 text-[11.5px] font-semibold text-muted">Ingressos vendidos; faturamento desempata.</p>
            </div>
            {data.promoters.length === 0 ? (
              <div className="px-5 py-10 text-center">
                <p className="text-[14px] font-extrabold text-ink">Nenhum promoter vinculado</p>
                <p className="mt-1 text-[12px] font-semibold text-muted">Convide a equipe na área da Casa para começar a medir este evento.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[820px] text-left text-[12px]">
                  <thead>
                    <tr className="border-b border-line bg-bg/55 text-[10.5px] font-extrabold uppercase tracking-[.04em] text-muted-2">
                      <th className="px-5 py-3">#</th>
                      <th className="px-4 py-3">Promoter</th>
                      <th className="px-4 py-3 text-right">Ingressos</th>
                      <th className="px-4 py-3 text-right">Direto</th>
                      <th className="px-4 py-3 text-right">Equipe</th>
                      <th className="px-4 py-3 text-right">Pedidos</th>
                      <th className="px-4 py-3 text-right">Faturamento</th>
                      <th className="px-5 py-3 text-right">Comissão</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.promoters.map((row) => (
                      <tr key={row.id} className="border-b border-line-divider last:border-0">
                        <td className="px-5 py-4 font-black text-primary">{row.rank ?? "—"}</td>
                        <td className="px-4 py-4">
                          <p className="font-extrabold text-ink">{row.promoterName}</p>
                          <p className="mt-1 text-[10.5px] font-bold text-muted">
                            {row.status === "INVITED"
                              ? "Aguardando aceite"
                              : row.status === "REMOVED"
                                ? "Removido · histórico preservado"
                                : row.scope === "HOUSE"
                                  ? "Toda a Casa"
                                  : "Só este evento"}
                          </p>
                        </td>
                        <td className="px-4 py-4 text-right font-black text-ink">{row.ticketsSold}</td>
                        <td className="px-4 py-4 text-right font-bold text-muted">{row.directTickets}</td>
                        <td className="px-4 py-4 text-right font-bold text-muted">{row.sellerTickets}</td>
                        <td className="px-4 py-4 text-right font-bold text-muted">{row.paidOrders}</td>
                        <td className="px-4 py-4 text-right font-extrabold text-ink">{money(row.grossCents)}</td>
                        <td className="px-5 py-4 text-right font-bold text-muted">{money(row.commissionCents)}</td>
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
  );
}
