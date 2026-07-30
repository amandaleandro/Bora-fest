"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { GuardedPanelShell } from "@/components/PanelShell";
import { useAuth } from "@/lib/auth";
import { eventsApi, type EventSummary } from "@/lib/api";

const STATUS_STYLES: Record<string, { bg: string; fg: string; label: string }> = {
  DRAFT: { bg: "bg-warning/10", fg: "text-warning", label: "Rascunho" },
  PUBLISHED: { bg: "bg-success/10", fg: "text-success", label: "Publicado" },
  SALES_PAUSED: { bg: "bg-warning/10", fg: "text-warning", label: "Vendas pausadas" },
  UNPUBLISHED: { bg: "bg-line", fg: "text-muted", label: "Despublicado" },
  CANCELLED: { bg: "bg-danger/10", fg: "text-danger", label: "Cancelado" },
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" });
}

function EventsList({ orgId }: { orgId: string }) {
  const { token } = useAuth();
  const [events, setEvents] = useState<EventSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!token) return;
    setLoading(true);
    eventsApi
      .list(token, orgId)
      .then(setEvents)
      .finally(() => setLoading(false));
  }, [token, orgId]);

  if (loading) return <p className="text-[13px] font-semibold text-muted">Carregando…</p>;

  if (events.length === 0) {
    return (
      <div className="rounded-[18px] border border-line bg-surface p-10 text-center">
        <p className="text-[15px] font-extrabold">Nenhum evento ainda</p>
        <p className="mt-1 text-[13px] font-semibold text-muted">
          Crie seu primeiro evento para começar a vender ingressos.
        </p>
        <Link
          href={`/eventos/novo?org=${orgId}`}
          className="mt-5 inline-flex h-11 items-center rounded-xl bg-primary px-5 text-[14px] font-extrabold text-white shadow-cta"
        >
          Criar novo evento
        </Link>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-[18px] border border-line bg-surface">
      <table className="w-full min-w-[560px] text-left text-[13px]">
        <thead>
          <tr className="border-b border-line text-[11px] font-bold uppercase tracking-[.04em] text-muted-2">
            <th className="px-5 py-3.5">Evento</th>
            <th className="px-5 py-3.5">Data</th>
            <th className="px-5 py-3.5">Status</th>
            <th className="px-5 py-3.5" />
          </tr>
        </thead>
        <tbody>
          {events.map((event) => {
            const s = STATUS_STYLES[event.status] ?? { bg: "bg-line", fg: "text-muted", label: event.status };
            return (
              <tr key={event.id} className="border-b border-line-divider last:border-0 hover:bg-bg/50">
                <td className="px-5 py-3.5">
                  <Link href={`/eventos/${event.id}`} className="font-bold text-ink">
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
  );
}

export default function OrganizationPage({ params }: { params: { orgId: string } }) {
  return (
    <GuardedPanelShell
      title="Meus eventos"
      organizationId={params.orgId}
      actions={
        <Link
          href={`/eventos/novo?org=${params.orgId}`}
          className="h-10 rounded-xl bg-primary px-4 text-[13px] font-extrabold leading-10 text-white shadow-cta"
        >
          Criar novo evento
        </Link>
      }
    >
      <EventsList orgId={params.orgId} />
    </GuardedPanelShell>
  );
}
