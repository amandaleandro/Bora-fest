"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { getMyLoyalty, redeemReward, type BuyerLoyaltyCasa } from "@/lib/loyalty-api";

const LEVEL_LABEL: Record<BuyerLoyaltyCasa["level"], string> = {
  BRONZE: "Bronze",
  SILVER: "Prata",
  GOLD: "Ouro",
  PLATINUM: "Platina",
};

export default function LoyaltyBuyerPage() {
  const [token, setToken] = useState<string | null>(null);
  const [casas, setCasas] = useState<BuyerLoyaltyCasa[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [redeeming, setRedeeming] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function load(storedToken: string) {
    setLoading(true);
    setError(null);
    try {
      setCasas(await getMyLoyalty(storedToken));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível carregar sua fidelidade");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const stored = localStorage.getItem("bf.token");
    setToken(stored);
    if (!stored) {
      setLoading(false);
      return;
    }
    void load(stored);
  }, []);

  async function redeem(casa: BuyerLoyaltyCasa, rewardId: string, name: string) {
    if (!token || redeeming) return;
    const confirmed = window.confirm(`Resgatar ${name} com seus pontos? O débito é imediato.`);
    if (!confirmed) return;
    setRedeeming(rewardId);
    setError(null);
    setSuccess(null);
    try {
      const key = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${rewardId}`;
      const result = await redeemReward(token, casa.organizationId, rewardId, key);
      setSuccess(`Resgate concluído: ${result.rewardName}. Código ${result.code}`);
      await load(token);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível resgatar agora");
    } finally {
      setRedeeming(null);
    }
  }

  if (!token && !loading) {
    return (
      <main className="mx-auto max-w-[760px] px-5 py-12 lg:px-6 lg:py-16">
        <div className="rounded-3xl border border-line bg-surface p-8 text-center shadow-card">
          <p className="text-[11px] font-extrabold uppercase tracking-[.08em] text-primary">BoraFest Fidelidade</p>
          <h1 className="mt-2 text-[26px] font-black text-ink">Entre para ver seus pontos</h1>
          <p className="mx-auto mt-2 max-w-lg text-[13px] font-semibold leading-relaxed text-muted">Seus pontos ficam vinculados ao e-mail usado nas compras e aparecem automaticamente depois que você entra.</p>
          <Link href="/perfil" className="mt-6 inline-flex h-11 items-center justify-center rounded-xl bg-primary px-6 text-[13px] font-extrabold text-white shadow-cta">Entrar na minha conta</Link>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-[980px] px-5 py-8 lg:px-6 lg:py-12">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[11px] font-extrabold uppercase tracking-[.08em] text-primary">BoraFest Fidelidade</p>
          <h1 className="mt-1 text-[28px] font-black tracking-tight text-ink">Meus pontos e recompensas</h1>
          <p className="mt-2 max-w-2xl text-[13px] font-semibold text-muted">Cada Casa tem seu próprio programa. Resgates geram um voucher para apresentar no local.</p>
        </div>
        <Link href="/perfil" className="rounded-xl border border-line-input bg-surface px-4 py-2.5 text-[12px] font-extrabold text-primary">Minha conta</Link>
      </div>

      {error ? <p className="mt-5 rounded-2xl border border-danger/25 bg-danger/5 p-4 text-[12px] font-bold text-danger">{error}</p> : null}
      {success ? <p className="mt-5 rounded-2xl border border-success/25 bg-success/5 p-4 text-[12px] font-bold text-success">{success}</p> : null}
      {loading ? <div className="mt-6 rounded-3xl border border-line bg-surface p-12 text-center text-[13px] font-semibold text-muted">Carregando seus pontos…</div> : null}
      {!loading && casas.length === 0 ? <div className="mt-6 rounded-3xl border border-line bg-surface p-10 text-center"><p className="text-[16px] font-extrabold text-ink">Você ainda não tem pontos</p><p className="mt-1 text-[12px] font-semibold text-muted">Quando uma Casa que você compra ativar fidelidade, seus pontos aparecem aqui.</p></div> : null}

      <div className="mt-6 grid gap-5">
        {casas.map((casa) => (
          <section key={casa.organizationId} className="rounded-3xl border border-line bg-surface p-5 lg:p-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <Link href={`/casa/${casa.organizationSlug}`} className="text-[18px] font-black text-ink hover:text-primary">{casa.organizationName}</Link>
                <p className="mt-1 text-[11px] font-bold text-muted">Nível {LEVEL_LABEL[casa.level]} · {casa.lifetimePoints.toLocaleString("pt-BR")} pontos conquistados</p>
              </div>
              <div className="rounded-2xl bg-primary/8 px-5 py-3 text-right">
                <p className="text-[25px] font-black text-primary">{casa.points.toLocaleString("pt-BR")}</p>
                <p className="text-[10px] font-extrabold uppercase tracking-[.04em] text-muted">pontos disponíveis</p>
              </div>
            </div>

            {!casa.enabled ? <p className="mt-4 rounded-xl bg-bg p-3 text-[11px] font-bold text-muted">Esta Casa pausou temporariamente os resgates. Seus pontos continuam guardados.</p> : null}

            <div className="mt-5 grid gap-3 md:grid-cols-2">
              {casa.rewards.length === 0 ? <p className="text-[12px] font-semibold text-muted">Nenhuma recompensa ativa no momento.</p> : null}
              {casa.rewards.map((reward) => {
                const canRedeem = casa.enabled && reward.canRedeem;
                return (
                  <article key={reward.id} className="rounded-2xl border border-line bg-bg/45 p-4">
                    <div className="flex items-start justify-between gap-3"><div><p className="text-[14px] font-extrabold text-ink">{reward.name}</p>{reward.description ? <p className="mt-1 text-[11px] font-semibold leading-relaxed text-muted">{reward.description}</p> : null}</div><span className="shrink-0 rounded-full bg-primary/10 px-2.5 py-1 text-[10px] font-extrabold text-primary">{reward.pointsCost.toLocaleString("pt-BR")} pts</span></div>
                    <p className="mt-3 text-[10.5px] font-semibold text-muted">{reward.available === null ? "Sem limite geral" : `${reward.available} restante(s)`} · limite {reward.maxPerCustomer} por pessoa</p>
                    <button type="button" disabled={!canRedeem || redeeming === reward.id} onClick={() => redeem(casa, reward.id, reward.name)} className="mt-3 h-10 w-full rounded-xl bg-primary px-4 text-[11.5px] font-extrabold text-white disabled:cursor-not-allowed disabled:opacity-40">{redeeming === reward.id ? "Resgatando…" : reward.redeemedByMe >= reward.maxPerCustomer ? "Limite atingido" : casa.points < reward.pointsCost ? "Pontos insuficientes" : "Resgatar recompensa"}</button>
                  </article>
                );
              })}
            </div>

            {casa.vouchers.length ? <div className="mt-6 border-t border-line pt-5"><h2 className="text-[13px] font-black text-ink">Meus vouchers</h2><div className="mt-3 grid gap-2 md:grid-cols-2">{casa.vouchers.map((voucher) => <div key={voucher.id} className="rounded-xl border border-line bg-bg px-4 py-3"><div className="flex items-center justify-between gap-3"><p className="text-[12px] font-extrabold text-ink">{voucher.rewardName}</p><span className={`text-[10px] font-extrabold ${voucher.status === "USED" ? "text-muted" : "text-success"}`}>{voucher.status === "USED" ? "Usado" : "Disponível"}</span></div><p className="mt-2 font-mono text-[15px] font-black tracking-[.08em] text-primary">{voucher.code}</p></div>)}</div></div> : null}
          </section>
        ))}
      </div>
    </main>
  );
}
