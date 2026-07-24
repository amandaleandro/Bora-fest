"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AuthGuard } from "@/components/AuthGuard";
import { Nav } from "@/components/Nav";
import { useAuth } from "@/lib/auth";
import { dashboardApi, ordersApi, type Dashboard, type OrderSummary, type OrderDetail } from "@/lib/api";

function formatCents(cents: number): string {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

const STATUS_STYLES: Record<string, { bg: string; fg: string; label: string }> = {
  CREATED: { bg: "bg-line", fg: "text-muted", label: "Criado" },
  PAYMENT_PENDING: { bg: "bg-warning/10", fg: "text-warning", label: "Aguardando pagamento" },
  PAID: { bg: "bg-success/10", fg: "text-success", label: "Pago" },
  FULFILLED: { bg: "bg-success/10", fg: "text-success", label: "Concluído" },
  PARTIALLY_REFUNDED: { bg: "bg-warning/10", fg: "text-warning", label: "Reembolso parcial" },
  REFUNDED: { bg: "bg-danger/10", fg: "text-danger", label: "Reembolsado" },
  CHARGEBACK: { bg: "bg-danger/10", fg: "text-danger", label: "Chargeback" },
  EXPIRED: { bg: "bg-line", fg: "text-muted", label: "Expirado" },
  CANCELED: { bg: "bg-line", fg: "text-muted", label: "Cancelado" },
};

function StatusBadge({ status }: { status: string }) {
  const s = STATUS_STYLES[status] ?? { bg: "bg-line", fg: "text-muted", label: status };
  return <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${s.bg} ${s.fg}`}>{s.label}</span>;
}

function VendasContent({ eventId }: { eventId: string }) {
  const { token } = useAuth();
  const [tab, setTab] = useState<"pedidos" | "pdv">("pedidos");
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [orders, setOrders] = useState<OrderSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [detail, setDetail] = useState<OrderDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const [showRefund, setShowRefund] = useState(false);
  const [refundType, setRefundType] = useState<"total" | "partial">("total");
  const [refundAmount, setRefundAmount] = useState("");
  const [refundReason, setRefundReason] = useState("");
  const [refundError, setRefundError] = useState<string | null>(null);
  const [refundLoading, setRefundLoading] = useState(false);

  const pageSize = 20;

  // PDV
  const [pdvLotId, setPdvLotId] = useState("");
  const [pdvQty, setPdvQty] = useState("1");
  const [pdvBuyerName, setPdvBuyerName] = useState("");
  const [pdvBuyerDoc, setPdvBuyerDoc] = useState("");
  const [pdvBuyerEmail, setPdvBuyerEmail] = useState("");
  const [pdvError, setPdvError] = useState<string | null>(null);
  const [pdvSuccess, setPdvSuccess] = useState<string | null>(null);
  const [pdvLoading, setPdvLoading] = useState(false);

  async function loadOrders() {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const result = await ordersApi.list(eventId, token, {
        status: statusFilter || undefined,
        page,
        pageSize,
      });
      setOrders(result.orders);
      setTotal(result.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao carregar pedidos");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!token) return;
    dashboardApi.get(token, eventId).then(setDashboard).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, eventId]);

  useEffect(() => {
    loadOrders();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, eventId, page, statusFilter]);

  async function openDetail(orderId: string) {
    if (!token) return;
    setSelectedOrderId(orderId);
    setDetail(null);
    setDetailLoading(true);
    try {
      setDetail(await ordersApi.detail(orderId, token));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao carregar o pedido");
      setSelectedOrderId(null);
    } finally {
      setDetailLoading(false);
    }
  }

  function closeDetail() {
    setSelectedOrderId(null);
    setDetail(null);
    setShowRefund(false);
    setRefundAmount("");
    setRefundReason("");
    setRefundError(null);
  }

  async function submitRefund() {
    if (!token || !selectedOrderId || !detail) return;
    setRefundError(null);
    if (refundReason.trim().length < 3) {
      setRefundError("Informe um motivo (mínimo 3 caracteres)");
      return;
    }
    const amountCents =
      refundType === "total" ? undefined : Math.round(Number(refundAmount.replace(",", ".")) * 100);
    if (refundType === "partial" && (!amountCents || amountCents <= 0)) {
      setRefundError("Informe um valor válido para o reembolso parcial");
      return;
    }
    setRefundLoading(true);
    try {
      await ordersApi.refund(selectedOrderId, { amountCents, reason: refundReason }, token);
      await openDetail(selectedOrderId);
      setShowRefund(false);
      setRefundAmount("");
      setRefundReason("");
      await loadOrders();
    } catch (err) {
      setRefundError(err instanceof Error ? err.message : "Não foi possível reembolsar");
    } finally {
      setRefundLoading(false);
    }
  }

  async function submitPdvSale() {
    if (!token || !pdvLotId) return;
    setPdvError(null);
    setPdvSuccess(null);
    if (pdvBuyerName.trim().length < 2) {
      setPdvError("Informe o nome do comprador");
      return;
    }
    setPdvLoading(true);
    try {
      await ordersApi.createPdvSale(
        eventId,
        {
          ticketLotId: pdvLotId,
          quantity: Number(pdvQty || "1"),
          buyerName: pdvBuyerName,
          buyerDocument: pdvBuyerDoc || undefined,
          buyerEmail: pdvBuyerEmail || undefined,
        },
        token,
      );
      setPdvSuccess("Venda registrada com sucesso.");
      setPdvBuyerName("");
      setPdvBuyerDoc("");
      setPdvBuyerEmail("");
      setPdvQty("1");
      await loadOrders();
    } catch (err) {
      setPdvError(err instanceof Error ? err.message : "Não foi possível registrar a venda");
    } finally {
      setPdvLoading(false);
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const canRefund = detail && ["PAID", "FULFILLED", "PARTIALLY_REFUNDED"].includes(detail.status);

  return (
    <main>
      <Nav />
      <div className="mt-6 flex items-center justify-between">
        <h1 className="text-[22px] font-extrabold">
          {dashboard?.event.title ?? "Evento"} — Vendas
        </h1>
        <Link href={`/eventos/${eventId}`} className="text-sm font-bold text-primary">
          Gerenciar evento →
        </Link>
      </div>

      <div className="mt-5 flex gap-2">
        <button
          type="button"
          onClick={() => setTab("pedidos")}
          className={`rounded-xl px-4 py-2 text-[13px] font-bold ${tab === "pedidos" ? "bg-primary text-white" : "border border-line text-muted"}`}
        >
          Pedidos
        </button>
        <button
          type="button"
          onClick={() => setTab("pdv")}
          className={`rounded-xl px-4 py-2 text-[13px] font-bold ${tab === "pdv" ? "bg-primary text-white" : "border border-line text-muted"}`}
        >
          PDV (venda presencial)
        </button>
      </div>

      {error ? <p className="mt-4 text-[13px] font-semibold text-danger">{error}</p> : null}

      {tab === "pedidos" ? (
        <>
          <div className="mt-5 flex flex-wrap items-center gap-2">
            <select
              className="rounded-lg border border-line-input px-3 py-2 text-[13px]"
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter(e.target.value);
                setPage(1);
              }}
            >
              <option value="">Todos os status</option>
              {Object.entries(STATUS_STYLES).map(([key, s]) => (
                <option key={key} value={key}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>

          {loading ? (
            <p className="mt-6 text-muted">Carregando...</p>
          ) : orders.length === 0 ? (
            <div className="mt-6 rounded-2xl border border-line bg-surface p-10 text-center">
              <p className="text-[15px] font-extrabold">Nenhum pedido ainda</p>
              <p className="mt-1 text-[13px] font-semibold text-muted">
                Assim que houver vendas, os pedidos aparecem aqui.
              </p>
            </div>
          ) : (
            <>
              <div className="mt-4 overflow-hidden rounded-2xl border border-line bg-surface">
                <table className="w-full text-left text-[13px]">
                  <thead>
                    <tr className="border-b border-line bg-bg/60 text-[12px] font-bold text-muted">
                      <th className="px-5 py-3">Comprador</th>
                      <th className="px-5 py-3">Itens</th>
                      <th className="px-5 py-3">Status</th>
                      <th className="px-5 py-3">Total</th>
                      <th className="px-5 py-3">Criado em</th>
                      <th className="px-5 py-3">Pago em</th>
                    </tr>
                  </thead>
                  <tbody>
                    {orders.map((order) => (
                      <tr
                        key={order.id}
                        className="cursor-pointer border-b border-line last:border-0 hover:bg-bg/40"
                        onClick={() => openDetail(order.id)}
                      >
                        <td className="px-5 py-3.5">
                          <p className="font-bold">{order.contactName ?? "—"}</p>
                          <p className="text-[12px] text-muted">{order.contactEmail}</p>
                        </td>
                        <td className="px-5 py-3.5 text-muted">{order._count.tickets} ingresso(s)</td>
                        <td className="px-5 py-3.5">
                          <StatusBadge status={order.status} />
                        </td>
                        <td className="px-5 py-3.5 font-bold">{formatCents(order.totalCents)}</td>
                        <td className="px-5 py-3.5 text-muted">{formatDate(order.createdAt)}</td>
                        <td className="px-5 py-3.5 text-muted">{formatDate(order.paidAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="mt-3 flex items-center justify-between text-[12px] font-bold text-muted">
                <span>{total} pedido(s)</span>
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={page <= 1}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    className="rounded-lg border border-line px-3 py-1.5 disabled:opacity-40"
                  >
                    Anterior
                  </button>
                  <span>
                    Página {page} de {totalPages}
                  </span>
                  <button
                    type="button"
                    disabled={page >= totalPages}
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    className="rounded-lg border border-line px-3 py-1.5 disabled:opacity-40"
                  >
                    Próxima
                  </button>
                </div>
              </div>
            </>
          )}
        </>
      ) : (
        <section className="mt-5 max-w-xl rounded-2xl border border-line bg-surface p-5">
          <h2 className="text-[15px] font-extrabold">Registrar venda presencial</h2>
          <p className="mt-1 text-[12px] font-semibold text-muted">
            Venda offline (dinheiro/maquininha própria): o pedido já entra pago e os ingressos são emitidos
            imediatamente.
          </p>
          <div className="mt-4 space-y-2">
            <select
              className="w-full rounded-lg border border-line-input px-3 py-2 text-[13px]"
              value={pdvLotId}
              onChange={(e) => setPdvLotId(e.target.value)}
            >
              <option value="">Selecione o lote</option>
              {(dashboard?.lots ?? []).map((lot) => (
                <option key={lot.id} value={lot.id}>
                  {lot.typeName} — {lot.name} ({formatCents(lot.priceCents + lot.feeCents)})
                </option>
              ))}
            </select>
            <div className="flex gap-2">
              <input
                placeholder="Qtd"
                className="w-20 rounded-lg border border-line-input px-3 py-2 text-[13px]"
                value={pdvQty}
                onChange={(e) => setPdvQty(e.target.value)}
              />
              <input
                placeholder="Nome do comprador"
                className="flex-1 rounded-lg border border-line-input px-3 py-2 text-[13px]"
                value={pdvBuyerName}
                onChange={(e) => setPdvBuyerName(e.target.value)}
              />
            </div>
            <div className="flex gap-2">
              <input
                placeholder="CPF/documento (opcional)"
                className="flex-1 rounded-lg border border-line-input px-3 py-2 text-[13px]"
                value={pdvBuyerDoc}
                onChange={(e) => setPdvBuyerDoc(e.target.value)}
              />
              <input
                placeholder="E-mail (opcional)"
                className="flex-1 rounded-lg border border-line-input px-3 py-2 text-[13px]"
                value={pdvBuyerEmail}
                onChange={(e) => setPdvBuyerEmail(e.target.value)}
              />
            </div>
            {pdvError ? <p className="text-[13px] font-semibold text-danger">{pdvError}</p> : null}
            {pdvSuccess ? <p className="text-[13px] font-semibold text-success">{pdvSuccess}</p> : null}
            <button
              type="button"
              onClick={submitPdvSale}
              disabled={!pdvLotId || pdvLoading}
              className="rounded-lg bg-primary px-4 py-2.5 text-[13px] font-bold text-white disabled:opacity-40"
            >
              {pdvLoading ? "Registrando..." : "Registrar venda"}
            </button>
          </div>
        </section>
      )}

      {selectedOrderId ? (
        <div className="fixed inset-0 z-50 flex items-center justify-end bg-black/40" onClick={closeDetail}>
          <div
            className="h-full w-full max-w-md overflow-y-auto bg-surface p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h2 className="text-[17px] font-extrabold">Detalhe do pedido</h2>
              <button type="button" onClick={closeDetail} className="text-[13px] font-bold text-muted">
                Fechar ✕
              </button>
            </div>

            {detailLoading || !detail ? (
              <p className="mt-6 text-muted">Carregando...</p>
            ) : (
              <>
                <div className="mt-4">
                  <StatusBadge status={detail.status} />
                  <p className="mt-2 text-[15px] font-extrabold">{detail.contactName ?? "—"}</p>
                  <p className="text-[13px] text-muted">{detail.contactEmail}</p>
                  <p className="mt-1 text-[12px] text-muted">
                    Criado {formatDate(detail.createdAt)} · Pago {formatDate(detail.paidAt)}
                  </p>
                </div>

                <h3 className="mt-5 text-[13px] font-extrabold text-muted">Itens</h3>
                <div className="mt-2 space-y-2">
                  {detail.items.map((item) => (
                    <div key={item.id} className="rounded-lg bg-bg px-3 py-2.5 text-[13px]">
                      <p className="font-bold">
                        {item.ticketLot.ticketType.name} — {item.ticketLot.name}
                      </p>
                      <p className="text-muted">
                        {item.quantity}× {formatCents(item.priceCents + item.feeCents)}
                      </p>
                    </div>
                  ))}
                </div>

                <div className="mt-3 flex justify-between text-[13px] font-bold">
                  <span>Desconto</span>
                  <span>{formatCents(detail.discountCents)}</span>
                </div>
                <div className="mt-1 flex justify-between text-[15px] font-extrabold">
                  <span>Total</span>
                  <span>{formatCents(detail.totalCents)}</span>
                </div>

                <h3 className="mt-5 text-[13px] font-extrabold text-muted">Pagamento</h3>
                <div className="mt-2 space-y-2">
                  {detail.payments.length === 0 ? (
                    <p className="text-[13px] text-muted">Sem registro de pagamento (venda PDV).</p>
                  ) : (
                    detail.payments.map((p) => (
                      <div key={p.id} className="flex justify-between rounded-lg bg-bg px-3 py-2.5 text-[13px]">
                        <span className="font-bold">{p.method}</span>
                        <span>{formatCents(p.amountCents)}</span>
                        <span className="text-muted">{p.status}</span>
                      </div>
                    ))
                  )}
                </div>

                <h3 className="mt-5 text-[13px] font-extrabold text-muted">Ingressos</h3>
                <div className="mt-2 space-y-1.5">
                  {detail.tickets.map((t) => (
                    <p key={t.id} className="flex justify-between text-[13px]">
                      <span className="font-mono text-muted">{t.code}</span>
                      <span>{t.attendeeName ?? "—"}</span>
                      <span className="text-muted">{t.status}</span>
                    </p>
                  ))}
                </div>

                {canRefund ? (
                  <div className="mt-6 border-t border-line pt-4">
                    {!showRefund ? (
                      <button
                        type="button"
                        onClick={() => setShowRefund(true)}
                        className="w-full rounded-lg bg-danger px-4 py-2.5 text-[13px] font-bold text-white"
                      >
                        Reembolsar
                      </button>
                    ) : (
                      <div className="space-y-2">
                        <h3 className="text-[13px] font-extrabold">Reembolsar pedido</h3>
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => setRefundType("total")}
                            className={`flex-1 rounded-lg px-3 py-2 text-[13px] font-bold ${refundType === "total" ? "bg-primary text-white" : "border border-line text-muted"}`}
                          >
                            Total
                          </button>
                          <button
                            type="button"
                            onClick={() => setRefundType("partial")}
                            className={`flex-1 rounded-lg px-3 py-2 text-[13px] font-bold ${refundType === "partial" ? "bg-primary text-white" : "border border-line text-muted"}`}
                          >
                            Parcial
                          </button>
                        </div>
                        {refundType === "partial" ? (
                          <input
                            placeholder="Valor (R$)"
                            className="w-full rounded-lg border border-line-input px-3 py-2 text-[13px]"
                            value={refundAmount}
                            onChange={(e) => setRefundAmount(e.target.value)}
                          />
                        ) : null}
                        <textarea
                          placeholder="Motivo do reembolso"
                          className="w-full rounded-lg border border-line-input px-3 py-2 text-[13px]"
                          value={refundReason}
                          onChange={(e) => setRefundReason(e.target.value)}
                        />
                        {refundError ? <p className="text-[13px] font-semibold text-danger">{refundError}</p> : null}
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => setShowRefund(false)}
                            className="flex-1 rounded-lg border border-line px-3 py-2 text-[13px] font-bold text-muted"
                          >
                            Cancelar
                          </button>
                          <button
                            type="button"
                            onClick={submitRefund}
                            disabled={refundLoading}
                            className="flex-1 rounded-lg bg-danger px-3 py-2 text-[13px] font-bold text-white disabled:opacity-40"
                          >
                            {refundLoading ? "Processando..." : "Confirmar reembolso"}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                ) : null}
              </>
            )}
          </div>
        </div>
      ) : null}
    </main>
  );
}

export default function VendasPage({ params }: { params: { eventId: string } }) {
  return (
    <AuthGuard>
      <VendasContent eventId={params.eventId} />
    </AuthGuard>
  );
}
