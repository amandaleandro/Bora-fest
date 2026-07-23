"use client";

import { useEffect, useState } from "react";
import { AuthGuard } from "@/components/AuthGuard";
import { Nav } from "@/components/Nav";
import { useAuth } from "@/lib/auth";
import { financeApi, type Balance, type LedgerEntry } from "@/lib/api";

function formatCents(cents: number): string {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function FinanceContent({ orgId }: { orgId: string }) {
  const { token } = useAuth();
  const [balance, setBalance] = useState<Balance | null>(null);
  const [entries, setEntries] = useState<LedgerEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!token) return;
    Promise.all([financeApi.getBalance(token, orgId), financeApi.getLedger(token, orgId)])
      .then(([b, e]) => {
        setBalance(b);
        setEntries(e);
      })
      .finally(() => setLoading(false));
  }, [token, orgId]);

  return (
    <main>
      <Nav />
      <h1 className="mt-6 text-xl font-semibold">Financeiro</h1>

      {loading ? (
        <p className="mt-6 text-gray-400">Carregando...</p>
      ) : (
        <>
          <div className="mt-6 grid grid-cols-2 gap-4">
            <div className="rounded-lg bg-gray-800/60 p-4">
              <p className="text-xs text-gray-400">Saldo</p>
              <p className="mt-1 text-2xl font-bold">{formatCents(balance?.balanceCents ?? 0)}</p>
            </div>
            <div className="rounded-lg bg-gray-800/60 p-4">
              <p className="text-xs text-gray-400">Disponível para repasse</p>
              <p className="mt-1 text-2xl font-bold text-brand">
                {formatCents(balance?.availableForPayoutCents ?? 0)}
              </p>
            </div>
          </div>

          <h2 className="mt-8 text-sm font-medium text-gray-300">Lançamentos</h2>
          <table className="mt-2">
            <thead>
              <tr>
                <th>Tipo</th>
                <th>Valor</th>
                <th>Data</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.id}>
                  <td>{entry.type}</td>
                  <td className={entry.amountCents < 0 ? "text-red-400" : "text-green-400"}>
                    {formatCents(entry.amountCents)}
                  </td>
                  <td>{new Date(entry.createdAt).toLocaleString("pt-BR")}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {entries.length === 0 ? <p className="mt-4 text-gray-500">Nenhum lançamento ainda.</p> : null}
        </>
      )}
    </main>
  );
}

export default function FinancePage({ params }: { params: { orgId: string } }) {
  return (
    <AuthGuard>
      <FinanceContent orgId={params.orgId} />
    </AuthGuard>
  );
}
