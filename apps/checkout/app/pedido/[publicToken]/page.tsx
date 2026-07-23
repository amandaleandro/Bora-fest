"use client";

import { useEffect, useState } from "react";
import QRCode from "react-qr-code";
import { api, type Order, type OrderTicket } from "@/lib/api";
import { formatCents } from "@/lib/format";

export default function OrderPage({ params }: { params: { publicToken: string } }) {
  const [order, setOrder] = useState<Order | null>(null);
  const [tickets, setTickets] = useState<OrderTicket[]>([]);
  const [loading, setLoading] = useState(true);
  const [resendMessage, setResendMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let interval: ReturnType<typeof setInterval> | undefined;

    async function load() {
      try {
        const current = await api.getOrderStatus(params.publicToken);
        if (cancelled) return;
        setOrder(current);

        if (current.status === "FULFILLED") {
          const ticketsResponse = await api.getOrderTickets(params.publicToken);
          if (!cancelled) setTickets(ticketsResponse.tickets);
          if (interval) clearInterval(interval);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    interval = setInterval(load, 4000);
    return () => {
      cancelled = true;
      if (interval) clearInterval(interval);
    };
  }, [params.publicToken]);

  async function handleResend() {
    setResendMessage(null);
    try {
      const result = await api.resendTickets(params.publicToken);
      setResendMessage(`Reenviado por ${result.channels.join(" e ")}`);
    } catch (err) {
      setResendMessage(err instanceof Error ? err.message : "Não foi possível reenviar");
    }
  }

  if (loading && !order) {
    return <main className="px-4 py-10 text-gray-400">Carregando...</main>;
  }

  if (!order) {
    return (
      <main className="px-4 py-10">
        <h1 className="text-xl font-semibold text-red-400">Pedido não encontrado</h1>
      </main>
    );
  }

  if (order.status !== "FULFILLED") {
    return (
      <main className="px-4 py-10">
        <h1 className="text-xl font-semibold">Aguardando confirmação do pagamento</h1>
        <p className="mt-2 text-gray-400">
          Status atual: <span className="font-medium text-gray-200">{order.status}</span>
        </p>
        <p className="mt-4 text-sm text-gray-500">Esta página atualiza sozinha assim que o pagamento sair.</p>
      </main>
    );
  }

  return (
    <main className="px-4 py-10">
      <h1 className="text-xl font-semibold">Seus ingressos</h1>
      <p className="mt-1 text-gray-400">
        {order.contactName ? `${order.contactName} · ` : ""}
        {order.contactEmail}
      </p>
      <p className="mt-1 text-sm text-gray-500">Total pago: {formatCents(order.totalCents)}</p>

      <div className="mt-8 space-y-6">
        {tickets.map((ticket) => (
          <div key={ticket.id} className="rounded-xl bg-gray-800/60 p-5">
            <div className="flex justify-center rounded-lg bg-white p-4">
              <QRCode value={ticket.qrToken} size={180} />
            </div>
            <div className="mt-4 text-center">
              <p className="text-lg font-semibold">{ticket.code}</p>
              <p className="text-sm text-gray-400">
                {ticket.typeName} — {ticket.lotName}
              </p>
              {ticket.attendeeName ? (
                <p className="mt-1 text-sm text-gray-300">{ticket.attendeeName}</p>
              ) : null}
              <p className="mt-1 text-xs text-gray-500">{ticket.status}</p>
            </div>
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={handleResend}
        className="mt-8 w-full rounded-lg bg-gray-800 px-6 py-3 text-sm font-medium text-gray-200"
      >
        Reenviar por e-mail/WhatsApp
      </button>
      {resendMessage ? <p className="mt-2 text-center text-sm text-gray-400">{resendMessage}</p> : null}
    </main>
  );
}
