"use client";

import { useEffect, useState } from "react";
import { AuthGuard } from "@/components/AuthGuard";
import { Nav } from "@/components/Nav";
import { useAuth } from "@/lib/auth";
import { adminApi, type AdminEvent } from "@/lib/api";

function EventsContent() {
  const { token, user } = useAuth();
  const [events, setEvents] = useState<AdminEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [reasonById, setReasonById] = useState<Record<string, string>>({});
  const isAdmin = user?.platformRole === "ADMIN";

  async function load() {
    if (!token) return;
    setLoading(true);
    try {
      setEvents(await adminApi.listEvents(token));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  async function handleBlock(eventId: string) {
    if (!token) return;
    const reason = reasonById[eventId];
    if (!reason) return;
    await adminApi.blockEvent(token, eventId, reason);
    await load();
  }

  return (
    <main>
      <Nav />
      <h1 className="mt-6 text-xl font-semibold">Eventos</h1>

      {loading ? (
        <p className="mt-6 text-gray-400">Carregando...</p>
      ) : (
        <table className="mt-6">
          <thead>
            <tr>
              <th>Título</th>
              <th>Organização</th>
              <th>Status</th>
              {isAdmin ? <th>Bloquear</th> : null}
            </tr>
          </thead>
          <tbody>
            {events.map((event) => (
              <tr key={event.id}>
                <td>{event.title}</td>
                <td>{event.organization.name}</td>
                <td>{event.status}</td>
                {isAdmin ? (
                  <td>
                    {event.status !== "CANCELED" ? (
                      <div className="flex gap-1">
                        <input
                          placeholder="motivo"
                          className="w-32 text-xs"
                          value={reasonById[event.id] ?? ""}
                          onChange={(e) => setReasonById((prev) => ({ ...prev, [event.id]: e.target.value }))}
                        />
                        <button
                          type="button"
                          className="rounded bg-red-900 px-2 text-xs text-red-200"
                          onClick={() => handleBlock(event.id)}
                        >
                          Bloquear
                        </button>
                      </div>
                    ) : (
                      <span className="text-xs text-gray-500">bloqueado</span>
                    )}
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}

export default function EventsPage() {
  return (
    <AuthGuard>
      <EventsContent />
    </AuthGuard>
  );
}
