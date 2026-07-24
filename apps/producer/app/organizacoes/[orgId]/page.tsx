"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AuthGuard } from "@/components/AuthGuard";
import { Nav } from "@/components/Nav";
import { useAuth } from "@/lib/auth";
import { eventsApi, type EventSummary } from "@/lib/api";

function OrganizationContent({ orgId }: { orgId: string }) {
  const { token } = useAuth();
  const [events, setEvents] = useState<EventSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function load() {
    if (!token) return;
    setLoading(true);
    try {
      setEvents(await eventsApi.list(token, orgId));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, orgId]);

  async function handleCreate() {
    if (!token) return;
    setError(null);
    try {
      await eventsApi.create(token, orgId, {
        title,
        startsAt: new Date(startsAt).toISOString(),
        endsAt: new Date(endsAt).toISOString(),
      });
      setShowForm(false);
      setTitle("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível criar o evento");
    }
  }

  return (
    <main>
      <Nav />
      <div className="mt-6 flex items-center justify-between">
        <Link href={`/organizacoes/${orgId}/financeiro`} className="text-sm text-gray-400 underline">
          Ver financeiro da organização →
        </Link>
      </div>

      <div className="mt-6 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Eventos</h1>
        <div className="flex gap-2">
          <Link
            href={`/eventos/novo?org=${orgId}`}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white"
          >
            Criar novo evento
          </Link>
          <button
            type="button"
            className="rounded-lg border border-line-input px-4 py-2 text-sm font-semibold"
            onClick={() => setShowForm((v) => !v)}
          >
            Criação rápida
          </button>
        </div>
      </div>

      {showForm ? (
        <div className="mt-4 space-y-3 rounded-lg bg-gray-800/60 p-4">
          <input placeholder="Título" className="w-full" value={title} onChange={(e) => setTitle(e.target.value)} />
          <div>
            <label className="mb-1 block text-xs text-gray-400">Início</label>
            <input
              type="datetime-local"
              className="w-full"
              value={startsAt}
              onChange={(e) => setStartsAt(e.target.value)}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-gray-400">Fim</label>
            <input type="datetime-local" className="w-full" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} />
          </div>
          {error ? <p className="text-sm text-red-400">{error}</p> : null}
          <button
            type="button"
            className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-brand-dark"
            onClick={handleCreate}
          >
            Criar (fica como rascunho)
          </button>
        </div>
      ) : null}

      {loading ? (
        <p className="mt-6 text-gray-400">Carregando...</p>
      ) : (
        <div className="mt-6 space-y-2">
          {events.map((event) => (
            <Link
              key={event.id}
              href={`/eventos/${event.id}`}
              className="flex items-center justify-between rounded-lg bg-gray-800/60 px-4 py-3"
            >
              <span>{event.title}</span>
              <span className="text-xs text-gray-400">{event.status}</span>
            </Link>
          ))}
          {events.length === 0 ? <p className="text-gray-500">Nenhum evento ainda.</p> : null}
        </div>
      )}
    </main>
  );
}

export default function OrganizationPage({ params }: { params: { orgId: string } }) {
  return (
    <AuthGuard>
      <OrganizationContent orgId={params.orgId} />
    </AuthGuard>
  );
}
