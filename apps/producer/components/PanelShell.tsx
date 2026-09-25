"use client";

import { AuthGuard } from "@/components/AuthGuard";
import { Sidebar, type SidebarEventInfo } from "@/components/Sidebar";
import { BottomTabs } from "@/components/BottomTabs";
import { useAuth } from "@/lib/auth";

interface PanelShellProps {
  title: string;
  event?: SidebarEventInfo;
  organizationId?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}

/**
 * Moldura do painel: sidebar dark de 244px + topbar com o título da página.
 * Conteúdo centrado com max-width 1160px.
 *
 * Abaixo de 1024px NÃO há sidebar nem menu deslizante (decisão do Arthur,
 * 2026-09-25): o celular navega só pela barra inferior (páginas do produto) e
 * pelas pílulas do evento (seções). O ☰ duplicava as duas — tudo que ele tinha
 * de organização está em "Mais", tudo de evento está nas pílulas.
 */
export function PanelShell({ title, event, organizationId, actions, children }: PanelShellProps) {
  const { user } = useAuth();

  return (
    <div className="flex min-h-dvh bg-bg">
      {/* sidebar fixa no desktop (>=1024px) */}
      <div className="hidden lg:flex">
        <Sidebar event={event} organizationId={organizationId} />
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-[66px] shrink-0 items-center justify-between gap-3 border-b border-line bg-surface px-4 lg:px-7">
          <div className="flex min-w-0 items-center gap-2.5">
            <h1 className="truncate text-[18px] font-extrabold text-ink">{title}</h1>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            {actions}
            {user?.name || user?.email ? (
              <span className="hidden text-[13px] font-semibold text-muted sm:inline">{user.name ?? user.email}</span>
            ) : null}
          </div>
        </header>

        <div className="mx-auto w-full max-w-[1160px] px-5 py-6 pb-28 lg:px-8 lg:py-7">{children}</div>
        <BottomTabs />
      </div>
    </div>
  );
}

/** PanelShell já embrulhado no AuthGuard (todas as telas internas do painel). */
export function GuardedPanelShell(props: PanelShellProps) {
  return (
    <AuthGuard>
      <PanelShell {...props} />
    </AuthGuard>
  );
}
