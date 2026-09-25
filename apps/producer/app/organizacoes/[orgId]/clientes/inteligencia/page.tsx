"use client";

import { ClientesTabs } from "@/components/ClientesTabs";
import { useEffect, useMemo, useState } from "react";
import { GuardedPanelShell } from "@/components/PanelShell";
import { useAuth } from "@/lib/auth";
import {
  getCustomerIntelligence,
  type CustomerIntelligence,
  type CustomerIntelligenceResponse,
  type LoyaltyLevel,
} from "@/lib/customer-intelligence-api";

const LEVEL: Record<Exclude<LoyaltyLevel, null>, string> = {
  BRONZE: "Bronze",
  SILVER: "Prata",
  GOLD: "Ouro",
  PLATINUM: "Platina",
};

function money(cents: number) {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function date(value: string | null) {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" });
}

function pct(value: number) {
  return `${value.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
}

function CustomerCard({ customer }: { customer: CustomerIntelligence }) {
  return (
    <article className="rounded-3xl border border-line bg-surface p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="truncate text-[15px] font-black text-ink">{customer.name || customer.email}</p>
          <p className="mt-0.5 truncate text-[11.5px] font-semibold text-muted">{customer.email}</p>
          {customer.phone ? <p className="mt-0.5 text-[10.5px] font-semibold text-muted-2">{customer.phone}</p> : null}
        </div>
        <div className="text-right">
          <p className="text-[10px] font-extrabold uppercase tracking-[.05em] text-muted-2">LTV</p>
          <p className="mt-1 text-[22px] font-black tabular-nums text-ink">{money(customer.ltvCents)}</p>
          <p className="text-[10px] font-semibold text-muted">líquido à Casa {money(customer.netContributionCents)}</p>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div className="rounded-xl bg-bg/55 p-3"><p className="text-[9.5px] font-bold uppercase text-muted-2">Ingressos</p><p className="mt-1 text-[14px] font-black text-ink">{money(customer.ticketGrossCents)}</p></div>
        <div className="rounded-xl bg-bg/55 p-3"><p className="text-[9.5px] font-bold uppercase text-muted-2">VIP</p><p className="mt-1 text-[14px] font-black text-ink">{money(customer.vipGrossCents)}</p></div>
        <div className="rounded-xl bg-bg/55 p-3"><p className="text-[9.5px] font-bold uppercase text-muted-2">Eventos</p><p className="mt-1 text-[14px] font-black text-ink">{customer.eventsCount}</p></div>
        <div className="rounded-xl bg-bg/55 p-3"><p className="text-[9.5px] font-bold uppercase text-muted-2">Ticket médio</p><p className="mt-1 text-[14px] font-black text-ink">{money(customer.avgPurchaseCents)}</p></div>
      </div>

      <div className="mt-4 grid gap-2 text-[11px] font-semibold text-muted sm:grid-cols-2">
        <div className="flex justify-between gap-3"><span>Última compra</span><strong className="text-ink">{date(customer.lastPurchaseAt)}</strong></div>
        <div className="flex justify-between gap-3"><span>Sem comprar há</span><strong className={customer.daysSinceLastPurchase !== null && customer.daysSinceLastPurchase >= 30 ? "text-warning" : "text-ink"}>{customer.daysSinceLastPurchase === null ? "—" : `${customer.daysSinceLastPurchase}d`}</strong></div>
        <div className="flex justify-between gap-3"><span>Check-ins</span><strong className="text-ink">{customer.checkedInTickets}/{customer.ticketsCount}</strong></div>
        <div className="flex justify-between gap-3"><span>Reservas VIP pagas</span><strong className="text-ink">{customer.vipPurchases}</strong></div>
        {customer.primaryPromoterName ? <div className="flex justify-between gap-3"><span>Promoter principal</span><strong className="text-ink">{customer.primaryPromoterName}</strong></div> : null}
        {customer.promoterGrossCents > 0 ? <div className="flex justify-between gap-3"><span>Via promoter</span><strong className="text-ink">{money(customer.promoterGrossCents)} · {pct(customer.promoterSharePct)}</strong></div> : null}
        {customer.refundCents > 0 ? <div className="flex justify-between gap-3"><span>Devolvido</span><strong className="text-danger">{money(customer.refundCents)}</strong></div> : null}
        {customer.nextEventAt ? <div className="flex justify-between gap-3"><span>Próximo evento</span><strong className="text-success">{date(customer.nextEventAt)}</strong></div> : null}
      </div>

      {customer.loyalty.enabled ? (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-primary/10 bg-primary/[.04] p-3">
          <div>
            <p className="text-[9.5px] font-extrabold uppercase tracking-[.04em] text-primary">Fidelidade</p>
            <p className="mt-0.5 text-[11px] font-bold text-ink">{customer.loyalty.level ? LEVEL[customer.loyalty.level] : "Bronze"} · {customer.loyalty.points.toLocaleString("pt-BR")} pontos</p>
          </div>
          <p className="text-[10px] font-semibold text-muted">{customer.loyalty.rewardsRedeemed} recompensa(s) resgatada(s)</p>
        </div>
      ) : null}
    </article>
  );
}

export default function CustomerIntelligencePage({ params }: { params: { orgId: string } }) {
  const { token } = useAuth();
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [data, setData] = useState<CustomerIntelligenceResponse | null>(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(query.trim()), 300);
    return () => window.clearTimeout(id);
  }, [query]);

  useEffect(() => {
    if (!token) return;
    let active = true;
    setLoading(true);
    setError(null);
    setPage(1);
    getCustomerIntelligence(token, params.orgId, { q: debounced || undefined, page: 1, pageSize: 30 })
      .then((result) => { if (active) setData(result); })
      .catch((err) => { if (active) setError(err instanceof Error ? err.message : "Não foi possível carregar o LTV"); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [token, params.orgId, debounced]);

  async function loadMore() {
    if (!token || !data || loadingMore || data.customers.length >= data.total) return;
    const next = page + 1;
    setLoadingMore(true);
    try {
      const result = await getCustomerIntelligence(token, params.orgId, { q: debounced || undefined, page: next, pageSize: 30 });
      setData((current) => current ? { ...result, customers: [...current.customers, ...result.customers] } : result);
      setPage(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível carregar mais clientes");
    } finally {
      setLoadingMore(false);
    }
  }

  const shown = useMemo(() => data?.customers.length ?? 0, [data]);

  return (
    <GuardedPanelShell title="LTV de clientes" organizationId={params.orgId}>
      <main className="mx-auto max-w-7xl px-5 py-7 lg:px-8 lg:py-9">
        <ClientesTabs orgId={params.orgId} />
        <div>
          <p className="text-[11px] font-extrabold uppercase tracking-[.08em] text-primary">LTV de clientes</p>
          <h1 className="mt-1 text-[27px] font-black tracking-tight text-ink">Valor de cada cliente</h1>
          <p className="mt-2 max-w-3xl text-[13px] font-semibold leading-relaxed text-muted">LTV junta ingresso, VIP e devoluções. Contribuição líquida mostra o que ficou para a Casa depois das saídas ligadas à venda.</p>
        </div>

        {error ? <p className="mt-5 rounded-2xl border border-danger/25 bg-danger/5 p-4 text-[12px] font-bold text-danger">{error}</p> : null}
        {loading && !data ? <div className="mt-6 rounded-3xl border border-line bg-surface p-12 text-center text-[13px] font-semibold text-muted">Calculando valor por cliente…</div> : null}

        {data ? (
          <>
            <section className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
              {[
                ["Clientes", data.summary.totalCustomers.toLocaleString("pt-BR")],
                ["LTV acumulado", money(data.summary.totalLtvCents)],
                ["LTV médio", money(data.summary.avgLtvCents)],
                ["Compraram VIP", data.summary.vipCustomers.toLocaleString("pt-BR")],
                ["Fidelizados", data.summary.loyaltyMembers.toLocaleString("pt-BR")],
              ].map(([label, value]) => (
                <div key={String(label)} className="rounded-2xl border border-line bg-surface p-4"><p className="text-[10px] font-extrabold uppercase tracking-[.04em] text-muted-2">{label}</p><p className="mt-1.5 text-[20px] font-black text-ink">{value}</p></div>
              ))}
            </section>

            <section className="mt-5 rounded-3xl border border-line bg-surface p-4 lg:p-5">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar cliente por nome ou e-mail" className="h-11 w-full max-w-xl rounded-xl border border-line-input bg-bg px-4 text-[13px] font-semibold text-ink outline-none focus:border-primary" />
                <p className="text-[11px] font-bold text-muted">{loading ? "Atualizando…" : `${shown} de ${data.total.toLocaleString("pt-BR")}`}</p>
              </div>
            </section>

            {data.customers.length === 0 && !loading ? <div className="mt-5 rounded-3xl border border-line bg-surface p-12 text-center"><p className="font-extrabold text-ink">Nenhum cliente encontrado</p><p className="mt-1 text-[12px] font-semibold text-muted">O LTV aparece quando existe receita atribuível ao cliente ou histórico de fidelidade.</p></div> : null}

            {data.customers.length ? <section className="mt-5 grid gap-3 xl:grid-cols-2">{data.customers.map((customer) => <CustomerCard key={customer.email.toLowerCase()} customer={customer} />)}</section> : null}

            {data.customers.length < data.total ? <div className="mt-6 text-center"><button type="button" disabled={loadingMore} onClick={loadMore} className="h-11 rounded-xl border border-line-input bg-surface px-6 text-[12.5px] font-extrabold text-primary disabled:opacity-50">{loadingMore ? "Carregando…" : "Carregar mais"}</button></div> : null}
          </>
        ) : null}
      </main>
    </GuardedPanelShell>
  );
}
