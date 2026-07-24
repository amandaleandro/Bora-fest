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

  const STATUS_STYLES: Record<string, { bg: string; fg: string; label: string }> = {
    DRAFT: { bg: "bg-warning/10", fg: "text-warning", label: "Rascunho" },
    PUBLISHED: { bg: "bg-success/10", fg: "text-success", label: "Publicado" },
    UNPUBLISHED: { bg: "bg-line", fg: "text-muted", label: "Despublicado" },
    CANCELLED: { bg: "bg-danger/10", fg: "text-danger", label: "Cancelado" },
  };

  function formatDate(iso: string): string {
    return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" });
  }

  return (
    <main>
      <Nav />
      <div className="mt-6 flex items-center justify-between">
        <div>
          <h1 className="text-[22px] font-extrabold">Meus eventos</h1>
          <Link href={`/organizacoes/${orgId}/financeiro`} className="text-[13px] font-bold text-primary">
            Ver financeiro da organização →
          </Link>
        </div>
        <div className="flex gap-2">
          <Link
            href={`/eventos/novo?org=${orgId}`}
            className="rounded-xl bg-primary px-4 py-2.5 text-[13px] font-bold text-white"
          >
            Criar novo evento
          </Link>
          <button
            type="button"
            className="rounded-xl border border-line px-4 py-2.5 text-[13px] font-bold text-muted"
            onClick={() => setShowForm((v) => !v)}
          >
            Criação rápida
          </button>
        </div>
      </div>

      {showForm ? (
        <div className="mt-4 space-y-3 rounded-2xl border border-line bg-surface p-4">
          <input placeholder="Título" className="w-full" value={title} onChange={(e) => setTitle(e.target.value)} />
          <div>
            <label className="mb-1 block text-xs text-muted">Início</label>
            <input
              type="datetime-local"
              className="w-full"
              value={startsAt}
              onChange={(e) => setStartsAt(e.target.value)}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-muted">Fim</label>
            <input type="datetime-local" className="w-full" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} />
          </div>
          {error ? <p className="text-sm text-danger">{error}</p> : null}
          <button
            type="button"
            className="rounded-xl bg-brand px-4 py-2 text-sm font-bold text-brand-dark"
            onClick={handleCreate}
          >
            Criar (fica como rascunho)
          </button>
        </div>
      ) : null}

      {loading ? (
        <p className="mt-6 text-muted">Carregando...</p>
      ) : events.length === 0 ? (
        <div className="mt-6 rounded-2xl border border-line bg-surface p-10 text-center">
          <p className="text-[15px] font-extrabold">Nenhum evento ainda</p>
          <p className="mt-1 text-[13px] font-semibold text-muted">
            Crie seu primeiro evento para começar a vender ingressos.
          </p>
        </div>
      ) : (
        <div className="mt-6 overflow-hidden rounded-2xl border border-line bg-surface">
          <table className="w-full text-left text-[13px]">
            <thead>
              <tr className="border-b border-line bg-bg/60 text-[12px] font-bold text-muted">
                <th className="px-5 py-3">Evento</th>
                <th className="px-5 py-3">Data</th>
                <th className="px-5 py-3">Status</th>
                <th className="px-5 py-3" />
              </tr>
            </thead>
            <tbody>
              {events.map((event) => {
                const s = STATUS_STYLES[event.status] ?? { bg: "bg-line", fg: "text-muted", label: event.status };
                return (
                  <tr key={event.id} className="border-b border-line last:border-0 hover:bg-bg/40">
                    <td className="px-5 py-3.5">
                      <Link href={`/eventos/${event.id}`} className="font-bold">
                        {event.title}
                      </Link>
                    </td>
                    <td className="px-5 py-3.5 font-semibold text-muted">{formatDate(event.startsAt)}</td>
                    <td className="px-5 py-3.5">
                      <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${s.bg} ${s.fg}`}>{s.label}</span>
                    </td>
                    <td className="px-5 py-3.5 text-right">
                      <Link href={`/eventos/${event.id}`} className="text-[12px] font-bold text-primary">
                        Gerenciar →
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
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
