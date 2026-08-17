"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { AuthGuard } from "@/components/AuthGuard";
import { PanelShell } from "@/components/PanelShell";
import { useAuth } from "@/lib/auth";
import { EventTabs } from "@/components/EventTabs";
import { EventShellProvider, useEventContext } from "@/lib/eventContext";

/** Títulos da topbar por sub-rota (titleMap do protótipo). */
const TITLES: Record<string, string> = {
  "": "Ingressos & lotes",
  editar: "Editar evento",
  dashboard: "Painel do evento",
  divulgue: "Divulgue",
  vendas: "Vendas",
  participantes: "Participantes",
  portaria: "Check-in",
  "checkin-ao-vivo": "Check-in ao vivo",
  "lista-convidados": "Lista de convidados",
};

export default function EventLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: { eventId: string };
}) {
  const { token } = useAuth();
  const { context, loading, reload } = useEventContext(params.eventId, token);
  const pathname = usePathname() ?? "";

  useEffect(() => {
    localStorage.setItem("bf.activeEvent", params.eventId);
    if (context?.organization.id) localStorage.setItem("bf.activeOrg", context.organization.id);
  }, [params.eventId, context?.organization.id]);

  const segment = pathname.split(`/eventos/${params.eventId}`)[1]?.replace(/^\//, "") ?? "";
  const title = TITLES[segment] ?? "Painel do evento";

  return (
    <AuthGuard>
      <EventShellProvider
        value={{
          eventId: params.eventId,
          event: context?.event ?? null,
          organization: context?.organization ?? null,
          loading,
          reload,
        }}
      >
        <PanelShell
          title={title}
          organizationId={context?.organization.id}
          event={
            context
              ? { id: context.event.id, title: context.event.title, status: context.event.status }
              : undefined
          }
        >
          <EventTabs eventId={params.eventId} />
          {children}
        </PanelShell>
      </EventShellProvider>
    </AuthGuard>
  );
}
