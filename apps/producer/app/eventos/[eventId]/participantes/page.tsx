"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AuthGuard } from "@/components/AuthGuard";
import { Nav } from "@/components/Nav";
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

function ParticipantsContent({ eventId }: { eventId: string }) {
  const { token } = useAuth();
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!token) return;
    dashboardApi
      .participants(token, eventId)
      .then(setParticipants)
      .finally(() => setLoading(false));
  }, [token, eventId]);

  async function handleExport() {
    if (!token) return;
    setExporting(true);
    try {
      await dashboardApi.downloadParticipantsCsv(token, eventId);
    } finally {
      setExporting(false);
    }
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return participants;
    return participants.filter((p) =>
      [p.code, p.attendeeName, p.attendeeEmail].some((field) => field?.toLowerCase().includes(q)),
    );
  }, [participants, query]);

  return (
    <main>
      <Nav />
      <div className="mt-6 flex items-center justify-between">
        <div>
          <h1 className="text-[22px] font-extrabold">Participantes</h1>
          <Link href={`/eventos/${eventId}`} className="text-[13px] font-bold text-primary">
            Voltar ao evento →
          </Link>
        </div>
        <button
          type="button"
          onClick={handleExport}
          disabled={exporting}
          className="rounded-xl bg-primary px-4 py-2.5 text-[13px] font-bold text-white disabled:opacity-50"
        >
          {exporting ? "Exportando..." : "Exportar CSV"}
        </button>
      </div>

      <div className="mt-5">
        <input
          placeholder="Buscar por nome ou código do ingresso"
          className="w-full max-w-sm rounded-xl border border-line-input px-3 py-2.5 text-[13px]"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {loading ? (
        <p className="mt-6 text-muted">Carregando...</p>
      ) : participants.length === 0 ? (
        <div className="mt-6 rounded-2xl border border-line bg-surface p-10 text-center">
          <p className="text-[15px] font-extrabold">Nenhum ingresso emitido ainda</p>
          <p className="mt-1 text-[13px] font-semibold text-muted">
            Assim que houver vendas ou cortesias, os participantes aparecem aqui.
          </p>
        </div>
      ) : (
        <div className="mt-6 overflow-hidden rounded-2xl border border-line bg-surface">
          <table className="w-full text-left text-[13px]">
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
              {filtered.map((p) => {
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
          {filtered.length === 0 ? (
            <p className="px-5 py-6 text-center text-[13px] font-semibold text-muted">
              Nenhum participante encontrado para &quot;{query}&quot;.
            </p>
          ) : null}
        </div>
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
