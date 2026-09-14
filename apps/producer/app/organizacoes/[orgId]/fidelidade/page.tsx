"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { GuardedPanelShell } from "@/components/PanelShell";
import { useAuth } from "@/lib/auth";
import {
  createLoyaltyReward,
  getLoyaltyAccounts,
  getLoyaltyProgram,
  getLoyaltyRedemptions,
  getLoyaltyRewards,
  updateLoyaltyProgram,
  updateLoyaltyReward,
  useLoyaltyVoucher,
  type LoyaltyAccount,
  type LoyaltyAccountsResponse,
  type LoyaltyProgram,
  type LoyaltyRedemption,
  type LoyaltyReward,
} from "@/lib/loyalty-api";

const LEVEL_LABEL: Record<LoyaltyAccount["level"], string> = {
  BRONZE: "Bronze",
  SILVER: "Prata",
  GOLD: "Ouro",
  PLATINUM: "Platina",
};

export default function LoyaltyPage({ params }: { params: { orgId: string } }) {
  const { token } = useAuth();
  const [program, setProgram] = useState<LoyaltyProgram | null>(null);
  const [accounts, setAccounts] = useState<LoyaltyAccountsResponse | null>(null);
  const [rewards, setRewards] = useState<LoyaltyReward[]>([]);
  const [redemptions, setRedemptions] = useState<LoyaltyRedemption[]>([]);
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [voucherCode, setVoucherCode] = useState("");
  const [draft, setDraft] = useState({ name: "", description: "", pointsCost: 500, quantity: "", maxPerCustomer: 1 });

  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(query.trim()), 300);
    return () => window.clearTimeout(id);
  }, [query]);

  async function reloadAll(activeToken: string, q = debounced) {
    const [loadedProgram, loadedAccounts, loadedRewards, loadedRedemptions] = await Promise.all([
      getLoyaltyProgram(activeToken, params.orgId),
      getLoyaltyAccounts(activeToken, params.orgId, { q: q || undefined, page: 1, pageSize: 30 }),
      getLoyaltyRewards(activeToken, params.orgId),
      getLoyaltyRedemptions(activeToken, params.orgId),
    ]);
    setProgram(loadedProgram);
    setAccounts(loadedAccounts);
    setRewards(loadedRewards);
    setRedemptions(loadedRedemptions);
    setPage(1);
  }

  useEffect(() => {
    if (!token) return;
    let active = true;
    setLoading(true);
    setError(null);
    Promise.all([
      getLoyaltyProgram(token, params.orgId),
      getLoyaltyAccounts(token, params.orgId, { q: debounced || undefined, page: 1, pageSize: 30 }),
      getLoyaltyRewards(token, params.orgId),
      getLoyaltyRedemptions(token, params.orgId),
    ]).then(([p, a, r, rd]) => {
      if (!active) return;
      setProgram(p); setAccounts(a); setRewards(r); setRedemptions(rd); setPage(1);
    }).catch((err) => active && setError(err instanceof Error ? err.message : "Não foi possível carregar a fidelidade"))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [token, params.orgId, debounced]);

  async function saveProgram(event: FormEvent) {
    event.preventDefault();
    if (!token || !program) return;
    setBusy(true); setError(null); setMessage(null);
    try {
      setProgram(await updateLoyaltyProgram(token, params.orgId, {
        enabled: program.enabled,
        pointsPerReal: program.pointsPerReal,
        silverPoints: program.silverPoints,
        goldPoints: program.goldPoints,
        platinumPoints: program.platinumPoints,
      }));
      setMessage("Regras do programa atualizadas.");
    } catch (err) { setError(err instanceof Error ? err.message : "Não foi possível salvar"); }
    finally { setBusy(false); }
  }

  async function createReward(event: FormEvent) {
    event.preventDefault();
    if (!token || busy) return;
    setBusy(true); setError(null); setMessage(null);
    try {
      await createLoyaltyReward(token, params.orgId, {
        name: draft.name,
        description: draft.description || undefined,
        pointsCost: Number(draft.pointsCost),
        quantity: draft.quantity ? Number(draft.quantity) : null,
        maxPerCustomer: Number(draft.maxPerCustomer),
      });
      setDraft({ name: "", description: "", pointsCost: 500, quantity: "", maxPerCustomer: 1 });
      await reloadAll(token);
      setMessage("Recompensa criada.");
    } catch (err) { setError(err instanceof Error ? err.message : "Não foi possível criar a recompensa"); }
    finally { setBusy(false); }
  }

  async function toggleReward(reward: LoyaltyReward) {
    if (!token || busy) return;
    setBusy(true); setError(null);
    try {
      await updateLoyaltyReward(token, params.orgId, reward.id, { active: !reward.active });
      setRewards(await getLoyaltyRewards(token, params.orgId));
    } catch (err) { setError(err instanceof Error ? err.message : "Não foi possível atualizar a recompensa"); }
    finally { setBusy(false); }
  }

  async function validateVoucher(event: FormEvent) {
    event.preventDefault();
    if (!token || !voucherCode.trim() || busy) return;
    setBusy(true); setError(null); setMessage(null);
    try {
      const used = await useLoyaltyVoucher(token, params.orgId, voucherCode.trim());
      setMessage(`${used.rewardName} validado para ${used.customerEmail}.`);
      setVoucherCode("");
      setRedemptions(await getLoyaltyRedemptions(token, params.orgId));
    } catch (err) { setError(err instanceof Error ? err.message : "Voucher inválido"); }
    finally { setBusy(false); }
  }

  async function loadMore() {
    if (!token || !accounts || accounts.accounts.length >= accounts.total) return;
    const next = page + 1;
    try {
      const result = await getLoyaltyAccounts(token, params.orgId, { q: debounced || undefined, page: next, pageSize: 30 });
      setAccounts((current) => current ? { ...result, accounts: [...current.accounts, ...result.accounts] } : result);
      setPage(next);
    } catch (err) { setError(err instanceof Error ? err.message : "Não foi possível carregar mais participantes"); }
  }

  const issued = useMemo(() => redemptions.filter((item) => item.status === "ISSUED").length, [redemptions]);

  return (
    <GuardedPanelShell title="Fidelidade" organizationId={params.orgId}>
      <main className="mx-auto max-w-7xl px-5 py-7 lg:px-8 lg:py-9">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div><p className="text-[11px] font-extrabold uppercase tracking-[.08em] text-primary">N9.1 · fidelidade da Casa</p><h1 className="mt-1 text-[27px] font-black tracking-tight text-ink">Pontos, recompensas e vouchers</h1><p className="mt-2 max-w-3xl text-[13px] font-semibold text-muted">Compras pagas geram pontos; o cliente troca por benefícios e recebe um voucher validado pela Casa.</p></div>
          <Link href={`/organizacoes/${params.orgId}/clientes`} className="rounded-xl border border-line-input bg-surface px-4 py-2.5 text-[12px] font-extrabold text-primary">← Clientes</Link>
        </div>

        {error ? <p className="mt-5 rounded-2xl border border-danger/25 bg-danger/5 p-4 text-[12px] font-bold text-danger">{error}</p> : null}
        {message ? <p className="mt-5 rounded-2xl border border-success/25 bg-success/5 p-4 text-[12px] font-bold text-success">{message}</p> : null}
        {loading ? <div className="mt-6 rounded-3xl border border-line bg-surface p-10 text-center text-[12px] font-semibold text-muted">Carregando programa…</div> : null}

        {!loading && program ? <>
          <section className="mt-6 grid gap-5 xl:grid-cols-2">
            <form onSubmit={saveProgram} className="rounded-3xl border border-line bg-surface p-5">
              <div className="flex items-start justify-between gap-4"><div><h2 className="text-[16px] font-black text-ink">Regras do programa</h2><p className="mt-1 text-[11px] font-semibold text-muted">Pausar impede novos pontos e novos resgates; saldos existentes permanecem.</p></div><button type="button" onClick={() => setProgram({ ...program, enabled: !program.enabled })} className={`rounded-full px-3 py-1.5 text-[10.5px] font-extrabold ${program.enabled ? "bg-success/10 text-success" : "bg-bg text-muted"}`}>{program.enabled ? "Ativo" : "Pausado"}</button></div>
              <div className="mt-5 grid gap-3"><label className="text-[11px] font-bold text-muted">Pontos por R$1<input type="number" min={0} max={100} value={program.pointsPerReal} onChange={(e) => setProgram({ ...program, pointsPerReal: Number(e.target.value) })} className="mt-1 h-11 w-full rounded-xl border border-line-input bg-bg px-3 text-[13px] text-ink" /></label><div className="grid grid-cols-3 gap-2">{(["silverPoints","goldPoints","platinumPoints"] as const).map((key, i) => <label key={key} className="text-[10.5px] font-bold text-muted">{["Prata","Ouro","Platina"][i]}<input type="number" min={0} value={program[key]} onChange={(e) => setProgram({ ...program, [key]: Number(e.target.value) })} className="mt-1 h-10 w-full rounded-xl border border-line-input bg-bg px-2 text-[12px] text-ink" /></label>)}</div><button disabled={busy} className="h-11 rounded-xl bg-primary text-[12px] font-extrabold text-white disabled:opacity-50">Salvar regras</button></div>
            </form>

            <form onSubmit={createReward} className="rounded-3xl border border-line bg-surface p-5">
              <h2 className="text-[16px] font-black text-ink">Nova recompensa</h2><p className="mt-1 text-[11px] font-semibold text-muted">Estoque vazio significa ilimitado. O custo em pontos fica congelado no voucher emitido.</p>
              <div className="mt-4 grid gap-3"><input required minLength={2} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="Ex.: Drink cortesia" className="h-11 rounded-xl border border-line-input bg-bg px-3 text-[12px] text-ink" /><textarea value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} placeholder="Descrição / regra de retirada" className="min-h-20 rounded-xl border border-line-input bg-bg p-3 text-[12px] text-ink" /><div className="grid grid-cols-3 gap-2"><label className="text-[10px] font-bold text-muted">Pontos<input type="number" min={1} value={draft.pointsCost} onChange={(e) => setDraft({ ...draft, pointsCost: Number(e.target.value) })} className="mt-1 h-10 w-full rounded-xl border border-line-input bg-bg px-2 text-[12px]" /></label><label className="text-[10px] font-bold text-muted">Estoque<input type="number" min={1} value={draft.quantity} onChange={(e) => setDraft({ ...draft, quantity: e.target.value })} placeholder="∞" className="mt-1 h-10 w-full rounded-xl border border-line-input bg-bg px-2 text-[12px]" /></label><label className="text-[10px] font-bold text-muted">Limite/pessoa<input type="number" min={1} max={50} value={draft.maxPerCustomer} onChange={(e) => setDraft({ ...draft, maxPerCustomer: Number(e.target.value) })} className="mt-1 h-10 w-full rounded-xl border border-line-input bg-bg px-2 text-[12px]" /></label></div><button disabled={busy || !draft.name.trim()} className="h-11 rounded-xl bg-primary text-[12px] font-extrabold text-white disabled:opacity-50">Criar recompensa</button></div>
            </form>
          </section>

          <section className="mt-5 rounded-3xl border border-line bg-surface p-5"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-[16px] font-black text-ink">Catálogo</h2><p className="mt-1 text-[11px] font-semibold text-muted">{rewards.length} recompensa(s) · {issued} voucher(es) aguardando uso</p></div></div><div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">{rewards.map((reward) => <article key={reward.id} className="rounded-2xl border border-line bg-bg/50 p-4"><div className="flex items-start justify-between gap-3"><div><p className="text-[13px] font-extrabold text-ink">{reward.name}</p><p className="mt-1 text-[10.5px] font-semibold text-muted">{reward.pointsCost.toLocaleString("pt-BR")} pts · {reward.available === null ? "estoque ilimitado" : `${reward.available} restante(s)`}</p></div><button type="button" disabled={busy} onClick={() => toggleReward(reward)} className={`rounded-full px-2.5 py-1 text-[10px] font-extrabold ${reward.active ? "bg-success/10 text-success" : "bg-bg text-muted"}`}>{reward.active ? "Ativa" : "Pausada"}</button></div>{reward.description ? <p className="mt-3 text-[11px] font-semibold leading-relaxed text-muted">{reward.description}</p> : null}<p className="mt-3 text-[10px] font-bold text-muted-2">{Number(reward.claimed).toLocaleString("pt-BR")} resgate(s) · máx. {reward.maxPerCustomer}/cliente</p></article>)}{rewards.length === 0 ? <p className="text-[12px] font-semibold text-muted">Crie a primeira recompensa para começar os resgates.</p> : null}</div></section>

          <section className="mt-5 grid gap-5 xl:grid-cols-[360px_1fr]">
            <form onSubmit={validateVoucher} className="rounded-3xl border border-line bg-surface p-5"><h2 className="text-[16px] font-black text-ink">Validar voucher</h2><p className="mt-1 text-[11px] font-semibold text-muted">Digite o código apresentado pelo cliente. Repetir a validação não consome duas vezes.</p><input value={voucherCode} onChange={(e) => setVoucherCode(e.target.value.toUpperCase())} placeholder="BF-XXXXXXXXXXXX" className="mt-4 h-12 w-full rounded-xl border border-line-input bg-bg px-3 font-mono text-[14px] font-bold tracking-[.05em] text-ink" /><button disabled={busy || voucherCode.trim().length < 6} className="mt-3 h-11 w-full rounded-xl bg-primary text-[12px] font-extrabold text-white disabled:opacity-50">Validar benefício</button></form>
            <div className="rounded-3xl border border-line bg-surface p-5"><h2 className="text-[16px] font-black text-ink">Resgates recentes</h2><div className="mt-3 max-h-[320px] overflow-auto">{redemptions.slice(0, 50).map((item) => <div key={item.id} className="flex items-center justify-between gap-3 border-b border-line py-3 last:border-0"><div className="min-w-0"><p className="truncate text-[12px] font-extrabold text-ink">{item.rewardName}</p><p className="truncate text-[10.5px] font-semibold text-muted">{item.customerName || item.customerEmail} · <span className="font-mono">{item.code}</span></p></div><span className={`shrink-0 text-[10px] font-extrabold ${item.status === "USED" ? "text-muted" : "text-success"}`}>{item.status === "USED" ? "Usado" : "Emitido"}</span></div>)}{redemptions.length === 0 ? <p className="text-[12px] font-semibold text-muted">Nenhum resgate ainda.</p> : null}</div></div>
          </section>

          <section className="mt-5 rounded-3xl border border-line bg-surface p-5"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-[16px] font-black text-ink">Participantes</h2><p className="mt-1 text-[11px] font-semibold text-muted">{accounts?.total ?? 0} participante(s) · {(accounts?.summary.pointsOutstanding ?? 0).toLocaleString("pt-BR")} pontos em circulação</p></div><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar nome ou e-mail" className="h-10 w-full max-w-sm rounded-xl border border-line-input bg-bg px-3 text-[12px] text-ink" /></div><div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">{accounts?.accounts.map((account) => <article key={account.id} className="rounded-2xl border border-line bg-bg/45 p-4"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="truncate text-[12px] font-extrabold text-ink">{account.name || account.email}</p><p className="truncate text-[10.5px] font-semibold text-muted">{account.email}</p></div><span className="rounded-full bg-primary/8 px-2 py-1 text-[9.5px] font-extrabold text-primary">{LEVEL_LABEL[account.level]}</span></div><p className="mt-3 text-[19px] font-black text-ink">{account.points.toLocaleString("pt-BR")} <span className="text-[10px] font-bold text-muted">pts disponíveis</span></p></article>)}</div>{accounts && accounts.accounts.length < accounts.total ? <div className="mt-4 text-center"><button type="button" onClick={loadMore} className="h-10 rounded-xl border border-line-input px-5 text-[11px] font-extrabold text-primary">Carregar mais</button></div> : null}</section>
        </> : null}
      </main>
    </GuardedPanelShell>
  );
}
