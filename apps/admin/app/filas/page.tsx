"use client";

import { useCallback, useEffect, useState } from "react";
import { AuthGuard } from "@/components/AuthGuard";
import { Nav } from "@/components/Nav";
import { useAuth } from "@/lib/auth";
import { adminApi, type QueuesHealth } from "@/lib/api";

function QueuesContent() {
  const { token } = useAuth();
  const [health, setHealth] = useState<QueuesHealth | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!token) return;
    setLoading(true);
    setError(null);
    adminApi
      .getQueuesHealth(token)
      .then(setHealth)
      .catch((err) => setError(err instanceof Error ? err.message : "Não foi possível carregar as filas"))
      .finally(() => setLoading(false));
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <main>
      <Nav />
      <div className="flex items-center justify-between">
        <h1 className="mt-6 text-xl font-semibold">Saúde das filas</h1>
        <button
          type="button"
          onClick={load}
          disabled={loading}
          className="mt-6 rounded-lg border border-slate-700/50 bg-slate-800/60 px-3 py-1.5 text-xs font-semibold text-slate-300 hover:bg-slate-800 disabled:opacity-50"
        >
          Atualizar
        </button>
      </div>

      {loading ? (
        <p className="mt-6 text-gray-400">Carregando...</p>
      ) : error ? (
        <div className="mt-6 rounded-2xl border border-rose-500/30 bg-rose-950/30 p-4 text-sm text-rose-300">
          <p>{error}</p>
          <button type="button" onClick={load} className="mt-2 font-semibold underline">
            Tentar novamente
          </button>
        </div>
      ) : health ? (
        <>
          <div className="mt-6 overflow-x-auto rounded-2xl border border-white/10 bg-slate-900/50">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-800/80 text-left text-xs uppercase text-slate-500">
                  <th className="p-3">Fila</th>
                  <th className="p-3">Ativos</th>
                  <th className="p-3">Concluídos</th>
                  <th className="p-3">Atrasados</th>
                  <th className="p-3">Falhados</th>
                  <th className="p-3">Esperando</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(health.queues).map(([name, stats]) => (
                  <tr key={name} className="border-b border-slate-800/50 last:border-0">
                    <td className="p-3 font-medium">{name}</td>
                    <td className="p-3">{stats.active}</td>
                    <td className="p-3">{stats.completed}</td>
                    <td className="p-3">{stats.delayed}</td>
                    <td className={`p-3 ${stats.failed > 0 ? "font-semibold text-rose-400" : ""}`}>{stats.failed}</td>
                    <td className="p-3">{stats.waiting}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h2 className="mt-8 text-sm font-medium text-gray-300">Eventos do outbox (por status)</h2>
          <div className="mt-2 overflow-x-auto rounded-2xl border border-white/10 bg-slate-900/50">
            <table className="w-full text-sm">
              <tbody>
                {Object.entries(health.outboxEvents).map(([status, count]) => (
                  <tr key={status} className="border-b border-slate-800/50 last:border-0">
                    <td className="p-3">{status}</td>
                    <td className="p-3">{count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
    </main>
  );
}

export default function QueuesPage() {
  return (
    <AuthGuard>
      <QueuesContent />
    </AuthGuard>
  );
}
