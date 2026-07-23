"use client";

import { useEffect, useState } from "react";
import { AuthGuard } from "@/components/AuthGuard";
import { Nav } from "@/components/Nav";
import { useAuth } from "@/lib/auth";
import { adminApi, type AuditLogEntry } from "@/lib/api";

function AuditContent() {
  const { token } = useAuth();
  const [entries, setEntries] = useState<AuditLogEntry[]>([]);
  const [entityType, setEntityType] = useState("");
  const [loading, setLoading] = useState(true);

  async function load() {
    if (!token) return;
    setLoading(true);
    try {
      setEntries(await adminApi.listAuditLogs(token, { entityType: entityType || undefined }));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  return (
    <main>
      <Nav />
      <h1 className="mt-6 text-xl font-semibold">Auditoria</h1>

      <div className="mt-4 flex gap-2">
        <select className="w-48" value={entityType} onChange={(e) => setEntityType(e.target.value)}>
          <option value="">Todos os tipos</option>
          <option value="organization">organization</option>
          <option value="event">event</option>
          <option value="order">order</option>
          <option value="ticket">ticket</option>
          <option value="payout">payout</option>
        </select>
        <button type="button" className="rounded-lg bg-brand px-4 text-sm font-semibold text-brand-dark" onClick={load}>
          Filtrar
        </button>
      </div>

      {loading ? (
        <p className="mt-6 text-gray-400">Carregando...</p>
      ) : (
        <table className="mt-6">
          <thead>
            <tr>
              <th>Ação</th>
              <th>Entidade</th>
              <th>Detalhes</th>
              <th>Quando</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <tr key={entry.id}>
                <td>{entry.action}</td>
                <td>
                  {entry.entityType}:{entry.entityId.slice(0, 8)}
                </td>
                <td className="max-w-xs truncate text-xs text-gray-400">
                  {entry.metadata ? JSON.stringify(entry.metadata) : "—"}
                </td>
                <td>{new Date(entry.createdAt).toLocaleString("pt-BR")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}

export default function AuditPage() {
  return (
    <AuthGuard>
      <AuditContent />
    </AuthGuard>
  );
}
