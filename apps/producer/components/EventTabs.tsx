"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

/**
 * Navegação interna do EVENTO no mobile (redesenho Fase 2, 2026-08-17):
 * pills horizontais grudadas no topo — troca de seção sem abrir o hambúrguer.
 * No desktop a sidebar continua sendo a navegação principal; o N3 aparece como
 * CTA de operação para não poluir o menu fixo com uma ação que acontece 1x por edição.
 */
export function EventTabs({ eventId }: { eventId: string }) {
  const pathname = usePathname() ?? "";
  const activeRef = useRef<HTMLAnchorElement | null>(null);

  const base = `/eventos/${eventId}`;
  const tabs = [
    { id: "geral", label: "Geral", href: `${base}/dashboard` },
    { id: "ingressos", label: "Ingressos", href: base },
    { id: "recorrencia", label: "Próxima edição", href: `${base}/proxima-edicao` },
    { id: "vendas", label: "Vendas", href: `${base}/vendas` },
    { id: "divulgue", label: "Divulgue", href: `${base}/divulgue` },
    { id: "participantes", label: "Participantes", href: `${base}/participantes` },
    { id: "checkin", label: "Check-in", href: `${base}/portaria` },
  ];

  const segment = pathname.split(base)[1]?.replace(/^\//, "").split("/")[0] ?? "";
  const active =
    segment === "" ? "ingressos"
    : segment === "dashboard" || segment === "editar" ? "geral"
    : segment === "proxima-edicao" ? "recorrencia"
    : segment === "portaria" || segment === "checkin-ao-vivo" || segment === "lista-convidados" ? "checkin"
    : segment;

  useEffect(() => {
    activeRef.current?.scrollIntoView({ inline: "center", block: "nearest" });
  }, [active]);

  return (
    <>
      {segment !== "proxima-edicao" ? (
        <div className="mb-4 hidden justify-end lg:flex">
          <Link
            href={`${base}/proxima-edicao`}
            className="inline-flex h-10 items-center rounded-xl border border-primary/25 bg-primary/[0.06] px-4 text-[12.5px] font-extrabold text-primary transition hover:border-primary/45 hover:bg-primary/10"
          >
            ↻ Criar próxima edição
          </Link>
        </div>
      ) : null}

      <nav
        className="sticky top-0 z-30 -mx-5 mb-4 bg-bg/95 px-5 py-2.5 backdrop-blur lg:hidden"
        style={{ scrollbarWidth: "none" }}
      >
        <div className="flex gap-2 overflow-x-auto [&::-webkit-scrollbar]:hidden" style={{ scrollbarWidth: "none" }}>
          {tabs.map((tab) => (
            <Link
              key={tab.id}
              href={tab.href}
              ref={active === tab.id ? activeRef : undefined}
              className={`shrink-0 whitespace-nowrap rounded-full px-4 py-2 text-[12.5px] font-extrabold ${
                active === tab.id
                  ? "bg-primary text-white shadow-cta"
                  : "border border-line bg-surface text-ink-soft"
              }`}
            >
              {tab.label}
            </Link>
          ))}
        </div>
      </nav>
    </>
  );
}
