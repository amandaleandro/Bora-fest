"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AuthGuard } from "@/components/AuthGuard";
import { Nav } from "@/components/Nav";
import { useAuth } from "@/lib/auth";
import { adminApi, type WebhookDelivery } from "@/lib/api";

const PAGE_SIZE = 25;

function WebhooksContent() {
  const { token } = useAuth();
  const [webhooks, setWebhooks] = useState<WebhookDelivery[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [providerFilter, setProviderFilter] = useState("");
  const [page, setPage] = useState(1);

  const load = useCallback(() => {
    if (!token) return;
    setLoading(true);
    setError(null);
    adminApi
      .listWebhooks(token)
      .then(setWebhooks)
      .catch((err) => setError(err instanceof Error ? err.message : "Não foi possível carregar os webhooks"))
      .finally(() => setLoading(false));
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo(() => {
    if (!providerFilter) return webhooks;
    return webhooks.filter((w) => w.provider.toLowerCase().includes(providerFilter.toLowerCase()));
  }, [webhooks, providerFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageItems = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  return (
    <main>
      <Nav />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="mt-6 text-xl font-semibold">Webhooks recebidos</h1>
        <div className="mt-6 flex items-center gap-2">
          <input
            placeholder="Filtrar por provedor"
            value={providerFilter}
            onChange={(e) => {
              setProviderFilter(e.target.value);
              setPage(1);
            }}
            className="rounded-lg border border-slate-700/50 bg-slate-800/60 px-3 py-1.5 text-sm text-slate-200 placeholder:text-slate-500"
            aria-label="Filtrar webhooks por provedor"
          />
          <button
            type="button"
            onClick={load}
            disabled={loading}
            className="rounded-lg border border-slate-700/50 bg-slate-800/60 px-3 py-1.5 text-xs font-semibold text-slate-300 hover:bg-slate-800 disabled:opacity-50"
          >
            Atualizar
          </button>
        </div>
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
      ) : filtered.length === 0 ? (
        <p className="mt-6 text-sm text-slate-400">Nenhum webhook encontrado.</p>
      ) : (
        <>
          <div className="mt-6 overflow-x-auto rounded-2xl border border-white/10 bg-slate-900/50">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-800/80 text-left text-xs uppercase text-slate-500">
                  <th className="p-3">Provedor</th>
                  <th className="p-3">Evento</th>
                  <th className="p-3">Assinatura</th>
                  <th className="p-3">Status</th>
                  <th className="p-3">Recebido em</th>
                </tr>
              </thead>
              <tbody>
                {pageItems.map((w) => (
                  <tr key={w.id} className="border-b border-slate-800/50 last:border-0">
                    <td className="p-3">{w.provider}</td>
                    <td className="p-3">{w.eventType ?? "—"}</td>
                    <td className={`p-3 font-medium ${w.signatureValid ? "text-emerald-400" : "text-rose-400"}`}>
                      {w.signatureValid ? "válida" : "inválida"}
                    </td>
                    <td className="p-3">{w.status}</td>
                    <td className="p-3">{new Date(w.receivedAt).toLocaleString("pt-BR")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {totalPages > 1 ? (
            <div className="mt-4 flex items-center justify-between text-sm text-slate-400">
              <span>
                Página {currentPage} de {totalPages} ({filtered.length} registros)
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={currentPage <= 1}
                  onClick={() => setPage((p) => p - 1)}
                  className="rounded-lg border border-slate-700/50 bg-slate-800/60 px-3 py-1.5 text-xs font-semibold disabled:opacity-40"
                >
                  Anterior
                </button>
                <button
                  type="button"
                  disabled={currentPage >= totalPages}
                  onClick={() => setPage((p) => p + 1)}
                  className="rounded-lg border border-slate-700/50 bg-slate-800/60 px-3 py-1.5 text-xs font-semibold disabled:opacity-40"
                >
                  Próxima
                </button>
              </div>
            </div>
          ) : null}
        </>
      )}
    </main>
  );
}

export default function WebhooksPage() {
  return (
    <AuthGuard>
      <WebhooksContent />
    </AuthGuard>
  );
}
