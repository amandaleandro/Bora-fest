"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, ApiError, type Order } from "../../lib/api";
import { formatCents, formatDateTime } from "../../lib/format";
import { Icon, paths } from "../../components/icons";

interface PurchaseRow {
  publicToken: string;
  status: string;
  totalCents: number;
  eventTitle: string;
  startsAt: string | null;
  itemsLabel: string;
  ended: boolean;
}

const STATUS_LABEL: Record<string, string> = {
  FULFILLED: "Pagamento aprovado",
  PAID: "Pagamento aprovado",
  PAYMENT_PENDING: "Aguardando pagamento",
  EXPIRED: "Expirado",
  REFUNDED: "Reembolsado",
  PARTIALLY_REFUNDED: "Parcialmente reembolsado",
  CANCELED: "Cancelado",
};

export default function PurchasesPage() {
  const router = useRouter();
  const [rows, setRows] = useState<PurchaseRow[] | null>(null);
  const [refundFor, setRefundFor] = useState<string | null>(null);
  const [refundOk, setRefundOk] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      const token = localStorage.getItem("bf.token");
      try {
        if (token) {
          const orders = await api.myOrders(token);
          setRows(
            orders.map((o) => ({
              publicToken: o.publicToken,
              status: o.status,
              totalCents: o.totalCents,
              eventTitle: o.event.title,
              startsAt: o.event.startsAt,
              itemsLabel: o.items.map((i) => `${i.quantity}× ${i.ticketLot.name}`).join(", "),
              ended: new Date(o.event.endsAt).getTime() < Date.now(),
            })),
          );
          return;
        }
        // convidado: pedidos lembrados neste aparelho
        const tokens: string[] = JSON.parse(localStorage.getItem("bf.orders") ?? "[]");
        const loaded: PurchaseRow[] = [];
        for (const t of tokens) {
          try {
            const o: Order = await api.getOrderStatus(t);
            loaded.push({
              publicToken: t,
              status: o.status,
              totalCents: o.totalCents,
              eventTitle: "Pedido " + t.slice(0, 8).toUpperCase(),
              startsAt: null,
              itemsLabel: (o.items ?? []).map((i) => `${i.quantity}× ingresso`).join(", "),
              ended: false,
            });
          } catch {
            /* pedido inacessível — ignora */
          }
        }
        setRows(loaded);
      } catch {
        setRows([]);
      }
    }
    load();
  }, []);

  async function requestRefund(token: string) {
    setError(null);
    try {
      await api.requestRefund(token, "Solicitado pelo comprador no app");
      setRefundOk(token);
      setRefundFor(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Não foi possível solicitar");
    }
  }

  return (
    <main className="px-5 pb-16 pt-6">
      <header className="flex items-center gap-3">
        <button onClick={() => router.back()} aria-label="Voltar" className="flex h-10 w-10 items-center justify-center rounded-full border border-line bg-surface"><Icon d={paths.back} /></button>
        <h1 className="text-[20px] font-extrabold">Minhas compras</h1>
      </header>

      {rows === null ? (
        <p className="mt-10 text-center text-[13px] text-muted">Carregando…</p>
      ) : rows.length === 0 ? (
        <div className="mt-16 text-center">
          <Icon d={paths.ticket} size={48} className="mx-auto text-muted-4" />
          <p className="mt-3 text-[15px] font-bold">Nenhuma compra por aqui</p>
          <Link href="/" className="mt-2 inline-block text-[13px] font-bold text-primary">Explorar eventos</Link>
        </div>
      ) : (
        <div className="mt-5 space-y-4">
          {rows.map((row) => (
            <article key={row.publicToken} className={`rounded-2xl border border-line bg-surface p-4 ${row.ended ? "opacity-80" : ""}`}>
              <div className="flex items-center justify-between">
                <p className="text-[14px] font-extrabold">{row.eventTitle}</p>
                <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold ${
                  ["PAID", "FULFILLED"].includes(row.status) ? "bg-success/10 text-success" :
                  row.status === "PAYMENT_PENDING" ? "bg-warning/10 text-warning" : "bg-line text-muted"
                }`}>
                  {row.ended ? "Evento encerrado" : STATUS_LABEL[row.status] ?? row.status}
                </span>
              </div>
              {row.startsAt && <p className="mt-0.5 text-[12px] font-medium text-muted">{formatDateTime(row.startsAt)}</p>}
              <p className="mt-1 text-[12px] font-semibold text-ink-soft">{row.itemsLabel}</p>
              <p className="mt-1 text-[15px] font-extrabold">{formatCents(row.totalCents)}</p>

              {refundOk === row.publicToken && (
                <div className="mt-3 rounded-xl bg-success/10 p-3 text-[12px] font-bold text-success">
                  Pedido de reembolso registrado (CDC art. 49 — até 5 dias úteis para resposta) ✅
                </div>
              )}

              {["PAID", "FULFILLED"].includes(row.status) && !row.ended && (
                <div className="mt-3 flex gap-2">
                  <Link href={`/pedido/${row.publicToken}`} className="flex-1 rounded-xl bg-primary/10 py-2.5 text-center text-[12px] font-bold text-primary">
                    Ver ingressos
                  </Link>
                  <button
                    onClick={async () => { try { await api.resendTickets(row.publicToken); alert("Reenviado!"); } catch { alert("Limite de reenvio atingido"); } }}
                    className="flex-1 rounded-xl border-[1.5px] border-line-input py-2.5 text-[12px] font-bold"
                  >
                    Reenviar ingressos
                  </button>
                  <button onClick={() => setRefundFor(row.publicToken)} className="flex-1 rounded-xl border-[1.5px] border-line-input py-2.5 text-[12px] font-bold text-danger">
                    Reembolso
                  </button>
                </div>
              )}
            </article>
          ))}
        </div>
      )}

      {error && <p className="mt-3 text-center text-[12px] font-semibold text-danger">{error}</p>}

      {refundFor && (
        <div className="fixed inset-0 z-20 mx-auto flex max-w-[430px] items-end bg-black/40" onClick={() => setRefundFor(null)}>
          <div className="w-full rounded-t-3xl bg-surface p-6" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-[18px] font-extrabold">Solicitar reembolso</h2>
            <p className="mt-2 text-[13px] font-medium text-muted">
              Compras feitas há até 7 dias têm reembolso garantido (CDC art. 49). O produtor responde em
              até 5 dias úteis e os ingressos são cancelados quando o estorno for aprovado.
            </p>
            <button onClick={() => requestRefund(refundFor)} className="mt-5 h-14 w-full rounded-2xl bg-danger text-[15px] font-extrabold text-white">
              Confirmar solicitação
            </button>
            <button onClick={() => setRefundFor(null)} className="mt-2 h-12 w-full rounded-2xl border-[1.5px] border-line-input text-[14px] font-bold">
              Cancelar
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
