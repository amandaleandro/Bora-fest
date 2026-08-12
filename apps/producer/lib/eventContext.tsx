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
  if (organizations.length === 0) {
    // Promoter/vendedor convidado por e-mail NÃO tem organização. Mandar direto
    // ao /onboarding (form obrigatório de produtor, sem referência a convites)
    // trancava TODO o fluxo de promoter para quem "não precisa ser produtor" —
    // ele nunca chegava à caixa de convites para aceitar, copiar o link ?pr= ou
    // convidar vendedor (auditoria 2026-08-12). Se há convite/engajamento
    // pendente, cai em /organizacoes (onde a caixa de convites é renderizada e
    // onde ele pode, opcionalmente, criar uma organização depois).
    const [promoterInvites, promoterEngagements, sellerInvites, sellerEngagements] =
      await Promise.all([
        organizationsApi.myPromoterInvites(token).catch(() => []),
        organizationsApi.myPromoterEngagements(token).catch(() => []),
        organizationsApi.mySellerInvites(token).catch(() => []),
        organizationsApi.mySellerEngagements(token).catch(() => []),
      ]);
    const ehPromoterOuVendedor =
      promoterInvites.length > 0 ||
      promoterEngagements.length > 0 ||
      sellerInvites.length > 0 ||
      sellerEngagements.length > 0;
    return ehPromoterOuVendedor ? "/organizacoes" : "/onboarding";
  }
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
