"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { GuardedPanelShell } from "@/components/PanelShell";
import { useAuth } from "@/lib/auth";
import {
  getCasaCustomers,
  type CrmCustomer,
  type CustomerCrmResponse,
  type CustomerSegment,
} from "@/lib/customer-crm-api";

const SEGMENTS: Array<{ value: CustomerSegment; label: string }> = [
  { value: "ALL", label: "Todos" },
  { value: "FIRST_TIME", label: "Primeira compra" },
  { value: "RECURRING", label: "Recorrentes" },
  { value: "FREQUENT", label: "Frequentes" },
  { value: "LAPSED_30", label: "Inativos 30d" },
  { value: "NO_SHOW", label: "No-show" },
  { value: "FOLLOWER", label: "Seguidores" },
  { value: "EMAIL_OPT_IN", label: "Aceitam ofertas por e-mail" },
];

const TAGS: Record<string, string> = {
  FIRST_TIME: "1ª compra",
  RECURRING: "Recorrente",
  FREQUENT: "Frequente",
  LAPSED_30: "Inativo 30d",
  NO_SHOW: "No-show",
  FOLLOWER: "Segue a Casa",
  EMAIL_OPT_IN: "Opt-in e-mail",
};

function money(cents: number) {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function date(value: string | null) {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" });
}

function CustomerCard({ customer }: { customer: CrmCustomer }) {
  return (
    <article className="rounded-2xl border border-line bg-surface p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-[14px] font-extrabold text-ink">{customer.name || customer.email}</p>
          <p className="mt-0.5 truncate text-[11.5px] font-semibold text-muted">{customer.email}</p>
          {customer.phone ? <p className="mt-0.5 text-[11px] font-semibold text-muted-2">{customer.phone}</p> : null}
        </div>
        <div className="text-right">
          <p className="text-[14px] font-black text-ink">{money(customer.spentCents)}</p>
          <p className="text-[10.5px] font-bold text-muted">gasto total</p>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-2 rounded-xl bg-bg/55 p-3 text-center">
        <div>
          <p className="text-[15px] font-black text-ink">{customer.eventsCount}</p>
          <p className="text-[9.5px] font-bold uppercase text-muted-2">eventos</p>
        </div>
        <div>
          <p className="text-[15px] font-black text-ink">{customer.paidOrders}</p>
          <p className="text-[9.5px] font-bold uppercase text-muted-2">pedidos</p>
        </div>
        <div>
          <p className="text-[15px] font-black text-ink">{customer.checkedInTickets}/{customer.ticketsCount}</p>
          <p className="text-[9.5px] font-bold uppercase text-muted-2">check-ins</p>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {customer.tags.map((tag) => (
          <span key={tag} className="rounded-full bg-primary/8 px-2.5 py-1 text-[10px] font-extrabold text-primary">
            {TAGS[tag] ?? tag}
          </span>
        ))}
      </div>

      <dl className="mt-4 grid gap-2 text-[11px] font-semibold text-muted">
        <div className="flex justify-between gap-3"><dt>Última compra</dt><dd className="font-bold text-ink">{date(customer.lastPurchaseAt)}</dd></div>
        <div className="flex justify-between gap-3"><dt>Último evento</dt><dd className="font-bold text-ink">{date(customer.lastEventAt)}</dd></div>
        {customer.nextEventAt ? <div className="flex justify-between gap-3"><dt>Próximo evento</dt><dd className="font-bold text-success">{date(customer.nextEventAt)}</dd></div> : null}
        {customer.lastPromoterName ? <div className="flex justify-between gap-3"><dt>Último promoter</dt><dd className="font-bold text-ink">{customer.lastPromoterName}</dd></div> : null}
      </dl>
    </article>
  );
}

export default function CasaCustomersPage({ params }: { params: { orgId: string } }) {
  const { token } = useAuth();
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [segment, setSegment] = useState<CustomerSegment>("ALL");
  const [data, setData] = useState<CustomerCrmResponse | null>(null);
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
    getCasaCustomers(token, params.orgId, { q: debouncedQuery || undefined, segment, page: 1, pageSize: 30 })
      .then((result) => {
        if (active) setData(result);
      })
      .catch((err) => {
        if (active) setError(err instanceof Error ? err.message : "Não foi possível carregar os clientes");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [token, params.orgId, debouncedQuery, segment]);

  async function loadMore() {
    if (!token || !data || loadingMore || data.customers.length >= data.total) return;
    const nextPage = page + 1;
    setLoadingMore(true);
    setError(null);
    try {
      const result = await getCasaCustomers(token, params.orgId, {
        q: debouncedQuery || undefined,
        segment,
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

  const totalLabel = useMemo(() => {
    if (!data) return "";
    return `${data.total.toLocaleString("pt-BR")} cliente${data.total === 1 ? "" : "s"}`;
  }, [data]);

  return (
    <GuardedPanelShell title="Clientes" organizationId={params.orgId}>
      <main className="mx-auto max-w-7xl px-5 py-7 lg:px-8 lg:py-9">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-[11px] font-extrabold uppercase tracking-[.08em] text-primary">N5 · relacionamento</p>
            <h1 className="mt-1 text-[27px] font-black tracking-tight text-ink">Clientes da Casa</h1>
            <p className="mt-2 max-w-3xl text-[13px] font-semibold leading-relaxed text-muted">
              Uma visão única de quem compra seus eventos, construída a partir de compras e presença. Esta tela não envia campanhas e não presume consentimento de marketing.
            </p>
          </div>
          <Link
            href={`/organizacoes/${params.orgId}/clientes/retencao`}
            className="inline-flex h-10 items-center justify-center rounded-xl border border-line-input bg-surface px-4 text-[12px] font-extrabold text-primary"
          >
            Ver retenção →
          </Link>
        </div>

        {data ? (
          <section className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
            {[
              ["Recorrentes", data.summary.recurring],
              ["Frequentes", data.summary.frequent],
              ["Inativos 30d", data.summary.lapsed30],
              ["No-show", data.summary.noShow],
              ["Seguidores", data.summary.followers],
              ["Opt-in e-mail", data.summary.emailOptIn],
            ].map(([label, value]) => (
              <div key={String(label)} className="rounded-2xl border border-line bg-surface p-4">
                <p className="text-[10.5px] font-extrabold uppercase tracking-[.04em] text-muted-2">{label}</p>
                <p className="mt-1.5 text-[22px] font-black text-ink">{Number(value).toLocaleString("pt-BR")}</p>
              </div>
            ))}
          </section>
        ) : null}

        <section className="mt-6 rounded-3xl border border-line bg-surface p-4 lg:p-5">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="relative w-full max-w-xl">
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Buscar por nome, e-mail ou telefone"
                className="h-11 w-full rounded-xl border border-line-input bg-bg px-4 text-[13px] font-semibold text-ink outline-none focus:border-primary"
              />
            </div>
            <p className="shrink-0 text-[11.5px] font-bold text-muted">{loading ? "Atualizando…" : totalLabel}</p>
          </div>

          <div className="mt-4 flex gap-2 overflow-x-auto pb-1 [&::-webkit-scrollbar]:hidden">
            {SEGMENTS.map((item) => (
              <button
                key={item.value}
                type="button"
                onClick={() => setSegment(item.value)}
                className={`shrink-0 rounded-full px-3.5 py-2 text-[11.5px] font-extrabold ${
                  segment === item.value ? "bg-primary text-white" : "border border-line bg-bg text-muted"
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
        </section>

        {error ? <p className="mt-4 rounded-2xl border border-danger/25 bg-danger/5 p-4 text-[12px] font-bold text-danger">{error}</p> : null}

        {loading && !data ? (
          <div className="mt-5 rounded-3xl border border-line bg-surface p-12 text-center text-[13px] font-semibold text-muted">Montando sua base de clientes…</div>
        ) : null}

        {!loading && data && data.customers.length === 0 ? (
          <div className="mt-5 rounded-3xl border border-line bg-surface p-12 text-center">
            <p className="text-[15px] font-extrabold text-ink">Nenhum cliente neste segmento</p>
            <p className="mt-1 text-[12px] font-semibold text-muted">A base é formada somente por pedidos pagos ou confirmados desta Casa.</p>
          </div>
        ) : null}

        {data && data.customers.length ? (
          <section className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {data.customers.map((customer) => <CustomerCard key={customer.email.toLowerCase()} customer={customer} />)}
          </section>
        ) : null}

        {data && data.customers.length < data.total ? (
          <div className="mt-6 text-center">
            <button
              type="button"
              onClick={loadMore}
              disabled={loadingMore}
              className="h-11 rounded-xl border border-line-input bg-surface px-6 text-[12.5px] font-extrabold text-primary disabled:opacity-50"
            >
              {loadingMore ? "Carregando…" : "Carregar mais"}
            </button>
          </div>
        ) : null}
      </main>
    </GuardedPanelShell>
  );
}
