"use client";

import { AuthGuard } from "@/components/AuthGuard";
import { Sidebar, SidebarStrip, type SidebarEventInfo } from "@/components/Sidebar";
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
 * Conteúdo centrado com max-width 1160px (regra de breakpoint do handoff v2);
 * abaixo de 1024px a sidebar vira faixa horizontal no topo.
 */
export function PanelShell({ title, event, organizationId, actions, children }: PanelShellProps) {
  const { user } = useAuth();

  return (
    <div className="flex min-h-dvh bg-bg">
      <div className="hidden lg:flex">
        <Sidebar event={event} organizationId={organizationId} />
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        <SidebarStrip event={event} organizationId={organizationId} />

        <header className="flex h-[66px] shrink-0 items-center justify-between gap-4 border-b border-line bg-surface px-5 lg:px-7">
          <h1 className="truncate text-[18px] font-extrabold text-ink">{title}</h1>
          <div className="flex shrink-0 items-center gap-3">
            {actions}
            {user?.name || user?.email ? (
              <span className="hidden text-[13px] font-semibold text-muted sm:inline">{user.name ?? user.email}</span>
            ) : null}
          </div>
        </header>

        <div className="mx-auto w-full max-w-[1160px] px-5 py-6 lg:px-8 lg:py-7">{children}</div>
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
