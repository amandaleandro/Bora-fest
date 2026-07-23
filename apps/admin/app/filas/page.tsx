"use client";

import { useEffect, useState } from "react";
import { AuthGuard } from "@/components/AuthGuard";
import { Nav } from "@/components/Nav";
import { useAuth } from "@/lib/auth";
import { adminApi, type QueuesHealth } from "@/lib/api";

function QueuesContent() {
  const { token } = useAuth();
  const [health, setHealth] = useState<QueuesHealth | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!token) return;
    adminApi
      .getQueuesHealth(token)
      .then(setHealth)
      .finally(() => setLoading(false));
  }, [token]);

  return (
    <main>
      <Nav />
      <h1 className="mt-6 text-xl font-semibold">Saúde das filas</h1>

      {loading || !health ? (
        <p className="mt-6 text-gray-400">Carregando...</p>
      ) : (
        <>
          <table className="mt-6">
            <thead>
              <tr>
                <th>Fila</th>
                <th>Ativos</th>
                <th>Concluídos</th>
                <th>Atrasados</th>
                <th>Falhados</th>
                <th>Esperando</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(health.queues).map(([name, stats]) => (
                <tr key={name}>
                  <td>{name}</td>
                  <td>{stats.active}</td>
                  <td>{stats.completed}</td>
                  <td>{stats.delayed}</td>
                  <td className={stats.failed > 0 ? "text-red-400" : undefined}>{stats.failed}</td>
                  <td>{stats.waiting}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <h2 className="mt-8 text-sm font-medium text-gray-300">Eventos do outbox (por status)</h2>
          <table className="mt-2">
            <tbody>
              {Object.entries(health.outboxEvents).map(([status, count]) => (
                <tr key={status}>
                  <td>{status}</td>
                  <td>{count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
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
