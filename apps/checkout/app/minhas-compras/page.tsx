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

/** Pedidos lembrados neste aparelho (compra como convidado). */
async function loadDeviceOrders(skip: Set<string>): Promise<PurchaseRow[]> {
  let tokens: string[] = [];
  try {
    tokens = JSON.parse(localStorage.getItem("bf.orders") ?? "[]");
  } catch {
    return [];
  }
  const rows: PurchaseRow[] = [];
  for (const token of tokens) {
    if (skip.has(token)) continue;
    try {
      const order: Order = await api.getOrderStatus(token);
      rows.push({
        publicToken: token,
        status: order.status,
        totalCents: order.totalCents,
        eventTitle: "Pedido #BF-" + token.slice(0, 8).toUpperCase(),
        startsAt: null,
        itemsLabel: (order.items ?? []).map((i) => `${i.quantity}× ingresso`).join(", "),
        ended: false,
      });
    } catch {
      /* pedido inacessível — ignora */
    }
  }
  return rows;
}

export default function PurchasesPage() {
  const router = useRouter();
  const [rows, setRows] = useState<PurchaseRow[] | null>(null);
  const [refundFor, setRefundFor] = useState<string | null>(null);
  const [refundOk, setRefundOk] = useState<string | null>(null);
  const [refundReviewer, setRefundReviewer] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      const token = localStorage.getItem("bf.token");
      let serverRows: PurchaseRow[] = [];
      if (token) {
        try {
          const orders = await api.myOrders(token);
          serverRows = orders.map((o) => ({
            publicToken: o.publicToken,
            status: o.status,
            totalCents: o.totalCents,
            eventTitle: o.event.title,
            startsAt: o.event.startsAt,
            itemsLabel: o.items.map((i) => `${i.quantity}× ${i.ticketLot.name}`).join(", "),
            ended: new Date(o.event.endsAt).getTime() < Date.now(),
          }));
        } catch {
          /* sessão inválida ou API fora: sobra o que está no aparelho */
        }
      }
      // quem comprou como convidado e só depois entrou por OTP não aparece em
      // /v1/me/orders — por isso o aparelho é sempre consultado e as duas
      // fontes são unidas (sem repetir o mesmo pedido).
      const deviceRows = await loadDeviceOrders(new Set(serverRows.map((r) => r.publicToken)));
      setRows([...serverRows, ...deviceRows]);
    }
    load();
  }, []);

  async function requestRefund(token: string) {
    setError(null);
    try {
      const created = await api.requestRefund(token, "Solicitado pelo comprador no app");
      setRefundReviewer(created.reviewedBy ?? null);
      setRefundOk(token);
      setRefundFor(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Não foi possível solicitar");
    }
  }

  return (
    <main className="px-5 pb-16 pt-6 lg:mx-auto lg:max-w-[1160px] lg:px-6 lg:pb-14 lg:pt-8">
      <header className="flex items-center gap-3">
        <button onClick={() => router.back()} aria-label="Voltar" className="flex h-10 w-10 items-center justify-center rounded-full border border-line bg-surface lg:hidden"><Icon d={paths.back} /></button>
        <h1 className="text-[20px] font-extrabold lg:text-[24px]">Minhas compras</h1>
        <Link href="/perfil" className="ml-auto hidden text-[13px] font-bold text-primary lg:block">
          Minha conta
        </Link>
      </header>

      {rows === null ? (
        <p className="mt-10 text-center text-[13px] text-muted">Carregando…</p>
      ) : rows.length === 0 ? (
        <div className="mt-16 text-center lg:mt-10 lg:rounded-[22px] lg:border lg:border-line lg:bg-surface lg:py-16">
          <Icon d={paths.ticket} size={48} className="mx-auto text-muted-4" />
          <p className="mt-3 text-[15px] font-bold lg:text-[17px]">Nenhuma compra por aqui</p>
          <Link href="/" className="mt-2 inline-block text-[13px] font-bold text-primary">Explorar eventos</Link>
        </div>
      ) : (
        <div className="mt-5 space-y-4 lg:grid lg:grid-cols-2 lg:gap-4 lg:space-y-0">
          {rows.map((row) => (
            <article key={row.publicToken} className={`rounded-2xl border border-line bg-surface p-4 lg:p-5 ${row.ended ? "opacity-80" : ""}`}>
              <div className="flex items-center justify-between gap-2">
                <p className="text-[14px] font-extrabold lg:text-[15px]">{row.eventTitle}</p>
                <span className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-bold ${
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
                  Pedido de reembolso enviado para {refundReviewer ?? "análise"} — até 5 dias úteis
                  para resposta (CDC art. 49) ✅
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
        <div className="fixed inset-0 z-20 flex items-end justify-center bg-black/40 lg:items-center" onClick={() => setRefundFor(null)}>
          <div className="w-full max-w-[430px] rounded-t-3xl bg-surface p-6 lg:rounded-3xl" onClick={(e) => e.stopPropagation()}>
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
