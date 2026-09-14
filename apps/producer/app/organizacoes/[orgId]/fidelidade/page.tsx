"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { GuardedPanelShell } from "@/components/PanelShell";
import { useAuth } from "@/lib/auth";
import {
  getLoyaltyAccounts,
  getLoyaltyProgram,
  updateLoyaltyProgram,
  type LoyaltyAccount,
  type LoyaltyAccountsResponse,
  type LoyaltyProgram,
} from "@/lib/loyalty-api";

const LEVEL_LABEL: Record<LoyaltyAccount["level"], string> = {
  BRONZE: "Bronze",
  SILVER: "Prata",
  GOLD: "Ouro",
  PLATINUM: "Platina",
};

function date(value: string | null) {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" });
}

export default function LoyaltyPage({ params }: { params: { orgId: string } }) {
  const { token } = useAuth();
  const [program, setProgram] = useState<LoyaltyProgram | null>(null);
  const [data, setData] = useState<LoyaltyAccountsResponse | null>(null);
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

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
    Promise.all([
      getLoyaltyProgram(token, params.orgId),
      getLoyaltyAccounts(token, params.orgId, { q: debounced || undefined, page: 1, pageSize: 30 }),
    ])
      .then(([loadedProgram, accounts]) => {
        if (!active) return;
        setProgram(loadedProgram);
        setData(accounts);
      })
      .catch((err) => {
        if (active) setError(err instanceof Error ? err.message : "Não foi possível carregar a fidelidade");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [token, params.orgId, debounced]);

  async function saveProgram(event: FormEvent) {
    event.preventDefault();
    if (!token || !program) return;
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      const updated = await updateLoyaltyProgram(token, params.orgId, {
        enabled: program.enabled,
        pointsPerReal: program.pointsPerReal,
        silverPoints: program.silverPoints,
        goldPoints: program.goldPoints,
        platinumPoints: program.platinumPoints,
      });
      setProgram(updated);
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível salvar o programa");
    } finally {
      setSaving(false);
    }
  }

  async function loadMore() {
    if (!token || !data || loadingMore || data.accounts.length >= data.total) return;
    const nextPage = page + 1;
    setLoadingMore(true);
    try {
      const result = await getLoyaltyAccounts(token, params.orgId, {
        q: debounced || undefined,
        page: nextPage,
        pageSize: 30,
      });
      setData((current) => current ? { ...result, accounts: [...current.accounts, ...result.accounts] } : result);
      setPage(nextPage);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível carregar mais clientes");
    } finally {
      setLoadingMore(false);
    }
  }

  const totalLabel = useMemo(() => {
    if (!data) return "";
    return `${data.total.toLocaleString("pt-BR")} participante${data.total === 1 ? "" : "s"}`;
  }, [data]);

  return (
    <GuardedPanelShell title="Fidelidade" organizationId={params.orgId}>
      <main className="mx-auto max-w-7xl px-5 py-7 lg:px-8 lg:py-9">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-[11px] font-extrabold uppercase tracking-[.08em] text-primary">N9 · fidelidade da Casa</p>
            <h1 className="mt-1 text-[27px] font-black tracking-tight text-ink">Programa de fidelidade</h1>
            <p className="mt-2 max-w-3xl text-[13px] font-semibold leading-relaxed text-muted">
              Pontos nascem de compras pagas e são revertidos automaticamente quando a compra é estornada. O histórico é um ledger, não um saldo editável.
            </p>
          </div>
          <Link href={`/organizacoes/${params.orgId}/clientes`} className="rounded-xl border border-line-input bg-surface px-4 py-2.5 text-[12px] font-extrabold text-primary">
            ← Clientes
          </Link>
        </div>

        {error ? <p className="mt-5 rounded-2xl border border-danger/25 bg-danger/5 p-4 text-[12px] font-bold text-danger">{error}</p> : null}

        <section className="mt-6 grid gap-5 xl:grid-cols-[420px_1fr]">
          <form onSubmit={saveProgram} className="rounded-3xl border border-line bg-surface p-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-[16px] font-black text-ink">Regras do programa</h2>
                <p className="mt-1 text-[11.5px] font-semibold text-muted">A Casa controla quando começa a acumular pontos.</p>
              </div>
              <button
                type="button"
                disabled={!program}
                onClick={() => setProgram((current) => current ? { ...current, enabled: !current.enabled } : current)}
                className={`rounded-full px-3 py-1.5 text-[10.5px] font-extrabold ${program?.enabled ? "bg-success/10 text-success" : "bg-bg text-muted"}`}
              >
                {program?.enabled ? "Ativo" : "Pausado"}
              </button>
            </div>

            {program ? (
              <div className="mt-5 grid gap-4">
                <label className="text-[11px] font-bold text-muted">
                  Pontos por R$ 1 gasto
                  <input type="number" min={0} max={100} value={program.pointsPerReal} onChange={(e) => setProgram({ ...program, pointsPerReal: Number(e.target.value) })} className="mt-1 h-11 w-full rounded-xl border border-line-input bg-bg px-3 text-[13px] text-ink" />
                </label>
                <div className="grid grid-cols-3 gap-2">
                  <label className="text-[10.5px] font-bold text-muted">Prata<input type="number" min={0} value={program.silverPoints} onChange={(e) => setProgram({ ...program, silverPoints: Number(e.target.value) })} className="mt-1 h-10 w-full rounded-xl border border-line-input bg-bg px-2 text-[12px] text-ink" /></label>
                  <label className="text-[10.5px] font-bold text-muted">Ouro<input type="number" min={0} value={program.goldPoints} onChange={(e) => setProgram({ ...program, goldPoints: Number(e.target.value) })} className="mt-1 h-10 w-full rounded-xl border border-line-input bg-bg px-2 text-[12px] text-ink" /></label>
                  <label className="text-[10.5px] font-bold text-muted">Platina<input type="number" min={0} value={program.platinumPoints} onChange={(e) => setProgram({ ...program, platinumPoints: Number(e.target.value) })} className="mt-1 h-10 w-full rounded-xl border border-line-input bg-bg px-2 text-[12px] text-ink" /></label>
                </div>
                <p className="rounded-xl bg-bg p-3 text-[11px] font-semibold leading-relaxed text-muted">
                  Exemplo: com {program.pointsPerReal} ponto(s)/R$1, uma compra de R$100 gera <strong className="text-ink">{program.pointsPerReal * 100} pontos</strong>.
                </p>
                <button disabled={saving} className="h-11 rounded-xl bg-primary px-4 text-[12.5px] font-extrabold text-white disabled:opacity-50">
                  {saving ? "Salvando…" : "Salvar programa"}
                </button>
                {saved ? <p className="text-center text-[11px] font-bold text-success">Regras atualizadas.</p> : null}
              </div>
            ) : <p className="mt-5 text-[12px] font-semibold text-muted">Carregando regras…</p>}
          </form>

          <div>
            {data ? (
              <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
                {[
                  ["Participantes", data.total],
                  ["Pontos em circulação", data.summary.pointsOutstanding],
                  ["Prata", data.summary.silver],
                  ["Ouro", data.summary.gold],
                  ["Platina", data.summary.platinum],
                ].map(([label, value]) => (
                  <div key={String(label)} className="rounded-2xl border border-line bg-surface p-4">
                    <p className="text-[10px] font-extrabold uppercase tracking-[.04em] text-muted-2">{label}</p>
                    <p className="mt-1.5 text-[20px] font-black text-ink">{Number(value).toLocaleString("pt-BR")}</p>
                  </div>
                ))}
              </section>
            ) : null}

            <section className="mt-4 rounded-3xl border border-line bg-surface p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar por nome ou e-mail" className="h-11 w-full max-w-xl rounded-xl border border-line-input bg-bg px-4 text-[13px] font-semibold text-ink outline-none focus:border-primary" />
                <span className="text-[11px] font-bold text-muted">{loading ? "Atualizando…" : totalLabel}</span>
              </div>
            </section>

            {loading && !data ? <div className="mt-4 rounded-3xl border border-line bg-surface p-10 text-center text-[12px] font-semibold text-muted">Carregando fidelidade…</div> : null}
            {!loading && data && data.accounts.length === 0 ? <div className="mt-4 rounded-3xl border border-line bg-surface p-10 text-center"><p className="font-extrabold text-ink">Ainda não há pontos acumulados</p><p className="mt-1 text-[12px] font-semibold text-muted">Ative o programa; as próximas compras pagas começam a formar a base.</p></div> : null}

            {data?.accounts.length ? (
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                {data.accounts.map((account) => (
                  <article key={account.id} className="rounded-2xl border border-line bg-surface p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0"><p className="truncate text-[14px] font-extrabold text-ink">{account.name || account.email}</p><p className="mt-0.5 truncate text-[11px] font-semibold text-muted">{account.email}</p></div>
                      <span className="rounded-full bg-primary/8 px-2.5 py-1 text-[10px] font-extrabold text-primary">{LEVEL_LABEL[account.level]}</span>
                    </div>
                    <div className="mt-4 grid grid-cols-2 gap-2 rounded-xl bg-bg p-3 text-center">
                      <div><p className="text-[19px] font-black text-ink">{account.points.toLocaleString("pt-BR")}</p><p className="text-[9.5px] font-bold uppercase text-muted-2">saldo</p></div>
                      <div><p className="text-[19px] font-black text-ink">{account.lifetimePoints.toLocaleString("pt-BR")}</p><p className="text-[9.5px] font-bold uppercase text-muted-2">ganhos</p></div>
                    </div>
                    <p className="mt-3 text-[10.5px] font-semibold text-muted">Última movimentação: {date(account.lastActivityAt)}</p>
                  </article>
                ))}
              </div>
            ) : null}

            {data && data.accounts.length < data.total ? <div className="mt-5 text-center"><button type="button" onClick={loadMore} disabled={loadingMore} className="h-11 rounded-xl border border-line-input bg-surface px-6 text-[12px] font-extrabold text-primary disabled:opacity-50">{loadingMore ? "Carregando…" : "Carregar mais"}</button></div> : null}
          </div>
        </section>
      </main>
    </GuardedPanelShell>
  );
}
