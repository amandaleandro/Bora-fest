"use client";

import { useEffect, useState } from "react";
import { AuthGuard } from "@/components/AuthGuard";
import { Nav } from "@/components/Nav";
import { useAuth } from "@/lib/auth";
import { adminApi, type AdminEvent, type AdminOrganization } from "@/lib/api";

function formatCents(cents: number): string {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function OrganizationDetailContent({ orgId }: { orgId: string }) {
  const { token, user } = useAuth();
  const [org, setOrg] = useState<(AdminOrganization & { events: AdminEvent[] }) | null>(null);
  const [balance, setBalance] = useState<{ balanceCents: number; availableForPayoutCents: number } | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [pixFee, setPixFee] = useState("");
  const [pixFloor, setPixFloor] = useState("");
  const [cardFee, setCardFee] = useState("");
  const [blockReason, setBlockReason] = useState("");
  const [settlementMode, setSettlementMode] = useState<"STANDARD" | "INSTANT">("STANDARD");
  const [autoPayout, setAutoPayout] = useState(false);
  const [refundHoldDays, setRefundHoldDays] = useState("7");
  const [message, setMessage] = useState<string | null>(null);

  const isAdmin = user?.platformRole === "ADMIN";

  async function load() {
    if (!token) return;
    setLoading(true);
    try {
      const [orgData, ledger] = await Promise.all([
        adminApi.getOrganization(token, orgId),
        adminApi.getOrganizationLedger(token, orgId),
      ]);
      setOrg(orgData);
      setBalance(ledger);
      setPixFee(orgData.pixFeeBps != null ? String(orgData.pixFeeBps / 100) : "");
      setPixFloor(orgData.pixFeeFloorCents != null ? String(orgData.pixFeeFloorCents / 100) : "");
      setCardFee(orgData.cardFeeBps != null ? String(orgData.cardFeeBps / 100) : "");
      setSettlementMode(orgData.settlementMode ?? "STANDARD");
      setAutoPayout(orgData.autoPayout ?? false);
      setRefundHoldDays(String(orgData.refundHoldDays ?? 7));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, orgId]);

  async function handleSaveFee() {
    if (!token) return;
    setMessage(null);
    try {
      await adminApi.setFee(token, orgId, {
        pixFeeBps: pixFee ? Math.round(Number(pixFee) * 100) : null,
        pixFeeFloorCents: pixFloor ? Math.round(Number(pixFloor) * 100) : null,
        cardFeeBps: cardFee ? Math.round(Number(cardFee) * 100) : null,
      });
      setMessage("Taxa atualizada");
      await load();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Não foi possível salvar");
    }
  }

  async function handleSaveSettlement() {
    if (!token) return;
    setMessage(null);
    if (
      settlementMode === "INSTANT" &&
      org?.settlementMode !== "INSTANT" &&
      !window.confirm(
        "Repasse INSTANTÂNEO transfere a responsabilidade pelos reembolsos para a casa. Confirme que o aditivo (docs/juridico/REPASSE-INSTANTANEO-MINUTA.md) está assinado.",
      )
    ) {
      return;
    }
    try {
      await adminApi.updateSettlement(token, orgId, {
        settlementMode,
        autoPayout,
        refundHoldDays: Number(refundHoldDays) || 7,
      });
      setMessage("Repasse atualizado");
      await load();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Não foi possível salvar o repasse");
    }
  }

  async function handleBlock() {
    if (!token || !blockReason) return;
    setMessage(null);
    try {
      await adminApi.blockOrganization(token, orgId, blockReason);
      setBlockReason("");
      await load();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Não foi possível bloquear");
    }
  }

  async function handleUnblock() {
    if (!token) return;
    setMessage(null);
    try {
      await adminApi.unblockOrganization(token, orgId);
      await load();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Não foi possível desbloquear");
    }
  }

  async function handleApprove() {
    if (!token) return;
    setMessage(null);
    try {
      await adminApi.approveOrganization(token, orgId);
      await load();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Não foi possível aprovar o cadastro");
    }
  }

  async function handleCreatePayout() {
    if (!token) return;
    setMessage(null);
    try {
      const payout = await adminApi.createPayout(token, orgId);
      setMessage(`Repasse criado: ${formatCents(payout.amountCents)}`);
      await load();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Não foi possível criar o repasse");
    }
  }

  if (loading || !org) {
    return (
      <main>
        <Nav />
        <p className="mt-6 text-gray-400">Carregando...</p>
      </main>
    );
  }

  return (
    <main>
      <Nav />
      <div className="mt-6 flex items-center justify-between">
        <h1 className="text-xl font-semibold">{org.name}</h1>
        <span className="rounded-full bg-gray-800 px-3 py-1 text-xs">{org.status}</span>
      </div>

      {message ? <p className="mt-3 text-sm text-amber-300">{message}</p> : null}

      <div className="mt-6 grid grid-cols-2 gap-4">
        <div className="rounded-lg bg-gray-800/60 p-4">
          <p className="text-xs text-gray-400">Saldo</p>
          <p className="mt-1 text-xl font-bold">{formatCents(balance?.balanceCents ?? 0)}</p>
        </div>
        <div className="rounded-lg bg-gray-800/60 p-4">
          <p className="text-xs text-gray-400">Disponível para repasse</p>
          <p className="mt-1 text-xl font-bold text-brand">
            {formatCents(balance?.availableForPayoutCents ?? 0)}
          </p>
          {isAdmin ? (
            <button
              type="button"
              className="mt-2 rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-brand-dark disabled:opacity-40"
              onClick={handleCreatePayout}
              disabled={org.status !== "ACTIVE" || (balance?.availableForPayoutCents ?? 0) <= 0}
            >
              Criar repasse
            </button>
          ) : null}
          {org.status !== "ACTIVE" ? (
            <p className="mt-1 text-xs text-red-400">
              Repasse bloqueado — cadastro ainda não aprovado (status {org.status})
            </p>
          ) : null}
        </div>
      </div>

      {isAdmin ? (
        <section className="mt-8">
          <h2 className="text-sm font-medium text-gray-300">Taxa da plataforma</h2>
          <div className="mt-2 flex flex-col gap-2 sm:flex-row">
            <div>
              <label className="mb-1 block text-xs text-gray-400">Pix % (vazio = padrão)</label>
              <input
                className="w-full rounded-lg border border-slate-700/60 bg-slate-900/80 px-3 py-2 text-sm text-slate-100 placeholder-slate-500"
                value={pixFee}
                onChange={(e) => setPixFee(e.target.value)}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-gray-400">Piso Pix (R$)</label>
              <input
                className="w-full rounded-lg border border-slate-700/60 bg-slate-900/80 px-3 py-2 text-sm text-slate-100 placeholder-slate-500"
                value={pixFloor}
                onChange={(e) => setPixFloor(e.target.value)}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-gray-400">Cartão %</label>
              <input
                className="w-full rounded-lg border border-slate-700/60 bg-slate-900/80 px-3 py-2 text-sm text-slate-100 placeholder-slate-500"
                value={cardFee}
                onChange={(e) => setCardFee(e.target.value)}
              />
            </div>
          </div>
          <button
            type="button"
            className="mt-3 rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-brand-dark"
            onClick={handleSaveFee}
          >
            Salvar taxa
          </button>
        </section>
      ) : null}

      {isAdmin ? (
        <section className="mt-8">
          <h2 className="text-sm font-medium text-gray-300">Repasse</h2>
          <div className="mt-2 flex flex-wrap items-end gap-3">
            <div>
              <label className="mb-1 block text-xs text-gray-400">Modo</label>
              <select
                className="rounded-lg border border-slate-700/60 bg-slate-900/80 px-3 py-2 text-sm text-slate-100"
                value={settlementMode}
                onChange={(e) => setSettlementMode(e.target.value as "STANDARD" | "INSTANT")}
              >
                <option value="STANDARD">Padrão — libera após a janela de reembolso</option>
                <option value="INSTANT">Instantâneo — casa de confiança (aditivo assinado)</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs text-gray-400">Janela de reembolso (dias)</label>
              <input
                className="w-24 rounded-lg border border-slate-700/60 bg-slate-900/80 px-3 py-2 text-sm text-slate-100"
                value={refundHoldDays}
                onChange={(e) => setRefundHoldDays(e.target.value)}
              />
            </div>
            <label className="flex items-center gap-2 text-sm text-gray-300">
              <input
                type="checkbox"
                checked={autoPayout}
                onChange={(e) => setAutoPayout(e.target.checked)}
              />
              Repasse automático
            </label>
            <button
              type="button"
              className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-brand-dark"
              onClick={handleSaveSettlement}
            >
              Salvar repasse
            </button>
          </div>
          <p className="mt-2 text-xs text-gray-500">
            Instantâneo cobra antecipação de 1,25% a.m. pró-rata sobre a parcela ainda na janela e
            exige o aditivo de responsabilidade de reembolso assinado pela casa.
          </p>
        </section>
      ) : null}

      {isAdmin && org.status !== "ACTIVE" && org.status !== "BLOCKED" ? (
        <section className="mt-8 rounded-xl border border-amber-500/30 bg-amber-500/5 p-4">
          <h2 className="text-sm font-medium text-amber-200">Cadastro pendente de aprovação</h2>
          <p className="mt-1 text-xs text-gray-400">
            Enquanto o cadastro não é aprovado a casa vende normalmente, mas nenhum saque sai —
            nem pelo painel dela, nem por repasse criado aqui. Aprove depois de conferir os dados
            e a conta bancária.
          </p>
          <button
            type="button"
            className="mt-3 rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-brand-dark"
            onClick={handleApprove}
          >
            Aprovar cadastro e liberar saque
          </button>
        </section>
      ) : null}

      {isAdmin ? (
        <section className="mt-8">
          <h2 className="text-sm font-medium text-gray-300">Bloqueio</h2>
          {org.status === "BLOCKED" ? (
            <button
              type="button"
              className="mt-2 rounded-lg bg-gray-800 px-4 py-2 text-sm"
              onClick={handleUnblock}
            >
              Desbloquear organização
            </button>
          ) : (
            <div className="mt-2 flex gap-2">
              <input
                placeholder="Motivo do bloqueio"
                className="flex-1 rounded-lg border border-slate-700/60 bg-slate-900/80 px-3 py-2 text-sm text-slate-100 placeholder-slate-500"
                value={blockReason}
                onChange={(e) => setBlockReason(e.target.value)}
              />
              <button
                type="button"
                className="rounded-lg bg-red-900 px-4 py-2 text-sm text-red-200"
                onClick={handleBlock}
                disabled={!blockReason}
              >
                Bloquear
              </button>
            </div>
          )}
        </section>
      ) : null}

      <section className="mt-8">
        <h2 className="text-sm font-medium text-gray-300">Eventos</h2>
        <ul className="mt-2 space-y-1 text-sm text-gray-300">
          {org.events.map((event) => (
            <li key={event.id}>
              {event.title} — <span className="text-gray-500">{event.status}</span>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}

export default function OrganizationDetailPage({ params }: { params: { orgId: string } }) {
  return (
    <AuthGuard>
      <OrganizationDetailContent orgId={params.orgId} />
    </AuthGuard>
  );
}
