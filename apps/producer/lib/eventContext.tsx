"use client";

import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import { eventsApi, organizationsApi, type EventSummary, type Organization } from "./api";

export interface EventContext {
  event: EventSummary;
  organization: Organization;
}

/**
 * O dashboard só devolve id/título/slug/status do evento — para o wizard de edição
 * (descrição, datas, banner) e para a sidebar precisamos do registro completo, que
 * vem de GET /v1/organizations/:id/events. Como a rota do painel só carrega o
 * eventId, varremos as organizações do usuário até achar o evento.
 */
export async function resolveEventContext(token: string, eventId: string): Promise<EventContext | null> {
  const organizations = await organizationsApi.list(token);
  for (const organization of organizations) {
    const events = await eventsApi.list(token, organization.id);
    const event = events.find((candidate) => candidate.id === eventId);
    if (event) return { event, organization };
  }
  return null;
}

/** Primeira organização do usuário — destino do pós-login (decisão v2 #6). */
export async function resolveHomePath(token: string): Promise<string> {
  const organizations = await organizationsApi.list(token).catch(() => []);
  if (organizations.length === 0) return "/onboarding";
  return `/organizacoes/${organizations[0].id}`;
}

export function useEventContext(eventId: string, token: string | null) {
  const [context, setContext] = useState<EventContext | null>(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      setContext(await resolveEventContext(token, eventId));
    } catch {
      setContext(null);
    } finally {
      setLoading(false);
    }
  }, [token, eventId]);

  useEffect(() => {
    reload();
  }, [reload]);

  return { context, loading, reload };
}

interface EventShellValue {
  eventId: string;
  event: EventSummary | null;
  organization: Organization | null;
  loading: boolean;
  reload: () => Promise<void>;
}

const EventShellContext = createContext<EventShellValue | null>(null);

export function EventShellProvider({ value, children }: { value: EventShellValue; children: React.ReactNode }) {
  return <EventShellContext.Provider value={value}>{children}</EventShellContext.Provider>;
}

/** Evento + organização já resolvidos pelo layout de /eventos/[eventId]. */
export function useEventShell(): EventShellValue {
  const ctx = useContext(EventShellContext);
  if (!ctx) throw new Error("useEventShell precisa estar dentro do layout de evento");
  return ctx;
}
