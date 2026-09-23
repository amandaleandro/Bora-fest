"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, ApiError, type Order } from "../../lib/api";
import { storeApi } from "../../lib/store-api";
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
  /** reembolso solicitado e ainda em análise — badge âmbar + botão travado */
  refundRequested?: boolean;
}

interface StorePurchaseRow {
  publicToken: string;
  status: string;
  totalCents: number;
  houseName: string;
  houseSlug: string;
  itemsLabel: string;
  pickupCode: string | null;
  fulfillmentMethod: "PICKUP" | "DELIVERY";
  refundStatus: string | null;
  owned: boolean;
}

const STORE_STATUS_LABEL: Record<string, string> = {
  CREATED: "Pedido criado",
  PAYMENT_PENDING: "Aguardando Pix",
  PAID: "Preparando",
  READY: "Pronto para retirada",
  FULFILLED: "Retirado",
  CANCELED: "Cancelado",
  REFUNDED: "Reembolsado",
  CHARGEBACK: "Pagamento revertido",
};

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
  const [storeRows, setStoreRows] = useState<StorePurchaseRow[] | null>(null);
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
            refundRequested: o.refundRequested === true,
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

      let serverStoreRows: StorePurchaseRow[] = [];
      if (token) {
        try {
          const orders = await api.myStoreOrders(token);
          serverStoreRows = orders.map((order) => ({
            publicToken: order.publicToken,
            status: order.status,
            totalCents: order.totalCents,
            houseName: order.house.name,
            houseSlug: order.house.slug,
            itemsLabel: order.items
              .map((item) => `${item.quantity}× ${item.productName} · ${item.variantName}`)
              .join(", "),
            pickupCode: ["PAID", "READY", "FULFILLED"].includes(order.status) ? order.pickupCode : null,
            fulfillmentMethod: order.fulfillmentMethod,
            refundStatus: order.refundRequest?.status ?? null,
            owned: true,
          }));
        } catch {
          // mantém histórico local se a sessão não responder.
        }
      }

      let deviceStoreTokens: string[] = [];
      try {
        deviceStoreTokens = JSON.parse(localStorage.getItem("bf.storeOrders") ?? "[]");
      } catch {
        deviceStoreTokens = [];
      }
      const knownStore = new Set(serverStoreRows.map((row) => row.publicToken));
      const deviceStoreRows: StorePurchaseRow[] = [];
      for (const publicToken of deviceStoreTokens) {
        if (knownStore.has(publicToken)) continue;
        try {
          const order = await storeApi.getOrder(publicToken);
          deviceStoreRows.push({
            publicToken,
            status: order.status,
            totalCents: order.totalCents,
            houseName: order.house.name,
            houseSlug: order.house.slug,
            itemsLabel: order.items
              .map((item) => `${item.quantity}× ${item.productName} · ${item.variantName}`)
              .join(", "),
            pickupCode: order.pickupCode,
            fulfillmentMethod: order.fulfillmentMethod,
            refundStatus: null,
            owned: false,
          });
        } catch {
          // token local antigo/inválido: ignora.
        }
      }
      setStoreRows([...serverStoreRows, ...deviceStoreRows]);
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
      // card vira "em análise" na hora, sem esperar recarregar
      setRows((prev) => prev?.map((r) => (r.publicToken === token ? { ...r, refundRequested: true } : r)) ?? prev);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Não foi possível solicitar");
    }
  }

  async function requestStoreRefund(publicToken: string) {
    const token = localStorage.getItem("bf.token");
    if (!token) {
      setError("Entre e verifique seu e-mail para solicitar reembolso desta compra.");
      return;
    }
    setError(null);
    try {
      const created = await api.requestStoreRefund(
        publicToken,
        "Solicitado pelo comprador em Minhas compras",
        token,
      );
      setStoreRows((current) =>
        current?.map((row) =>
          row.publicToken === publicToken
            ? { ...row, refundStatus: created.status }
            : row,
        ) ?? current,
      );
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Não foi possível solicitar o reembolso da Loja");
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

      {rows === null || storeRows === null ? (
        <p className="mt-10 text-center text-[13px] text-muted">Carregando…</p>
      ) : rows.length === 0 && storeRows.length === 0 ? (
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
                  row.refundRequested && ["PAID", "FULFILLED"].includes(row.status) ? "bg-warning/10 text-warning" :
                  ["PAID", "FULFILLED"].includes(row.status) ? "bg-success/10 text-success" :
                  row.status === "PAYMENT_PENDING" ? "bg-warning/10 text-warning" : "bg-line text-muted"
                }`}>
                  {row.refundRequested && ["PAID", "FULFILLED"].includes(row.status)
                    ? "Reembolso em análise"
                    : row.ended ? "Evento encerrado" : STATUS_LABEL[row.status] ?? row.status}
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
                    onClick={async () => { try { await api.resendTickets(row.publicToken); alert(process.env.NEXT_PUBLIC_WA_DELIVERY === "on" ? "Ingressos reenviados por e-mail e WhatsApp." : "Ingressos reenviados por e-mail."); } catch (e) { alert(e instanceof ApiError ? e.message : "Não foi possível reenviar agora. Tente de novo em instantes."); } }}
                    className="flex-1 rounded-xl border-[1.5px] border-line-input py-2.5 text-[12px] font-bold"
                  >
                    Reenviar ingressos
                  </button>
                  {!row.refundRequested && (
                    <button onClick={() => setRefundFor(row.publicToken)} className="flex-1 rounded-xl border-[1.5px] border-line-input py-2.5 text-[12px] font-bold text-danger">
                      Reembolso
                    </button>
                  )}
                </div>
              )}
            </article>
          ))}
        </div>
      )}

      {storeRows && storeRows.length > 0 && (
        <section className="mt-8">
          <div className="flex items-end justify-between gap-3">
            <div>
              <p className="text-[11px] font-extrabold uppercase tracking-[.08em] text-primary">Loja da Casa</p>
              <h2 className="mt-1 text-[18px] font-extrabold">Produtos</h2>
            </div>
          </div>
          <div className="mt-4 space-y-4 lg:grid lg:grid-cols-2 lg:gap-4 lg:space-y-0">
            {storeRows.map((row) => (
              <article key={row.publicToken} className="rounded-2xl border border-line bg-surface p-4 lg:p-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[14px] font-extrabold lg:text-[15px]">{row.houseName}</p>
                    <p className="mt-1 text-[12px] font-semibold text-ink-soft">{row.itemsLabel}</p>
                  </div>
                  <span className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-bold ${
                    row.status === "READY"
                      ? "bg-success/10 text-success"
                      : row.status === "PAID"
                        ? "bg-primary/10 text-primary"
                        : row.status === "FULFILLED"
                          ? "bg-line text-muted"
                          : row.refundStatus
                            ? "bg-warning/10 text-warning"
                            : "bg-line text-muted"
                  }`}>
                    {row.refundStatus === "AWAITING_RETURN"
                      ? "Aguardando devolução"
                      : row.refundStatus === "PENDING"
                        ? "Reembolso em análise"
                        : row.status === "READY"
                          ? row.fulfillmentMethod === "DELIVERY"
                            ? "Pronto para entrega"
                            : "Pronto para retirada"
                          : row.status === "FULFILLED"
                            ? row.fulfillmentMethod === "DELIVERY"
                              ? "Entregue"
                              : "Retirado"
                            : STORE_STATUS_LABEL[row.status] ?? row.status}
                  </span>
                </div>
                <p className="mt-2 text-[15px] font-extrabold">{formatCents(row.totalCents)}</p>

                {row.pickupCode && ["PAID", "READY"].includes(row.status) && (
                  <div className="mt-3 rounded-xl bg-primary/5 p-3">
                    <p className="text-[10px] font-extrabold uppercase tracking-[.08em] text-primary">Código de retirada</p>
                    <p className="mt-1 font-mono text-[18px] font-black tracking-[.1em]">{row.pickupCode}</p>
                  </div>
                )}

                <div className="mt-3 flex flex-wrap gap-2">
                  <Link
                    href={`/loja/pedido/${row.publicToken}`}
                    className="flex-1 rounded-xl bg-primary/10 py-2.5 text-center text-[12px] font-bold text-primary"
                  >
                    Ver pedido
                  </Link>
                  {["PAID", "READY", "FULFILLED"].includes(row.status) && !row.refundStatus && (
                    row.owned ? (
                      <button
                        onClick={() => void requestStoreRefund(row.publicToken)}
                        className="flex-1 rounded-xl border-[1.5px] border-line-input py-2.5 text-[12px] font-bold text-danger"
                      >
                        Solicitar reembolso
                      </button>
                    ) : (
                      <Link
                        href="/entrar"
                        className="flex-1 rounded-xl border-[1.5px] border-line-input py-2.5 text-center text-[12px] font-bold"
                      >
                        Entrar para solicitar
                      </Link>
                    )
                  )}
                </div>
              </article>
            ))}
          </div>
        </section>
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
