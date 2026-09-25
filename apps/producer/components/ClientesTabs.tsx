"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

/**
 * Navegação da área CLIENTES da organização (2026-09-25, pedido do Arthur):
 * as sete telas (base, segmentos, LTV, retenção, reativação, fidelidade e
 * inteligência) tinham cada uma a própria fileira de links — o conjunto
 * mudava de tela pra tela, a tela atual sumia da fileira e uma delas virava
 * botão com seta. Agora é uma barra só, igual às pílulas do evento, com a
 * aba ativa marcada. Aparece em todas as larguras: a sidebar do desktop só
 * tem "Clientes", não conhece as sub-telas.
 */
export function ClientesTabs({ orgId }: { orgId: string }) {
  const pathname = usePathname() ?? "";
  const activeRef = useRef<HTMLAnchorElement | null>(null);

  const base = `/organizacoes/${orgId}`;
  const tabs = [
    { id: "clientes", label: "Clientes", href: `${base}/clientes` },
    { id: "segmentos", label: "Segmentos", href: `${base}/clientes/segmentos` },
    { id: "ltv", label: "LTV", href: `${base}/clientes/inteligencia` },
    { id: "retencao", label: "Retenção", href: `${base}/clientes/retencao` },
    { id: "reativacao", label: "Reativação", href: `${base}/clientes/reativacao` },
    { id: "fidelidade", label: "Fidelidade", href: `${base}/fidelidade` },
    { id: "inteligencia", label: "Inteligência", href: `${base}/inteligencia` },
  ];

  const resto = pathname.split(base)[1]?.replace(/^\//, "") ?? "";
  const active =
    resto === "clientes" ? "clientes"
    : resto === "clientes/segmentos" ? "segmentos"
    : resto === "clientes/inteligencia" ? "ltv"
    : resto === "clientes/retencao" ? "retencao"
    : resto === "clientes/reativacao" ? "reativacao"
    : resto === "fidelidade" ? "fidelidade"
    : resto === "inteligencia" ? "inteligencia"
    : "";

  useEffect(() => {
    activeRef.current?.scrollIntoView({ inline: "center", block: "nearest" });
  }, [active]);

  return (
    <nav
      className="sticky top-0 z-30 -mx-5 mb-5 bg-bg/95 px-5 py-2.5 backdrop-blur lg:-mx-8 lg:px-8"
      style={{ scrollbarWidth: "none" }}
      aria-label="Seções de clientes"
    >
      <div className="flex gap-2 overflow-x-auto [&::-webkit-scrollbar]:hidden" style={{ scrollbarWidth: "none" }}>
        {tabs.map((tab) => (
          <Link
            key={tab.id}
            href={tab.href}
            ref={active === tab.id ? activeRef : undefined}
            aria-current={active === tab.id ? "page" : undefined}
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
  );
}
