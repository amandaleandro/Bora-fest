"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

const ICON = {
  width: 22,
  height: 22,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.9,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

const icons = {
  resumo: (
    <svg {...ICON}>
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </svg>
  ),
  eventos: (
    <svg {...ICON}>
      <rect x="3" y="4" width="18" height="16" rx="2.5" />
      <path d="M3 9h18M8 2.5v3M16 2.5v3" />
    </svg>
  ),
  financeiro: (
    <svg {...ICON}>
      <rect x="3" y="6" width="18" height="13" rx="2.5" />
      <path d="M3 10.5h18M7 15h3" />
    </svg>
  ),
  mais: (
    <svg {...ICON}>
      <circle cx="5" cy="12" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="19" cy="12" r="1.4" fill="currentColor" stroke="none" />
    </svg>
  ),
};

/**
 * Redesenho mobile do painel (decisão 2026-08-15, inspiração do Arthur):
 * navegação por ABAS FIXAS no rodapé — padrão de app operacional, sempre no
 * alcance do polegar. Só existe abaixo de lg (desktop mantém a sidebar).
 *
 * 2026-09-25 (decisão do Arthur, com Material 3 e Apple HIG na mão): a barra
 * só tem PÁGINAS FIXAS do produto. "Vendas" e "Portaria" apontavam pro evento
 * em foco — repetiam as pílulas do evento e mudavam de destino conforme o
 * contexto ("Don't disable or hide tab bar buttons"). Seção de evento é
 * assunto das pílulas (EventTabs); o menu deslizante (☰) saiu do celular.
 */
export function BottomTabs() {
  const pathname = usePathname() ?? "";
  const [org, setOrg] = useState<string | null>(null);

  useEffect(() => {
    setOrg(localStorage.getItem("bf.activeOrg"));
  }, [pathname]);

  const tabs = [
    { id: "resumo", label: "Resumo", icon: icons.resumo, href: "/resumo" },
    { id: "eventos", label: "Eventos", icon: icons.eventos, href: org ? `/organizacoes/${org}` : "/organizacoes" },
    { id: "financeiro", label: "Financeiro", icon: icons.financeiro, href: org ? `/organizacoes/${org}/financeiro` : "/organizacoes" },
    { id: "mais", label: "Mais", icon: icons.mais, href: "/mais" },
  ];

  function activeId(): string {
    if (pathname.startsWith("/resumo")) return "resumo";
    if (pathname.includes("/financeiro")) return "financeiro";
    if (pathname.startsWith("/mais") || pathname.includes("/reembolsos") || pathname.includes("/clientes")) return "mais";
    if (pathname.startsWith("/organizacoes") || pathname.startsWith("/eventos")) return "eventos";
    return "";
  }
  const active = activeId();

  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden">
      <div className="mx-auto flex max-w-[560px] items-stretch justify-around">
        {tabs.map((tab) => (
          <Link
            key={tab.id}
            href={tab.href}
            className={`flex min-w-0 flex-1 flex-col items-center gap-1 py-2.5 text-[10.5px] font-bold ${
              active === tab.id ? "text-primary" : "text-muted-2"
            }`}
          >
            {tab.icon}
            {tab.label}
          </Link>
        ))}
      </div>
    </nav>
  );
}
