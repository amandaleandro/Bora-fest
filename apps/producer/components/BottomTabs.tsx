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
  vendas: (
    <svg {...ICON}>
      <path d="M3 17l5-5 4 4 8-8" />
      <path d="M14 8h6v6" />
    </svg>
  ),
  portaria: (
    <svg {...ICON}>
      <path d="M4 8V6a2 2 0 0 1 2-2h2M4 16v2a2 2 0 0 0 2 2h2M20 8V6a2 2 0 0 0-2-2h-2M20 16v2a2 2 0 0 1-2 2h-2M3 12h18" />
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
 * "Vendas" e "Portaria" apontam pro último EVENTO visitado (bf.activeEvent);
 * sem evento, caem no Resumo, que orienta a criar/escolher.
 */
export function BottomTabs() {
  const pathname = usePathname() ?? "";
  const [org, setOrg] = useState<string | null>(null);
  const [event, setEvent] = useState<string | null>(null);

  useEffect(() => {
    setOrg(localStorage.getItem("bf.activeOrg"));
    setEvent(localStorage.getItem("bf.activeEvent"));
  }, [pathname]);

  const tabs = [
    { id: "resumo", label: "Resumo", icon: icons.resumo, href: "/resumo" },
    { id: "eventos", label: "Eventos", icon: icons.eventos, href: org ? `/organizacoes/${org}` : "/organizacoes" },
    { id: "vendas", label: "Vendas", icon: icons.vendas, href: event ? `/eventos/${event}/vendas` : "/resumo" },
    { id: "portaria", label: "Portaria", icon: icons.portaria, href: event ? `/eventos/${event}/portaria` : "/resumo" },
    { id: "mais", label: "Mais", icon: icons.mais, href: "/mais" },
  ];

  function activeId(): string {
    if (pathname.startsWith("/resumo")) return "resumo";
    if (pathname.startsWith("/mais") || pathname.includes("/financeiro") || pathname.includes("/reembolsos")) return "mais";
    if (pathname.includes("/vendas") || pathname.includes("/dashboard")) return "vendas";
    if (pathname.includes("/portaria") || pathname.includes("/checkin-ao-vivo")) return "portaria";
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
