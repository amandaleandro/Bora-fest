"use client";

import { useEffect, useState } from "react";
import { AuthGuard } from "@/components/AuthGuard";
import { Nav } from "@/components/Nav";
import { useAuth } from "@/lib/auth";
import { dashboardApi, type Participant } from "@/lib/api";

function ParticipantsContent({ eventId }: { eventId: string }) {
  const { token } = useAuth();
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);

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

  return (
    <main>
      <Nav />
      <div className="mt-6 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Participantes</h1>
        <button
          type="button"
          onClick={handleExport}
          disabled={exporting}
          className="rounded-lg bg-gray-800 px-4 py-2 text-sm disabled:opacity-50"
        >
          {exporting ? "Exportando..." : "Exportar CSV"}
        </button>
      </div>

      {loading ? (
        <p className="mt-6 text-gray-400">Carregando...</p>
      ) : (
        <table className="mt-6">
          <thead>
            <tr>
              <th>Código</th>
              <th>Nome</th>
              <th>Tipo/Lote</th>
              <th>Status</th>
              <th>Check-in</th>
            </tr>
          </thead>
          <tbody>
            {participants.map((p) => (
              <tr key={p.id}>
                <td>{p.code}</td>
                <td>{p.attendeeName ?? p.attendeeEmail ?? "—"}</td>
                <td>
                  {p.typeName} / {p.lotName}
                </td>
                <td>{p.status}</td>
                <td>{p.checkedInAt ? new Date(p.checkedInAt).toLocaleString("pt-BR") : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {!loading && participants.length === 0 ? (
        <p className="mt-4 text-gray-500">Nenhum ingresso emitido ainda.</p>
      ) : null}
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
