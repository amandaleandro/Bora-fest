"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AuthGuard } from "@/components/AuthGuard";
import { useAuth } from "@/lib/auth";
import { dashboardApi, type Participant } from "@/lib/api";

const STATUS_STYLES: Record<string, { bg: string; fg: string; label: string }> = {
  ISSUED: { bg: "bg-success/10", fg: "text-success", label: "Emitido" },
  ACTIVE: { bg: "bg-success/10", fg: "text-success", label: "Ativo" },
  CHECKED_IN: { bg: "bg-success/10", fg: "text-success", label: "Check-in feito" },
  TRANSFERRED: { bg: "bg-line", fg: "text-muted", label: "Transferido" },
  CANCELED: { bg: "bg-danger/10", fg: "text-danger", label: "Cancelado" },
  REFUNDED: { bg: "bg-danger/10", fg: "text-danger", label: "Reembolsado" },
};

/**
 * LISTA EM PÁGINAS (2026-10-12): a tela carregava todos os ingressos do evento
 * de uma vez e filtrava no navegador — num evento grande, milhares de linhas
 * a cada abertura. Agora vem por página (padrão da lista de pedidos de
 * Vendas) e a busca roda no servidor, senão só acharia quem está na página.
 */
const PAGE_SIZE = 50;

function ParticipantsContent({ eventId }: { eventId: string }) {
  const { token } = useAuth();
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  // o termo de fato buscado: espera a digitação parar, senão seria uma
  // consulta por tecla
  const [busca, setBusca] = useState("");

  useEffect(() => {
    const t = setTimeout(() => {
      const termo = query.trim();
      if (termo !== busca) {
        setBusca(termo);
        setPage(1);
      }
    }, 350);
    return () => clearTimeout(t);
  }, [query, busca]);

  useEffect(() => {
    if (!token) return;
    let vivo = true;
    setLoading(true);
    setError(null);
    dashboardApi
      .participants(token, eventId, { page, pageSize: PAGE_SIZE, q: busca || undefined })
      .then((r) => {
        if (!vivo) return;
        // a lista encolheu e a página aberta ficou depois do fim: volta para
        // a última, em vez de dizer "nenhum ingresso" com ingresso emitido
        if (r.participants.length === 0 && r.total > 0 && page > 1) {
          setPage(Math.max(1, Math.ceil(r.total / PAGE_SIZE)));
          return;
        }
        setParticipants(r.participants);
        setTotal(r.total);
      })
      .catch((err) => {
        if (vivo) setError(err instanceof Error ? err.message : "Não foi possível carregar os participantes");
      })
      .finally(() => {
        if (vivo) setLoading(false);
      });
    return () => {
      vivo = false;
    };
  }, [token, eventId, attempt, page, busca]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  async function handleExport() {
    if (!token) return;
    setExporting(true);
    setExportError(null);
    try {
      await dashboardApi.downloadParticipantsCsv(token, eventId);
    } catch (err) {
      // falha do CSV não pode passar calada (2026-10-12): o botão só voltava
      setExportError(err instanceof Error ? err.message : "Não foi possível exportar");
    } finally {
      setExporting(false);
    }
  }

  return (
    <main>
      <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-extrabold">Participantes</h1>
          <Link href={`/eventos/${eventId}`} className="text-[13px] font-bold text-primary">
            Voltar ao evento →
          </Link>
        </div>
        <button type="button" onClick={handleExport} disabled={exporting} className="btn-primary">
          {exporting ? "Exportando..." : "Exportar CSV"}
        </button>
      </div>

      {exportError && (
        <p className="mt-3 rounded-xl border border-danger/30 bg-danger/5 px-4 py-2.5 text-[12.5px] font-bold text-danger">
          {exportError}
        </p>
      )}

      <div className="mt-5">
        <input
          placeholder="Buscar por nome, e-mail ou código do ingresso"
          className="w-full max-w-sm rounded-xl border border-line-input px-3 py-2.5 text-[13px]"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {loading ? (
        <p className="mt-6 text-muted">Carregando...</p>
      ) : error ? (
        <div className="mt-6 rounded-2xl border border-danger/30 bg-danger/5 p-6 text-center">
          <p className="text-[13px] font-bold text-danger">{error}</p>
          <button
            onClick={() => setAttempt((a) => a + 1)}
            className="mt-3 h-10 rounded-xl bg-primary px-5 text-[13px] font-extrabold text-white shadow-cta"
          >
            Tentar novamente
          </button>
        </div>
      ) : participants.length === 0 && busca ? (
        <div className="mt-6 rounded-2xl border border-line bg-surface p-10 text-center">
          <p className="text-[13px] font-semibold text-muted">
            Nenhum participante encontrado para &quot;{busca}&quot;.
          </p>
        </div>
      ) : participants.length === 0 ? (
        <div className="mt-6 rounded-2xl border border-line bg-surface p-10 text-center">
          <p className="text-[15px] font-extrabold">Nenhum ingresso emitido ainda</p>
          <p className="mt-1 text-[13px] font-semibold text-muted">
            Assim que houver vendas ou cortesias, os participantes aparecem aqui.
          </p>
        </div>
      ) : (
        <>
        <div className="mt-6 overflow-x-auto rounded-2xl border border-line bg-surface">
          <table className="w-full min-w-[640px] text-left text-[13px]">
            <thead>
              <tr className="border-b border-line bg-bg/60 text-[12px] font-bold text-muted">
                <th className="px-5 py-3">Código</th>
                <th className="px-5 py-3">Nome</th>
                <th className="px-5 py-3">Tipo/Lote</th>
                <th className="px-5 py-3">Status</th>
                <th className="px-5 py-3">Check-in</th>
              </tr>
            </thead>
            <tbody>
              {participants.map((p) => {
                const s = STATUS_STYLES[p.status] ?? { bg: "bg-line", fg: "text-muted", label: p.status };
                return (
                  <tr key={p.id} className="border-b border-line last:border-0 hover:bg-bg/40">
                    <td className="px-5 py-3.5 font-mono font-bold">{p.code}</td>
                    <td className="px-5 py-3.5 font-semibold">{p.attendeeName ?? p.attendeeEmail ?? "—"}</td>
                    <td className="px-5 py-3.5 text-muted">
                      {p.typeName} / {p.lotName}
                    </td>
                    <td className="px-5 py-3.5">
                      <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${s.bg} ${s.fg}`}>{s.label}</span>
                    </td>
                    <td className="px-5 py-3.5 text-muted">
                      {p.checkedInAt ? new Date(p.checkedInAt).toLocaleString("pt-BR") : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-y-2 text-[12px] font-bold text-muted">
          <span>
            {total} {total === 1 ? "participante" : "participantes"}
            {busca ? ` para "${busca}"` : ""}
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="rounded-lg border border-line px-3 py-1.5 disabled:text-muted-3"
            >
              Anterior
            </button>
            <span>
              Página {page} de {totalPages}
            </span>
            <button
              type="button"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              className="rounded-lg border border-line px-3 py-1.5 disabled:text-muted-3"
            >
              Próxima
            </button>
          </div>
        </div>
        </>
      )}
    </main>
  );
}

export default function ParticipantsPage({ params }: { params: { eventId: string } }) {
  return (
    <AuthGuard>
      <ParticipantsContent eventId={params.eventId} />
    </AuthGuard>
  );
}
