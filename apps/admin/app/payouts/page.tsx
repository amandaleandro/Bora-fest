"use client";

import { useEffect, useState } from "react";
import { AuthGuard } from "@/components/AuthGuard";
import { Nav } from "@/components/Nav";
import { useAuth } from "@/lib/auth";
import { adminApi, type Payout } from "@/lib/api";

function formatCents(cents: number): string {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function PayoutsContent() {
  const { token, user } = useAuth();
  const [payouts, setPayouts] = useState<Payout[]>([]);
  const [loading, setLoading] = useState(true);
  const [notesById, setNotesById] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const isAdmin = user?.platformRole === "ADMIN";

  async function load() {
    if (!token) return;
    setLoading(true);
    try {
      setPayouts(await adminApi.listPayouts(token));
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

  return (
    <main>
      <Nav />
      <h1 className="mt-6 text-xl font-semibold">Repasses</h1>
      <p className="mt-1 text-sm text-gray-400">
        A transferência bancária ainda é manual — este botão só confirma que ela já foi feita.
      </p>

      {message ? <p className="mt-3 text-sm text-amber-300">{message}</p> : null}

      {loading ? (
        <p className="mt-6 text-gray-400">Carregando...</p>
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
                      className="w-40 text-sm"
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
