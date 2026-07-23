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
            <p className="mt-1 text-xs text-red-400">Repasse bloqueado — KYC não aprovado (status {org.status})</p>
          ) : null}
        </div>
      </div>

      {isAdmin ? (
        <section className="mt-8">
          <h2 className="text-sm font-medium text-gray-300">Taxa da plataforma</h2>
          <div className="mt-2 flex gap-2">
            <div>
              <label className="mb-1 block text-xs text-gray-400">Pix % (vazio = padrão)</label>
              <input value={pixFee} onChange={(e) => setPixFee(e.target.value)} />
            </div>
            <div>
              <label className="mb-1 block text-xs text-gray-400">Piso Pix (R$)</label>
              <input value={pixFloor} onChange={(e) => setPixFloor(e.target.value)} />
            </div>
            <div>
              <label className="mb-1 block text-xs text-gray-400">Cartão %</label>
              <input value={cardFee} onChange={(e) => setCardFee(e.target.value)} />
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
                className="flex-1"
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
