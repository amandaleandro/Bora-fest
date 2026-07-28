"use client";

import { useEffect, useState } from "react";
import { GuardedPanelShell } from "@/components/PanelShell";
import { useAuth } from "@/lib/auth";
import { financeApi, type OrgRefundRequest } from "@/lib/api";

function formatCents(cents: number): string {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const STATUS_BADGE: Record<OrgRefundRequest["status"], { cls: string; label: string }> = {
  PENDING: { cls: "bg-warning/10 text-warning", label: "Aguardando análise" },
  APPROVED: { cls: "bg-success/10 text-success", label: "Reembolsado" },
  REJECTED: { cls: "bg-danger/10 text-danger", label: "Recusado" },
};

function RefundsContent({ orgId }: { orgId: string }) {
  const { token } = useAuth();
  const [requests, setRequests] = useState<OrgRefundRequest[]>([]);
  const [instant, setInstant] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  async function load() {
    if (!token) return;
    setLoading(true);
    try {
      const [list, balance] = await Promise.all([
        financeApi.listRefundRequests(token, orgId),
        financeApi.getBalance(token, orgId),
      ]);
      setRequests(list);
      setInstant(balance.settlementMode === "INSTANT");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Não foi possível carregar");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, orgId]);

  async function handleApprove(request: OrgRefundRequest) {
    if (!token) return;
    if (
      !window.confirm(
        `Reembolsar ${formatCents(request.order.totalCents)} para ${request.order.contactEmail}? O valor sai do saldo da sua organização e os ingressos do pedido são cancelados.`,
      )
    ) {
      return;
    }
    setBusyId(request.id);
    setMessage(null);
    try {
      await financeApi.approveRefundRequest(token, orgId, request.id);
      setMessage("Reembolso executado — o comprador recebe pelo mesmo meio de pagamento.");
      await load();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Não foi possível reembolsar");
    } finally {
      setBusyId(null);
    }
  }

  async function handleReject(request: OrgRefundRequest) {
    if (!token || !note.trim()) return;
    setBusyId(request.id);
    setMessage(null);
    try {
      await financeApi.rejectRefundRequest(token, orgId, request.id, note.trim());
      setRejectingId(null);
      setNote("");
      await load();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Não foi possível recusar");
    } finally {
      setBusyId(null);
    }
  }

  const pending = requests.filter((r) => r.status === "PENDING");
  const resolved = requests.filter((r) => r.status !== "PENDING");

  return (
    <>
      {instant === false ? (
        <p className="mt-2 rounded-[14px] border border-line bg-surface p-4 text-[13px] font-semibold text-muted">
          No seu plano de repasse atual, quem analisa e executa os reembolsos é a BoraFest — você
          acompanha tudo aqui. No repasse instantâneo, a análise passa a ser sua.
        </p>
      ) : null}
      {message ? <p className="mt-3 text-[13px] font-semibold text-brand">{message}</p> : null}

      {loading ? (
        <p className="mt-4 text-[13px] font-semibold text-muted">Carregando…</p>
      ) : requests.length === 0 ? (
        <p className="mt-4 text-[13px] font-semibold text-muted">
          Nenhum pedido de reembolso até agora. 🎉
        </p>
      ) : (
        <div className="mt-4 space-y-3">
          {[...pending, ...resolved].map((request) => {
            const badge = STATUS_BADGE[request.status];
            return (
              <div key={request.id} className="rounded-[18px] border border-line bg-surface p-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-[14px] font-extrabold">
                      {request.order.contactName ?? request.order.contactEmail} ·{" "}
                      {formatCents(request.order.totalCents)}
                    </p>
                    <p className="mt-0.5 text-[12px] font-semibold text-muted">
                      {request.order.event.title} · pedido #{request.order.publicToken.slice(0, 8).toUpperCase()} ·{" "}
                      {formatDate(request.requestedAt)}
                    </p>
                  </div>
                  <span className={`rounded-full px-3 py-1 text-[11.5px] font-bold ${badge.cls}`}>
                    {badge.label}
                  </span>
                </div>
                <p className="mt-2 text-[13px] text-ink-soft">
                  <span className="font-bold">Motivo:</span> {request.reason}
                </p>
                {request.resolutionNote ? (
                  <p className="mt-1 text-[12.5px] font-semibold text-muted">
                    Resposta: {request.resolutionNote}
                  </p>
                ) : null}

                {request.status === "PENDING" && instant ? (
                  rejectingId === request.id ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      <input
                        className="min-w-[220px] flex-1"
                        placeholder="Explique a recusa para o comprador"
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                      />
                      <button
                        type="button"
                        className="rounded-[12px] bg-danger px-4 py-2 text-[13px] font-bold text-white disabled:opacity-40"
                        disabled={busyId === request.id || !note.trim()}
                        onClick={() => handleReject(request)}
                      >
                        Confirmar recusa
                      </button>
                      <button
                        type="button"
                        className="rounded-[12px] border border-line px-4 py-2 text-[13px] font-bold"
                        onClick={() => {
                          setRejectingId(null);
                          setNote("");
                        }}
                      >
                        Voltar
                      </button>
                    </div>
                  ) : (
                    <div className="mt-3 flex gap-2">
                      <button
                        type="button"
                        className="rounded-[12px] bg-success px-4 py-2 text-[13px] font-bold text-white disabled:opacity-40"
                        disabled={busyId === request.id}
                        onClick={() => handleApprove(request)}
                      >
                        {busyId === request.id ? "Reembolsando…" : "Aprovar e reembolsar"}
                      </button>
                      <button
                        type="button"
                        className="rounded-[12px] border border-line px-4 py-2 text-[13px] font-bold"
                        onClick={() => setRejectingId(request.id)}
                      >
                        Recusar
                      </button>
                    </div>
                  )
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

export default function RefundsPage({ params }: { params: { orgId: string } }) {
  return (
    <GuardedPanelShell title="Reembolsos" organizationId={params.orgId}>
      <RefundsContent orgId={params.orgId} />
    </GuardedPanelShell>
  );
}
