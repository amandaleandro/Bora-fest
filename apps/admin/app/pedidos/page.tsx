"use client";

import { useState } from "react";
import { AuthGuard } from "@/components/AuthGuard";
import { Nav } from "@/components/Nav";
import { useAuth } from "@/lib/auth";
import { adminApi, type AdminOrder } from "@/lib/api";

function formatCents(cents: number): string {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function OrdersContent() {
  const { token, user } = useAuth();
  const [publicToken, setPublicToken] = useState("");
  const [email, setEmail] = useState("");
  const [orders, setOrders] = useState<AdminOrder[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [refundReason, setRefundReason] = useState<Record<string, string>>({});
  const isAdmin = user?.platformRole === "ADMIN";

  async function handleSearch() {
    if (!token || (!publicToken && !email)) return;
    setLoading(true);
    setMessage(null);
    try {
      setOrders(await adminApi.searchOrders(token, { publicToken: publicToken || undefined, email: email || undefined }));
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Erro na busca");
    } finally {
      setLoading(false);
    }
  }

  async function handleResend(orderPublicToken: string) {
    if (!token) return;
    setMessage(null);
    try {
      const result = await adminApi.resendOrder(token, orderPublicToken);
      setMessage(`Reenviado por ${result.channels.join(" e ")}`);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Não foi possível reenviar");
    }
  }

  async function handleRefund(publicTok: string) {
    if (!token) return;
    const reason = refundReason[publicTok];
    if (!reason) {
      setMessage("Informe o motivo do estorno");
      return;
    }
    setMessage(null);
    try {
      await adminApi.refundOrder(token, publicTok, { reason });
      setMessage("Estorno processado");
      await handleSearch();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Não foi possível estornar");
    }
  }

  return (
    <main>
      <Nav />
      <h1 className="mt-6 text-xl font-semibold">Buscar pedidos</h1>

      <div className="mt-4 flex gap-2">
        <input
          placeholder="Token público do pedido"
          className="flex-1"
          value={publicToken}
          onChange={(e) => setPublicToken(e.target.value)}
        />
        <input placeholder="ou e-mail do comprador" className="flex-1" value={email} onChange={(e) => setEmail(e.target.value)} />
        <button type="button" className="rounded-lg bg-brand px-4 text-sm font-semibold text-brand-dark" onClick={handleSearch}>
          Buscar
        </button>
      </div>

      {message ? <p className="mt-3 text-sm text-amber-300">{message}</p> : null}
      {loading ? <p className="mt-4 text-gray-400">Buscando...</p> : null}

      <div className="mt-6 space-y-3">
        {orders.map((order) => {
          const paidPayment = order.payments.find((p) => p.status === "PAID");
          return (
            <div key={order.id} className="rounded-lg bg-gray-800/60 p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium">
                    {order.contactName ?? order.contactEmail} — {formatCents(order.totalCents)}
                  </p>
                  <p className="text-xs text-gray-400">
                    {order.event.title} ({order.event.organization.name}) · {order.status}
                  </p>
                  <p className="text-xs text-gray-500">token: {order.publicToken}</p>
                </div>
                <button type="button" className="text-sm text-brand underline" onClick={() => handleResend(order.publicToken)}>
                  Reenviar ingresso
                </button>
              </div>

              {isAdmin && paidPayment ? (
                <div className="mt-3 flex gap-2 border-t border-gray-700 pt-3">
                  <input
                    placeholder="Motivo do estorno"
                    className="flex-1 text-sm"
                    value={refundReason[order.publicToken] ?? ""}
                    onChange={(e) =>
                      setRefundReason((prev) => ({ ...prev, [order.publicToken]: e.target.value }))
                    }
                  />
                  <button
                    type="button"
                    className="rounded-lg bg-red-900 px-3 text-sm text-red-200"
                    onClick={() => handleRefund(order.publicToken)}
                  >
                    Estornar
                  </button>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </main>
  );
}

export default function OrdersPage() {
  return (
    <AuthGuard>
      <OrdersContent />
    </AuthGuard>
  );
}
