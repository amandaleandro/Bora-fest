"use client";

import { useEffect, useState } from "react";
import { AuthGuard } from "@/components/AuthGuard";
import { Nav } from "@/components/Nav";
import { useAuth } from "@/lib/auth";
import { adminApi, type Payout } from "@/lib/api";

function formatCents(cents: number): string {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

type PayoutRequestRow = Awaited<ReturnType<typeof adminApi.listPayoutRequests>>[number];

function PayoutsContent() {
  const { token, user } = useAuth();
  const [payouts, setPayouts] = useState<Payout[]>([]);
  const [requests, setRequests] = useState<PayoutRequestRow[]>([]);
  const [loading, setLoading] = useState(true);
  // ERRO NÃO VIRA "ZERO" (2026-10-12): a fila de saques caía num .catch(() => [])
  // e uma falha (ou o 403 de quem não é ADMIN) aparecia como "Nenhuma solicitação
  // pendente 🎉" — saque parado com cara de fila limpa. Cada lista tem seu erro.
  const [requestsError, setRequestsError] = useState<string | null>(null);
  const [payoutsError, setPayoutsError] = useState<string | null>(null);
  const [notesById, setNotesById] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const isAdmin = user?.platformRole === "ADMIN";

  async function load() {
    if (!token) return;
    setLoading(true);
    setRequestsError(null);
    setPayoutsError(null);
    try {
      const [p, r] = await Promise.allSettled([
        adminApi.listPayouts(token),
        adminApi.listPayoutRequests(token),
      ]);
      if (p.status === "fulfilled") setPayouts(p.value);
      else setPayoutsError(p.reason instanceof Error ? p.reason.message : "Não foi possível carregar os repasses");
      if (r.status === "fulfilled") setRequests(r.value);
      else
        setRequestsError(
          r.reason instanceof Error ? r.reason.message : "Não foi possível carregar os saques aguardando análise",
        );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  async function handleMarkPaid(id: string) {
    if (!token) return;
    setMessage(null);
    try {
      await adminApi.markPayoutPaid(token, id, notesById[id]);
      setMessage("Repasse marcado como pago");
      await load();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Não foi possível confirmar");
    }
  }

  async function handleApprove(req: PayoutRequestRow) {
    if (!token) return;
    // texto honesto (2026-10-12): aprovar só CRIA o repasse. O Pix só sai sozinho
    // com AUTO_TRANSFER_ENABLED=true (desligado por padrão) e chave Pix na conta
    // da casa; sem isso alguém transfere na mão e marca pago aqui embaixo.
    if (
      !window.confirm(
        `Aprovar saque de ${formatCents(req.amountCents)} para ${req.organization.name}? Isso cria o repasse. Sem o Pix automático ligado, faça a transferência e use "Marcar pago" na lista abaixo.`,
      )
    )
      return;
    setMessage(null);
    try {
      await adminApi.approvePayoutRequest(token, req.id);
      setMessage(
        'Saque aprovado — repasse criado. Sem o Pix automático ligado, transfira e use "Marcar pago" na lista abaixo.',
      );
      await load();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Não foi possível aprovar");
    }
  }

  async function handleReject(req: PayoutRequestRow) {
    if (!token) return;
    const note = window.prompt("Motivo da recusa (o produtor vê):") ?? undefined;
    if (note === undefined) return;
    setMessage(null);
    try {
      await adminApi.rejectPayoutRequest(token, req.id, note);
      await load();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Não foi possível recusar");
    }
  }

  return (
    <main>
      <Nav />
      <h1 className="mt-6 text-xl font-semibold">Repasses</h1>
      <p className="mt-1 text-sm text-gray-400">
        Aprovar um saque cria o repasse. O Pix só sai sozinho com o Pix automático ligado no
        servidor (AUTO_TRANSFER_ENABLED, desligado por padrão) e chave Pix na conta da casa; fora
        disso, transfira na mão e use “Marcar pago” — é o que muda o status para Pago no
        Financeiro do produtor.
      </p>

      <h2 className="mt-6 text-lg font-semibold">Saques aguardando análise</h2>
      <p className="mt-1 text-sm text-gray-400">
        Chegam aqui: 1º saque da casa, antecipações e valores acima do teto do contrato.
      </p>
      {loading ? (
        <p className="mt-3 text-sm text-gray-400">Carregando...</p>
      ) : requestsError ? (
        <div className="mt-3 rounded-2xl border border-rose-500/30 bg-rose-950/30 p-4 text-sm text-rose-300">
          <p>{requestsError}</p>
          <button type="button" onClick={load} className="mt-2 font-semibold underline">
            Tentar novamente
          </button>
        </div>
      ) : requests.length === 0 ? (
        <p className="mt-3 text-sm text-gray-500">Nenhuma solicitação pendente. 🎉</p>
      ) : (
        <div className="mt-3 space-y-2">
          {requests.map((req) => (
            <div
              key={req.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-white/10 bg-background-card p-4"
            >
              <div>
                <p className="font-semibold">
                  {req.organization.name} · {formatCents(req.amountCents)}
                </p>
                <p className="mt-0.5 text-xs text-gray-400">
                  {req.organization.settlementMode === "INSTANT" ? "Casa de confiança" : "Plano padrão"}
                  {req.anticipation
                    ? ` · ANTECIPAÇÃO (taxa ${formatCents(req.anticipationFeeCents)})`
                    : ""}
                  {" · "}
                  {new Date(req.createdAt).toLocaleString("pt-BR")}
                </p>
              </div>
              {isAdmin ? (
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => handleApprove(req)}
                    className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-black"
                  >
                    Aprovar
                  </button>
                  <button
                    type="button"
                    onClick={() => handleReject(req)}
                    className="rounded-md border border-white/15 px-4 py-2 text-sm font-semibold"
                  >
                    Recusar
                  </button>
                </div>
              ) : null}
            </div>
          ))}
        </div>
      )}

      {message ? <p className="mt-3 text-sm text-amber-300">{message}</p> : null}

      {loading ? (
        <p className="mt-6 text-gray-400">Carregando...</p>
      ) : payoutsError ? (
        <div className="mt-6 rounded-2xl border border-rose-500/30 bg-rose-950/30 p-4 text-sm text-rose-300">
          <p>{payoutsError}</p>
          <button type="button" onClick={load} className="mt-2 font-semibold underline">
            Tentar novamente
          </button>
        </div>
      ) : (
        <div className="mt-6 space-y-3">
          {payouts.map((payout) => (
            <div key={payout.id} className="rounded-lg bg-gray-800/60 p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium">{formatCents(payout.amountCents)}</p>
                  <p className="text-xs text-gray-400">
                    {payout.status} · pedido em {new Date(payout.requestedAt).toLocaleString("pt-BR")}
                  </p>
                  {payout.paidAt ? (
                    <p className="text-xs text-gray-500">pago em {new Date(payout.paidAt).toLocaleString("pt-BR")}</p>
                  ) : null}
                </div>
                {isAdmin && payout.status === "PENDING" ? (
                  <div className="flex gap-2">
                    <input
                      placeholder="nota (opcional)"
                      className="w-40 text-sm bg-slate-900/80 text-slate-100 placeholder-slate-500 border border-slate-700/60 rounded-lg px-3 py-1.5"
                      value={notesById[payout.id] ?? ""}
                      onChange={(e) => setNotesById((prev) => ({ ...prev, [payout.id]: e.target.value }))}
                    />
                    <button
                      type="button"
                      className="rounded-lg bg-brand px-3 text-sm font-semibold text-brand-dark"
                      onClick={() => handleMarkPaid(payout.id)}
                    >
                      Marcar pago
                    </button>
                  </div>
                ) : null}
              </div>
            </div>
          ))}
          {payouts.length === 0 ? <p className="text-gray-500">Nenhum repasse ainda.</p> : null}
        </div>
      )}
    </main>
  );
}

export default function PayoutsPage() {
  return (
    <AuthGuard>
      <PayoutsContent />
    </AuthGuard>
  );
}
