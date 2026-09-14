"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { GuardedPanelShell } from "@/components/PanelShell";
import { useAuth } from "@/lib/auth";
import {
  getCustomerSegments,
  type CustomerFinancialSegment,
  type CustomerSegmentsResponse,
  type SegmentedCustomer,
} from "@/lib/customer-segments-api";

const SEGMENT_LABELS: Record<string, string> = {
  CHAMPION: "Campeão",
  HIGH_VALUE: "Alto valor",
  NEW_HIGH_VALUE: "Novo alto valor",
  LOYAL: "Fiel",
  AT_RISK: "Em risco",
  LOST_HIGH_VALUE: "Alto valor perdido",
  VIP_BUYER: "Comprador VIP",
  PROMOTER_DRIVEN: "Via promoter",
  LOYALTY_ENGAGED: "Fidelidade ativa",
};

function money(cents: number) {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function pct(value: number) {
  return `${value.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
}

function date(value: string | null) {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" });
}

function CustomerCard({ customer }: { customer: SegmentedCustomer }) {
  return (
    <article className="rounded-2xl border border-line bg-surface p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-[14px] font-extrabold text-ink">{customer.name || customer.email}</p>
          <p className="mt-0.5 truncate text-[11px] font-semibold text-muted">{customer.email}</p>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-[15px] font-black text-ink">{money(customer.ltvCents)}</p>
          <p className="text-[9.5px] font-extrabold uppercase text-muted-2">LTV</p>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {customer.segments.map((segment) => (
          <span key={segment} className="rounded-full bg-primary/8 px-2.5 py-1 text-[10px] font-extrabold text-primary">
            {SEGMENT_LABELS[segment] ?? segment}
          </span>
        ))}
      </div>

      <div className="mt-4 grid grid-cols-3 gap-2 rounded-xl bg-bg/55 p-3 text-center">
        <div>
          <p className="text-[14px] font-black text-ink">{customer.eventsCount}</p>
          <p className="text-[9px] font-bold uppercase text-muted-2">eventos</p>
        </div>
        <div>
          <p className="text-[14px] font-black text-ink">{customer.purchaseCount}</p>
          <p className="text-[9px] font-bold uppercase text-muted-2">compras</p>
        </div>
        <div>
          <p className="text-[14px] font-black text-ink">{pct(customer.attendanceRatePct)}</p>
          <p className="text-[9px] font-bold uppercase text-muted-2">presença</p>
        </div>
      </div>

      <dl className="mt-4 grid gap-2 text-[11px] font-semibold text-muted">
        <div className="flex justify-between gap-3"><dt>Contribuição líquida</dt><dd className="font-bold text-ink">{money(customer.netContributionCents)}</dd></div>
        {customer.vipGrossCents > 0 ? <div className="flex justify-between gap-3"><dt>Receita VIP</dt><dd className="font-bold text-ink">{money(customer.vipGrossCents)}</dd></div> : null}
        {customer.promoterGrossCents > 0 ? <div className="flex justify-between gap-3"><dt>Via promoter</dt><dd className="font-bold text-ink">{pct(customer.promoterSharePct)}{customer.primaryPromoterName ? ` · ${customer.primaryPromoterName}` : ""}</dd></div> : null}
        <div className="flex justify-between gap-3"><dt>Última compra</dt><dd className="font-bold text-ink">{date(customer.lastPurchaseAt)}</dd></div>
        {customer.daysSinceLastPurchase !== null ? <div className="flex justify-between gap-3"><dt>Sem comprar</dt><dd className="font-bold text-ink">{customer.daysSinceLastPurchase} dias</dd></div> : null}
        {customer.nextEventAt ? <div className="flex justify-between gap-3"><dt>Próximo evento</dt><dd className="font-bold text-success">{date(customer.nextEventAt)}</dd></div> : null}
        {customer.lifetimePoints > 0 || customer.rewardsRedeemed > 0 ? <div className="flex justify-between gap-3"><dt>Fidelidade</dt><dd className="font-bold text-ink">{customer.lifetimePoints.toLocaleString("pt-BR")} pts · {customer.rewardsRedeemed} resg.</dd></div> : null}
      </dl>
    </article>
  );
}

export default function CustomerSegmentsPage({ params }: { params: { orgId: string } }) {
  const { token } = useAuth();
  const [segment, setSegment] = useState<CustomerFinancialSegment>("ALL");
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [data, setData] = useState<CustomerSegmentsResponse | null>(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const id = window.setTimeout(() => setDebouncedQuery(query.trim()), 300);
    return () => window.clearTimeout(id);
  }, [query]);

  useEffect(() => {
    if (!token) return;
    let active = true;
    setLoading(true);
    setError(null);
    setPage(1);
    getCustomerSegments(token, params.orgId, {
      segment,
      q: debouncedQuery || undefined,
      page: 1,
      pageSize: 30,
    })
      .then((result) => { if (active) setData(result); })
      .catch((err) => { if (active) setError(err instanceof Error ? err.message : "Não foi possível carregar os segmentos"); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [token, params.orgId, segment, debouncedQuery]);

  async function loadMore() {
    if (!token || !data || loadingMore || data.customers.length >= data.total) return;
    const nextPage = page + 1;
    setLoadingMore(true);
    setError(null);
    try {
      const result = await getCustomerSegments(token, params.orgId, {
        segment,
        q: debouncedQuery || undefined,
        page: nextPage,
        pageSize: 30,
      });
      setData((current) => current ? { ...result, customers: [...current.customers, ...result.customers] } : result);
      setPage(nextPage);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível carregar mais clientes");
    } finally {
      setLoadingMore(false);
    }
  }

  const selectedLabel = useMemo(() => {
    if (segment === "ALL") return "Todos os clientes";
    return data?.segments.find((item) => item.key === segment)?.label ?? segment;
  }, [data, segment]);

  return (
    <GuardedPanelShell title="Segmentos" organizationId={params.orgId}>
      <main className="mx-auto max-w-7xl px-5 py-7 lg:px-8 lg:py-9">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-[11px] font-extrabold uppercase tracking-[.08em] text-primary">N10.3 · segmentos financeiros</p>
            <h1 className="mt-1 text-[27px] font-black tracking-tight text-ink">Segmentos da Casa</h1>
            <p className="mt-2 max-w-3xl text-[13px] font-semibold leading-relaxed text-muted">
              Grupos automáticos derivados de LTV, frequência, recência, VIP, promoter e fidelidade. Um cliente pode pertencer a vários segmentos ao mesmo tempo.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href={`/organizacoes/${params.orgId}/clientes/inteligencia`} className="rounded-xl border border-line-input bg-surface px-4 py-2.5 text-[12px] font-extrabold text-primary">LTV clientes</Link>
            <Link href={`/organizacoes/${params.orgId}/inteligencia`} className="rounded-xl bg-primary px-4 py-2.5 text-[12px] font-extrabold text-white shadow-cta">Inteligência →</Link>
          </div>
        </div>

        {error ? <p className="mt-5 rounded-2xl border border-danger/25 bg-danger/5 p-4 text-[12px] font-bold text-danger">{error}</p> : null}
        {loading && !data ? <div className="mt-6 rounded-3xl border border-line bg-surface p-12 text-center text-[13px] font-semibold text-muted">Classificando a base de clientes…</div> : null}

        {data ? (
          <>
            <section className="mt-6 rounded-3xl border border-line bg-surface p-4 lg:p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-[10px] font-extrabold uppercase tracking-[.05em] text-muted-2">Limiar dinâmico de alto valor</p>
                  <p className="mt-1 text-[18px] font-black text-ink">{money(data.thresholds.highValueLtvCents)}</p>
                  <p className="mt-1 text-[10.5px] font-semibold text-muted">Percentil {data.thresholds.highValuePercentile} do LTV positivo da própria Casa.</p>
                </div>
                <div className="w-full max-w-md">
                  <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar cliente por nome ou e-mail" className="h-11 w-full rounded-xl border border-line-input bg-bg px-4 text-[13px] font-semibold text-ink outline-none focus:border-primary" />
                </div>
              </div>
            </section>

            <section className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
              <button type="button" onClick={() => setSegment("ALL")} className={`rounded-2xl border p-4 text-left ${segment === "ALL" ? "border-primary bg-primary/5" : "border-line bg-surface"}`}>
                <p className="text-[10px] font-extrabold uppercase tracking-[.05em] text-muted-2">Todos</p>
                <p className="mt-1 text-[22px] font-black text-ink">{segment === "ALL" ? data.total : "Ver"}</p>
                <p className="mt-1 text-[10.5px] font-semibold text-muted">Base financeira completa.</p>
              </button>
              {data.segments.map((item) => (
                <button key={item.key} type="button" onClick={() => setSegment(item.key)} className={`rounded-2xl border p-4 text-left ${segment === item.key ? "border-primary bg-primary/5" : "border-line bg-surface"}`}>
                  <p className="text-[10px] font-extrabold uppercase tracking-[.05em] text-primary">{item.label}</p>
                  <p className="mt-1 text-[22px] font-black text-ink">{item.customers.toLocaleString("pt-BR")}</p>
                  <p className="mt-1 text-[10px] font-semibold leading-relaxed text-muted">{item.description}</p>
                  <p className="mt-2 text-[10px] font-bold text-muted-2">LTV médio {money(item.avgLtvCents)}</p>
                </button>
              ))}
            </section>

            <section className="mt-6">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <p className="text-[10.5px] font-extrabold uppercase tracking-[.05em] text-muted-2">{selectedLabel}</p>
                  <h2 className="mt-1 text-[18px] font-black text-ink">Clientes classificados</h2>
                </div>
                <p className="text-[11px] font-bold text-muted">{loading ? "Atualizando…" : `${data.total.toLocaleString("pt-BR")} cliente${data.total === 1 ? "" : "s"}`}</p>
              </div>

              {data.customers.length === 0 && !loading ? <div className="mt-4 rounded-3xl border border-line bg-surface p-10 text-center text-[12px] font-semibold text-muted">Nenhum cliente encontrado neste segmento.</div> : null}
              {data.customers.length > 0 ? <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">{data.customers.map((customer) => <CustomerCard key={customer.email.toLowerCase()} customer={customer} />)}</div> : null}

              {data.customers.length < data.total ? <div className="mt-6 text-center"><button type="button" onClick={loadMore} disabled={loadingMore} className="h-11 rounded-xl border border-line-input bg-surface px-6 text-[12.5px] font-extrabold text-primary disabled:opacity-50">{loadingMore ? "Carregando…" : "Carregar mais"}</button></div> : null}
            </section>
          </>
        ) : null}
      </main>
    </GuardedPanelShell>
  );
}
