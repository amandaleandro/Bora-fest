"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import QRCode from "react-qr-code";
import { api, ApiError, type Order, type OrderTicketsResponse } from "../../../lib/api";
import { formatCents, formatDateTime } from "../../../lib/format";
import { Icon, paths } from "../../../components/icons";

function rememberOrder(token: string) {
  try {
    const list: string[] = JSON.parse(localStorage.getItem("bf.orders") ?? "[]");
    if (!list.includes(token)) localStorage.setItem("bf.orders", JSON.stringify([token, ...list].slice(0, 20)));
  } catch {
    /* ignore */
  }
}

export default function OrderPage({ params }: { params: { publicToken: string } }) {
  const { publicToken } = params;
  const [order, setOrder] = useState<Order | null>(null);
  const [ticketsData, setTicketsData] = useState<OrderTicketsResponse | null>(null);
  const [view, setView] = useState<"confirmacao" | "carteira">("confirmacao");
  const [resendMessage, setResendMessage] = useState<string | null>(null);
  const [transferFor, setTransferFor] = useState<string | null>(null);
  const [transferName, setTransferName] = useState("");
  const [transferEmail, setTransferEmail] = useState("");
  const [transferMsg, setTransferMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const o = await api.getOrderStatus(publicToken);
      setOrder(o);
      if (["PAID", "FULFILLED"].includes(o.status)) {
        const t = await api.getOrderTickets(publicToken);
        setTicketsData(t);
        rememberOrder(publicToken);
      }
    } catch {
      setOrder(null);
    }
  }, [publicToken]);

  useEffect(() => {
    load();
  }, [load]);

  // pendente: polling
  useEffect(() => {
    if (!order || !["CREATED", "PAYMENT_PENDING"].includes(order.status)) return;
    const id = setInterval(load, 3000);
    return () => clearInterval(id);
  }, [order, load]);

  async function resend() {
    setResendMessage(null);
    try {
      await api.resendTickets(publicToken);
      setResendMessage("Reenviado por e-mail e WhatsApp ✅");
    } catch (e) {
      setResendMessage(e instanceof ApiError ? e.message : "Não foi possível reenviar agora");
    }
  }

  async function doTransfer() {
    if (!transferFor) return;
    setTransferMsg(null);
    try {
      await api.transferTicket(transferFor, {
        orderPublicToken: publicToken,
        toName: transferName,
        toEmail: transferEmail,
      });
      setTransferMsg("Ingresso transferido! O QR antigo foi invalidado.");
      setTransferFor(null);
      setTransferName("");
      setTransferEmail("");
      load();
    } catch (e) {
      setTransferMsg(e instanceof ApiError ? e.message : "Falha na transferência");
    }
  }

  if (!order) {
    return <main className="flex min-h-dvh items-center justify-center text-[13px] text-muted">Carregando pedido…</main>;
  }

  const pending = ["CREATED", "PAYMENT_PENDING"].includes(order.status);
  const shortId = `#BF-${publicToken.slice(0, 8).toUpperCase()}`;

  // --- pendente ---
  if (pending) {
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center px-6 text-center">
        <div className="flex h-[92px] w-[92px] items-center justify-center rounded-full bg-warning/10 text-warning">
          <Icon d={paths.clock} size={44} />
        </div>
        <h1 className="mt-5 text-[22px] font-extrabold">Aguardando pagamento</h1>
        <span className="mt-2 rounded-full bg-warning/10 px-3 py-1.5 text-[12px] font-bold text-warning">Aguardando Pix</span>
        <div className="mt-6 w-full rounded-2xl border border-line bg-surface p-4 text-left">
          <p className="text-[12px] font-bold text-muted">Pedido {shortId}</p>
          <p className="mt-1 flex items-center justify-between text-[14px] font-semibold">
            <span>Total</span><span className="font-extrabold">{formatCents(order.totalCents)}</span>
          </p>
        </div>
        <p className="mt-4 text-[12px] font-medium text-muted">Esta página atualiza sozinha quando o pagamento cair.</p>
      </main>
    );
  }

  // --- carteira ---
  if (view === "carteira" && ticketsData) {
    return (
      <main className="px-5 pb-16 pt-6">
        <h1 className="text-[22px] font-extrabold">Seus ingressos</h1>
        <p className="mt-0.5 text-[13px] font-medium text-muted">
          {order.contactName ?? order.contactEmail} · {ticketsData.tickets.length} ingresso{ticketsData.tickets.length === 1 ? "" : "s"}
        </p>

        <div className="mt-5 space-y-6">
          {ticketsData.tickets.map((ticket) => (
            <article key={ticket.id} className="overflow-hidden rounded-3xl bg-surface shadow-card">
              <div className="bg-brand-gradient p-5 text-white">
                <p className="text-[16px] font-extrabold leading-tight">{ticketsData.event.title}</p>
                <p className="mt-1 text-[12px] font-semibold text-white/85">
                  {formatDateTime(ticketsData.event.startsAt)}
                </p>
              </div>
              <div className="ticket-notch border-t-2 border-dashed border-line px-5 pb-5 pt-6 text-center">
                <div className="mx-auto w-fit rounded-2xl border border-line bg-white p-3">
                  <QRCode value={ticket.qrToken} size={184} />
                </div>
                <p className="mt-3 text-[15px] font-extrabold">{ticket.attendeeName ?? order.contactName ?? "Portador"}</p>
                <p className="text-[12px] font-bold text-muted">{ticket.code}</p>
                <span className="mt-2 inline-block rounded-full bg-primary/10 px-3 py-1 text-[11px] font-bold text-primary">
                  {ticket.typeName} — {ticket.lotName}
                </span>
                <div className="mt-4 grid grid-cols-3 gap-2">
                  <button disabled className="rounded-xl bg-black py-2.5 text-[11px] font-bold text-white opacity-50">Wallet · breve</button>
                  <button onClick={resend} className="rounded-xl border-[1.5px] border-line-input py-2.5 text-[11px] font-bold text-ink">WhatsApp</button>
                  <button
                    onClick={() => { setTransferFor(ticket.id); setTransferMsg(null); }}
                    className="rounded-xl border-[1.5px] border-line-input py-2.5 text-[11px] font-bold text-ink"
                  >
                    Transferir
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>

        {resendMessage && <p className="mt-3 text-center text-[12px] font-semibold text-muted">{resendMessage}</p>}
        {transferMsg && <p className="mt-3 text-center text-[12px] font-semibold text-success">{transferMsg}</p>}

        <Link href="/" className="mt-8 block text-center text-[13px] font-bold text-primary">Explorar mais eventos</Link>

        {/* bottom sheet de transferência */}
        {transferFor && (
          <div className="fixed inset-0 z-20 mx-auto flex max-w-[430px] items-end bg-black/40" onClick={() => setTransferFor(null)}>
            <div className="w-full rounded-t-3xl bg-surface p-6" onClick={(e) => e.stopPropagation()}>
              <h2 className="text-[18px] font-extrabold">Transferir ingresso</h2>
              <p className="mt-1 text-[12px] font-medium text-muted">
                O QR atual é invalidado e um novo é gerado para a pessoa indicada.
              </p>
              <input
                value={transferName}
                onChange={(e) => setTransferName(e.target.value)}
                placeholder="Nome de quem vai usar"
                className="mt-4 h-[50px] w-full rounded-2xl border-[1.5px] border-line-input bg-surface px-4 text-[14px] font-medium outline-none focus:border-primary"
              />
              <input
                type="email"
                value={transferEmail}
                onChange={(e) => setTransferEmail(e.target.value)}
                placeholder="E-mail de quem vai usar"
                className="mt-3 h-[50px] w-full rounded-2xl border-[1.5px] border-line-input bg-surface px-4 text-[14px] font-medium outline-none focus:border-primary"
              />
              {transferMsg && <p className="mt-2 text-[12px] font-semibold text-danger">{transferMsg}</p>}
              <button
                onClick={doTransfer}
                disabled={transferName.length < 2 || !transferEmail.includes("@")}
                className="mt-4 h-14 w-full rounded-2xl bg-primary text-[15px] font-extrabold text-white shadow-cta disabled:bg-[#d9d2e8]"
              >
                Confirmar transferência
              </button>
            </div>
          </div>
        )}
      </main>
    );
  }

  // --- confirmação (aprovado) ---
  return (
    <main className="flex min-h-dvh flex-col bg-gradient-to-b from-emerald-50 to-bg px-6 pb-10 pt-16 text-center">
      <div className="mx-auto flex h-[92px] w-[92px] animate-pop items-center justify-center rounded-full bg-success text-white">
        <Icon d={paths.check} size={44} stroke={2.5} />
      </div>
      <h1 className="mt-5 text-[24px] font-extrabold">Pagamento aprovado!</h1>
      <span className="mx-auto mt-2 rounded-full bg-success/10 px-3 py-1.5 text-[12px] font-bold text-success">
        Pagamento confirmado
      </span>

      <div className="mt-6 rounded-2xl border border-line bg-surface p-4 text-left">
        <p className="text-[12px] font-bold text-muted">Pedido {shortId}</p>
        <div className="mt-2 space-y-1.5">
          {(order.items ?? []).map((item, i) => (
            <p key={i} className="flex justify-between text-[13px] font-semibold text-ink-soft">
              <span>{item.quantity}× ingresso</span>
              <span>{formatCents((item.priceCents + item.feeCents) * item.quantity)}</span>
            </p>
          ))}
          {(order.discountCents ?? 0) > 0 && (
            <p className="flex justify-between text-[13px] font-bold text-success">
              <span>Desconto</span><span>−{formatCents(order.discountCents!)}</span>
            </p>
          )}
          <p className="flex justify-between border-t border-line-divider pt-2 text-[15px] font-extrabold">
            <span>Total</span><span>{formatCents(order.totalCents)}</span>
          </p>
        </div>
      </div>

      <button
        onClick={() => setView("carteira")}
        className="mt-6 h-14 w-full rounded-2xl bg-primary text-[15px] font-extrabold text-white shadow-cta"
      >
        Ver meus ingressos
      </button>
      <Link href="/" className="mt-3 text-[13px] font-bold text-primary">Voltar ao início</Link>
    </main>
  );
}
