"use client";

import { useCallback, useEffect, useState } from "react";
import { AuthGuard } from "@/components/AuthGuard";
import { Nav } from "@/components/Nav";
import { useAuth } from "@/lib/auth";
import { adminApi, type AdminRefundRequest } from "@/lib/api";

function formatCents(cents: number): string {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

/** BRL digitado (aceita vírgula) → centavos. Retorna null se vazio/ inválido. */
function parseBrlToCents(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const normalized = Number(trimmed.replace(/\./g, "").replace(",", "."));
  if (!Number.isFinite(normalized) || normalized <= 0) return null;
  return Math.round(normalized * 100);
}

const STATUS_LABEL: Record<string, string> = {
  PENDING: "Pendente",
  APPROVED: "Aprovado",
  REJECTED: "Recusado",
};

function RefundRequestsContent() {
  const { token, user } = useAuth();
  const [requests, setRequests] = useState<AdminRefundRequest[]>([]);
  const [statusFilter, setStatusFilter] = useState<string>("PENDING");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [amountById, setAmountById] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const isAdmin = user?.platformRole === "ADMIN";

  const load = useCallback(() => {
    if (!token) return;
    setLoading(true);
    setError(null);
    adminApi
      .listRefundRequests(token, statusFilter || undefined)
      .then(setRequests)
      .catch((err) =>
        setError(err instanceof Error ? err.message : "Não foi possível carregar os reembolsos"),
      )
      .finally(() => setLoading(false));
  }, [token, statusFilter]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleApprove(req: AdminRefundRequest) {
    if (!token) return;
    const raw = amountById[req.id] ?? "";
    const amountCents = parseBrlToCents(raw);
    if (raw.trim() && amountCents === null) {
      setMessage("Valor parcial inválido — deixe em branco para estorno total");
      return;
    }
    if (amountCents !== null && amountCents > req.order.totalCents) {
      setMessage(
        `Valor parcial (${formatCents(amountCents)}) maior que o pedido (${formatCents(req.order.totalCents)})`,
      );
      return;
    }
    const label = amountCents !== null ? `parcial de ${formatCents(amountCents)}` : `total (${formatCents(req.order.totalCents)})`;
    if (
      !window.confirm(
        `Aprovar reembolso ${label} para ${req.order.contactName ?? req.order.contactEmail}? O estorno é disparado no gateway e não tem volta.`,
      )
    ) {
      return;
    }
    setMessage(null);
    setBusyId(req.id);
    try {
      await adminApi.approveRefundRequest(token, req.id, amountCents ?? undefined);
      setMessage("Reembolso aprovado — estorno enviado ao gateway");
      load();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Não foi possível aprovar o reembolso");
    } finally {
      setBusyId(null);
    }
  }

  async function handleReject(req: AdminRefundRequest) {
    if (!token) return;
    const note = window.prompt("Motivo da recusa (o comprador vê, mínimo 3 caracteres):") ?? "";
    if (note.trim().length === 0) return;
    if (note.trim().length < 3) {
      setMessage("O motivo da recusa precisa ter ao menos 3 caracteres");
      return;
    }
    setMessage(null);
    setBusyId(req.id);
    try {
      await adminApi.rejectRefundRequest(token, req.id, note.trim());
      setMessage("Reembolso recusado");
      load();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Não foi possível recusar o reembolso");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <main>
      <Nav />
      <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">Reembolsos</h1>
        <div className="flex items-center gap-2">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="rounded-lg border border-slate-700/50 bg-slate-800/60 px-3 py-1.5 text-sm text-slate-200"
            aria-label="Filtrar por status"
          >
            <option value="PENDING">Pendentes</option>
            <option value="APPROVED">Aprovados</option>
            <option value="REJECTED">Recusados</option>
            <option value="">Todos</option>
          </select>
          <button
            type="button"
            onClick={load}
            disabled={loading}
            className="rounded-lg border border-slate-700/50 bg-slate-800/60 px-3 py-1.5 text-xs font-semibold text-slate-300 hover:bg-slate-800 disabled:opacity-50"
          >
            Atualizar
          </button>
        </div>
      </div>

      <p className="mt-1 text-sm text-gray-400">
        Pedidos de reembolso feitos pelo comprador. Nos eventos de casas no repasse padrão, quem
        analisa é a BoraFest — aprovar dispara o estorno de verdade no gateway.
      </p>

      {!isAdmin ? (
        <p className="mt-3 rounded-lg border border-white/10 bg-slate-800/40 p-3 text-xs text-slate-400">
          Você está como SUPPORT: pode acompanhar a fila, mas aprovar/recusar reembolso é ação de
          ADMIN.
        </p>
      ) : null}

      {message ? <p className="mt-3 text-sm text-amber-300">{message}</p> : null}

      {loading ? (
        <p className="mt-6 text-gray-400">Carregando...</p>
      ) : error ? (
        <div className="mt-6 rounded-2xl border border-rose-500/30 bg-rose-950/30 p-4 text-sm text-rose-300">
          <p>{error}</p>
          <button type="button" onClick={load} className="mt-2 font-semibold underline">
            Tentar novamente
          </button>
        </div>
      ) : requests.length === 0 ? (
        <p className="mt-6 text-sm text-slate-400">
          {statusFilter === "PENDING" ? "Nenhum reembolso pendente. 🎉" : "Nenhum reembolso encontrado."}
        </p>
      ) : (
        <div className="mt-6 space-y-3">
          {requests.map((req) => {
            const pending = req.status === "PENDING";
            return (
              <div
                key={req.id}
                className="rounded-lg border border-white/10 bg-gray-800/60 p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold">
                      {req.order.contactName ?? req.order.contactEmail} ·{" "}
                      {formatCents(req.order.totalCents)}
                    </p>
                    <p className="mt-0.5 text-xs text-gray-400">
                      Pedido {req.order.status} · token {req.order.publicToken} ·{" "}
                      {new Date(req.requestedAt).toLocaleString("pt-BR")}
                    </p>
                    <p className="mt-1 text-sm text-gray-300">Motivo: {req.reason}</p>
                    {req.resolutionNote ? (
                      <p className="mt-1 text-xs text-gray-500">Resolução: {req.resolutionNote}</p>
                    ) : null}
                  </div>
                  <span
                    className={`rounded-full px-3 py-1 text-xs font-semibold ${
                      req.status === "APPROVED"
                        ? "bg-emerald-500/15 text-emerald-300"
                        : req.status === "REJECTED"
                          ? "bg-rose-500/15 text-rose-300"
                          : "bg-amber-500/15 text-amber-300"
                    }`}
                  >
                    {STATUS_LABEL[req.status] ?? req.status}
                  </span>
                </div>

                {pending && isAdmin ? (
                  <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-gray-700 pt-3">
                    <input
                      placeholder="valor parcial (vazio = total)"
                      className="w-48 text-sm bg-slate-900/80 text-slate-100 placeholder-slate-500 border border-slate-700/60 rounded-lg px-3 py-2"
                      value={amountById[req.id] ?? ""}
                      onChange={(e) =>
                        setAmountById((prev) => ({ ...prev, [req.id]: e.target.value }))
                      }
                    />
                    <button
                      type="button"
                      disabled={busyId === req.id}
                      onClick={() => handleApprove(req)}
                      className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-brand-dark disabled:opacity-50"
                    >
                      Aprovar e estornar
                    </button>
                    <button
                      type="button"
                      disabled={busyId === req.id}
                      onClick={() => handleReject(req)}
                      className="rounded-lg border border-white/15 px-4 py-2 text-sm font-semibold disabled:opacity-50"
                    >
                      Recusar
                    </button>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </main>
  );
}

export default function RefundRequestsPage() {
  return (
    <AuthGuard>
      <RefundRequestsContent />
    </AuthGuard>
  );
}
