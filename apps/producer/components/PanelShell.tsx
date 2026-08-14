"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { AuthGuard } from "@/components/AuthGuard";
import { Sidebar, type SidebarEventInfo } from "@/components/Sidebar";
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
 * Conteúdo centrado com max-width 1160px. Abaixo de 1024px a sidebar deixou de
 * ser uma faixa horizontal rolável (pouco intuitiva) e virou um MENU DESLIZANTE:
 * um botão hambúrguer (☰) na topbar abre a MESMA sidebar do desktop por cima do
 * conteúdo, com fundo escurecido, fechando ao tocar fora ou ao navegar.
 */
export function PanelShell({ title, event, organizationId, actions, children }: PanelShellProps) {
  const { user } = useAuth();
  const [navOpen, setNavOpen] = useState(false);
  const pathname = usePathname();

  // fecha o menu ao trocar de página (tocar num link leva a uma nova rota)
  useEffect(() => {
    setNavOpen(false);
  }, [pathname]);

  return (
    <div className="flex min-h-dvh bg-bg">
      {/* sidebar fixa no desktop (>=1024px) */}
      <div className="hidden lg:flex">
        <Sidebar event={event} organizationId={organizationId} />
      </div>

      {/* menu deslizante no mobile (<1024px) — mesma sidebar, por cima do conteúdo */}
      <div
        className={`fixed inset-0 z-50 lg:hidden ${navOpen ? "" : "pointer-events-none"}`}
        aria-hidden={!navOpen}
      >
        <div
          className={`absolute inset-0 bg-black/50 transition-opacity duration-200 ${navOpen ? "opacity-100" : "opacity-0"}`}
          onClick={() => setNavOpen(false)}
        />
        <div
          className={`absolute inset-y-0 left-0 flex shadow-2xl transition-transform duration-200 ${navOpen ? "translate-x-0" : "-translate-x-full"}`}
        >
          <Sidebar event={event} organizationId={organizationId} />
        </div>
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-[66px] shrink-0 items-center justify-between gap-3 border-b border-line bg-surface px-4 lg:px-7">
          <div className="flex min-w-0 items-center gap-2.5">
            <button
              type="button"
              onClick={() => setNavOpen(true)}
              aria-label="Abrir menu"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-line text-ink transition-colors hover:bg-bg lg:hidden"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
            <h1 className="truncate text-[18px] font-extrabold text-ink">{title}</h1>
          </div>
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
