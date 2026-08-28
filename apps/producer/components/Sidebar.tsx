"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { OrgSwitcher } from "@/components/OrgSwitcher";
import { CHECKOUT_URL } from "@/lib/config";

const ICON_PROPS = {
  width: 17,
  height: 17,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.9,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

const icons = {
  calendar: (
    <svg {...ICON_PROPS}>
      <rect x="3" y="4" width="18" height="16" rx="2.5" />
      <path d="M3 9h18M8 2.5v3M16 2.5v3" />
    </svg>
  ),
  grid: (
    <svg {...ICON_PROPS}>
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </svg>
  ),
  pencil: (
    <svg {...ICON_PROPS}>
      <path d="M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
    </svg>
  ),
  ticket: (
    <svg {...ICON_PROPS}>
      <path d="M4 8a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2 2 2 0 0 0 0 4 2 2 0 0 1-2 2H6a2 2 0 0 1-2-2 2 2 0 0 0 0-4Z" />
      <path d="M14 6v12" strokeDasharray="2 3" />
    </svg>
  ),
  megaphone: (
    <svg {...ICON_PROPS}>
      <path d="M3 11v2a1 1 0 0 0 1 1h2l9 5V5L6 10H4a1 1 0 0 0-1 1Z" />
      <path d="M18 8a4 4 0 0 1 0 8" />
    </svg>
  ),
  cart: (
    <svg {...ICON_PROPS}>
      <path d="M3 4h2l2.5 12h10l2-8H6" />
      <circle cx="9" cy="20" r="1.3" fill="currentColor" />
      <circle cx="18" cy="20" r="1.3" fill="currentColor" />
    </svg>
  ),
  card: (
    <svg {...ICON_PROPS}>
      <rect x="3" y="6" width="18" height="13" rx="2.5" />
      <path d="M3 10h18M7 15h4" />
    </svg>
  ),
  people: (
    <svg {...ICON_PROPS}>
      <circle cx="9" cy="8" r="3" />
      <path d="M3 20a6 6 0 0 1 12 0M16 6a3 3 0 0 1 0 6M21 20a5 5 0 0 0-4-4.9" />
    </svg>
  ),
  scan: (
    <svg {...ICON_PROPS}>
      <path d="M4 8V6a2 2 0 0 1 2-2h2M4 16v2a2 2 0 0 0 2 2h2M20 8V6a2 2 0 0 0-2-2h-2M20 16v2a2 2 0 0 1-2 2h-2M3 12h18" />
    </svg>
  ),
  globe: (
    <svg {...ICON_PROPS}>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" />
    </svg>
  ),
  help: (
    <svg {...ICON_PROPS}>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .8-1 1.5v.4" />
      <circle cx="12" cy="17" r="1" fill="currentColor" />
    </svg>
  ),
  exit: (
    <svg {...ICON_PROPS}>
      <path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 17l5-5-5-5M15 12H3" />
    </svg>
  ),
};

export interface SidebarEventInfo {
  id: string;
  title: string;
  status: string;
}

const EVENT_STATUS_LABEL: Record<string, string> = {
  DRAFT: "Rascunho",
  PUBLISHED: "Publicado",
  SALES_PAUSED: "Vendas pausadas",
  UNPUBLISHED: "Despublicado",
  CANCELLED: "Cancelado",
};

interface NavLink {
  href: string;
  icon: React.ReactNode;
  label: string;
}

function useSidebarLinks(event?: SidebarEventInfo, organizationId?: string) {
  const eventsHref = organizationId ? `/organizacoes/${organizationId}` : "/organizacoes";

  /*
   * Dois NIVEIS, nunca misturados (correção 2026-08-28). Financeiro e
   * Reembolsos sao da PRODUTORA, mas estavam no meio do menu do evento — o
   * produtor clicava, ia parar numa tela de outro nivel e o bloco do evento
   * sumia da lateral, dando a sensacao de ter voltado pro inicio.
   */
  const daProdutora: NavLink[] = [
    { href: "/resumo", icon: icons.grid, label: "Resumo" },
    { href: eventsHref, icon: icons.calendar, label: "Meus eventos" },
    ...(organizationId
      ? [
          { href: `/organizacoes/${organizationId}/financeiro`, icon: icons.card, label: "Financeiro" },
          { href: `/organizacoes/${organizationId}/reembolsos`, icon: icons.card, label: "Reembolsos" },
          { href: `/organizacoes/${organizationId}`, icon: icons.people, label: "Equipe e promoters" },
        ]
      : []),
  ];

  const doEvento: NavLink[] = event
    ? [
        { href: `/eventos/${event.id}/dashboard`, icon: icons.grid, label: "Geral" },
        { href: `/eventos/${event.id}`, icon: icons.ticket, label: "Ingressos" },
        { href: `/eventos/${event.id}/editar`, icon: icons.pencil, label: "Editar evento" },
        { href: `/eventos/${event.id}/divulgue`, icon: icons.megaphone, label: "Divulgue" },
        { href: `/eventos/${event.id}/vendas`, icon: icons.cart, label: "Vendas" },
        { href: `/eventos/${event.id}/participantes`, icon: icons.people, label: "Participantes" },
        { href: `/eventos/${event.id}/portaria`, icon: icons.scan, label: "Check-in" },
      ]
    : [];

  return { eventsHref, daProdutora, doEvento };
}

/**
 * Evento em foco: vem por prop dentro das telas do evento e, FORA delas
 * (financeiro, reembolsos, equipe), volta do que ficou guardado — assim o
 * bloco do evento nao some quando o produtor abre o financeiro.
 */
function useEventoEmFoco(event?: SidebarEventInfo): SidebarEventInfo | undefined {
  const [guardado, setGuardado] = useState<SidebarEventInfo | undefined>(undefined);
  const pathname = usePathname() ?? "";

  useEffect(() => {
    if (event) {
      localStorage.setItem("bf.activeEventInfo", JSON.stringify(event));
      setGuardado(event);
      return;
    }
    try {
      const bruto = localStorage.getItem("bf.activeEventInfo");
      setGuardado(bruto ? (JSON.parse(bruto) as SidebarEventInfo) : undefined);
    } catch {
      setGuardado(undefined);
    }
  }, [event, pathname]);

  return event ?? guardado;
}

const itemBase = "flex items-center gap-[11px] rounded-[11px] px-3 py-[11px] text-[13px] transition-colors";
const itemOff = "font-semibold text-white/60 hover:bg-white/5 hover:text-white/85";
const itemOn = "bg-primary/90 font-bold text-white";

function Item({ href, icon, label, active }: NavLink & { active: boolean }) {
  return (
    <Link href={href} className={`${itemBase} ${active ? itemOn : itemOff} my-0.5 w-full text-left`}>
      <span className="flex w-[18px] justify-center">{icon}</span>
      {label}
    </Link>
  );
}

/** Item que sai do painel (site do comprador) — sempre em nova aba. */
function ExternalItem({ href, icon, label }: NavLink) {
  return (
    <a href={href} target="_blank" rel="noopener" className={`${itemBase} ${itemOff} my-0.5 w-full text-left`}>
      <span className="flex w-[18px] justify-center">{icon}</span>
      {label}
    </a>
  );
}

function useLogout() {
  const router = useRouter();
  const { logout } = useAuth();
  return () => {
    logout();
    router.replace("/login");
  };
}

/**
 * Sidebar dark de 244px (>=1024px). Com `event` mostra as entradas de "Gerenciar
 * evento"; fora do contexto de evento fica reduzida (Meus eventos, Financeiro,
 * Ajuda e Sair).
 */
export function Sidebar({ event, organizationId }: { event?: SidebarEventInfo; organizationId?: string }) {
  const pathname = usePathname() ?? "";
  const emFoco = useEventoEmFoco(event);
  const { eventsHref, daProdutora, doEvento } = useSidebarLinks(emFoco, organizationId);
  const signOut = useLogout();

  return (
    <aside className="flex w-[244px] shrink-0 flex-col bg-sidebar px-3.5 pb-4 pt-[22px]">
      <Link href="/resumo" className="block px-2 pb-4">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/logo-horizontal-escuro.svg" alt="BoraFest" className="h-9 w-auto" />
        <span className="mt-1 block text-[10px] font-semibold text-white/45">Painel do organizador</span>
      </Link>

      {/* NIVEL 1 — a produtora. Trocar de casa acontece aqui e só aqui. */}
      <div className="px-2 pb-2">
        <OrgSwitcher organizationId={organizationId} dark />
      </div>
      {daProdutora.map((link) => (
        <Item key={link.label} {...link} active={pathname === link.href} />
      ))}

      {/* NIVEL 2 — o evento. Continua visível mesmo nas telas da produtora
          (financeiro, reembolsos, equipe): o produtor nunca perde de vista
          em qual evento estava trabalhando. */}
      {emFoco ? (
        <>
          <p className="px-3 pb-1 pt-5 text-[10px] font-bold uppercase tracking-[.08em] text-white/35">
            Evento em foco
          </p>
          <Link
            href={`/eventos/${emFoco.id}/dashboard`}
            className="mx-2 mb-1 flex items-center gap-2.5 rounded-xl bg-white/[.06] px-3 py-[11px] hover:bg-white/10"
          >
            <span className="h-[30px] w-[30px] shrink-0 rounded-lg bg-brand-gradient" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[12px] font-bold leading-[1.1] text-white">{emFoco.title}</span>
              <span className="mt-[3px] block text-[10px] font-medium text-white/45">
                {EVENT_STATUS_LABEL[emFoco.status] ?? emFoco.status}
              </span>
            </span>
          </Link>
          {doEvento.map((link) => (
            <Item key={link.label} {...link} active={pathname === link.href} />
          ))}
        </>
      ) : null}

      <div className="flex-1" />

      <ExternalItem href={CHECKOUT_URL} icon={icons.globe} label="Ver o site" />
      <Item href="/ajuda" icon={icons.help} label="Ajuda" active={pathname === "/ajuda"} />
      <button type="button" onClick={signOut} className={`${itemBase} w-full font-semibold text-white/45 hover:text-white/70`}>
        <span className="flex w-[18px] justify-center">{icons.exit}</span>
        Sair
      </button>
    </aside>
  );
}

