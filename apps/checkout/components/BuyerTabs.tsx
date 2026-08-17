"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

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
  inicio: (
    <svg {...ICON}>
      <path d="M3 10.5 12 3l9 7.5" />
      <path d="M5 9.5V21h5v-6h4v6h5V9.5" />
    </svg>
  ),
  explorar: (
    <svg {...ICON}>
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.35-4.35" />
    </svg>
  ),
  favoritos: (
    <svg {...ICON}>
      <path d="M19 14c1.5-1.5 3-3.3 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.8 0-3 .5-4.5 2-1.5-1.5-2.7-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.2 1.5 4 3 5.5l7 7Z" />
    </svg>
  ),
  ingressos: (
    <svg {...ICON}>
      <path d="M4 8a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2 2 2 0 0 0 0 4 2 2 0 0 1-2 2H6a2 2 0 0 1-2-2 2 2 0 0 0 0-4Z" />
      <path d="M14 6v12" strokeDasharray="2 3" />
    </svg>
  ),
};

/**
 * Abas fixas do COMPRADOR no mobile (redesenho 2026-08-17, inspiração do Arthur):
 * mesmo padrão de app do painel do produtor. Só aparecem nas telas de "morar"
 * (home, explorar, favoritos, carteira) — nunca no funil de compra, na página
 * do evento (que tem CTA fixo próprio) nem na portaria.
 */
export function BuyerTabs() {
  const pathname = usePathname() ?? "";

  const visivel =
    pathname === "/" ||
    ["/explorar", "/favoritos", "/perfil", "/minhas-compras"].some((p) => pathname.startsWith(p));
  if (!visivel) return null;

  const tabs = [
    { id: "inicio", label: "Início", icon: icons.inicio, href: "/" },
    { id: "explorar", label: "Explorar", icon: icons.explorar, href: "/explorar" },
    { id: "favoritos", label: "Favoritos", icon: icons.favoritos, href: "/favoritos" },
    { id: "ingressos", label: "Ingressos", icon: icons.ingressos, href: "/perfil" },
  ];

  const active =
    pathname === "/" ? "inicio"
    : pathname.startsWith("/explorar") ? "explorar"
    : pathname.startsWith("/favoritos") ? "favoritos"
    : "ingressos";

  return (
    <>
      {/* espaçador: o nav é fixed e não reserva altura no fluxo */}
      <div className="h-[72px] lg:hidden" />
      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden">
        <div className="mx-auto flex max-w-[430px] items-stretch justify-around">
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
    </>
  );
}
