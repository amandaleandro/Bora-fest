"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";
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

  // Sem organização carregada, Financeiro/Reembolsos apontariam todos para
  // "/organizacoes" — mesmos hrefs (e keys) de "Meus eventos", o que duplicava
  // itens na faixa mobile enquanto o contexto carregava. Só entram com o id.
  const orgLinks: NavLink[] = organizationId
    ? [
        { href: `/organizacoes/${organizationId}/financeiro`, icon: icons.card, label: "Financeiro" },
        { href: `/organizacoes/${organizationId}/reembolsos`, icon: icons.card, label: "Reembolsos" },
      ]
    : [];

  const manage: NavLink[] = event
    ? [
        { href: `/eventos/${event.id}/dashboard`, icon: icons.grid, label: "Geral" },
        { href: `/eventos/${event.id}`, icon: icons.ticket, label: "Ingressos" },
        { href: `/eventos/${event.id}/divulgue`, icon: icons.megaphone, label: "Divulgue" },
        { href: `/eventos/${event.id}/vendas`, icon: icons.cart, label: "Vendas" },
        ...orgLinks,
        { href: `/eventos/${event.id}/participantes`, icon: icons.people, label: "Participantes" },
        { href: `/eventos/${event.id}/portaria`, icon: icons.scan, label: "Check-in" },
      ]
    : orgLinks;

  return { eventsHref, manage };
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
  const { eventsHref, manage } = useSidebarLinks(event, organizationId);
  const signOut = useLogout();

  return (
    <aside className="flex w-[244px] shrink-0 flex-col bg-sidebar px-3.5 pb-4 pt-[22px]">
      <Link href={eventsHref} className="block px-2 pb-5">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/logo-horizontal-escuro.svg" alt="BoraFest" className="h-9 w-auto" />
        <span className="mt-1 block text-[10px] font-semibold text-white/45">Painel do organizador</span>
      </Link>

      <Item href={eventsHref} icon={icons.calendar} label="Meus eventos" active={pathname === eventsHref} />

      {event ? (
        <>
          <Link
            href={`/eventos/${event.id}`}
            className="mx-2 mb-2 mt-4 flex items-center gap-2.5 rounded-xl bg-white/[.06] px-3 py-[11px] hover:bg-white/10"
          >
            <span className="h-[30px] w-[30px] shrink-0 rounded-lg bg-brand-gradient" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[12px] font-bold leading-[1.1] text-white">{event.title}</span>
              <span className="mt-[3px] block text-[10px] font-medium text-white/45">
                {EVENT_STATUS_LABEL[event.status] ?? event.status}
              </span>
            </span>
          </Link>
          <p className="px-3 pb-2 pt-3 text-[10px] font-bold uppercase tracking-[.08em] text-white/35">
            Gerenciar evento
          </p>
        </>
      ) : null}

      {manage.map((link) => (
        <Item key={link.label} {...link} active={pathname === link.href} />
      ))}

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

/** Abaixo de 1024px a sidebar vira uma faixa dark rolável no topo. */
export function SidebarStrip({ event, organizationId }: { event?: SidebarEventInfo; organizationId?: string }) {
  const pathname = usePathname() ?? "";
  const { eventsHref, manage } = useSidebarLinks(event, organizationId);
  const signOut = useLogout();

  const links: NavLink[] = [
    { href: eventsHref, icon: icons.calendar, label: "Meus eventos" },
    ...manage,
    { href: "/ajuda", icon: icons.help, label: "Ajuda" },
  ];

  return (
    <nav className="flex gap-1.5 overflow-x-auto bg-sidebar px-4 py-2.5 lg:hidden">
      {links.map((link) => (
        <Link
          key={link.label}
          href={link.href}
          className={`flex shrink-0 items-center gap-2 rounded-[11px] px-3 py-2 text-[12px] ${
            pathname === link.href ? itemOn : itemOff
          }`}
        >
          {link.icon}
          {link.label}
        </Link>
      ))}
      <a
        href={CHECKOUT_URL}
        target="_blank"
        rel="noopener"
        className={`flex shrink-0 items-center gap-2 rounded-[11px] px-3 py-2 text-[12px] ${itemOff}`}
      >
        {icons.globe}
        Ver o site
      </a>
      <button
        type="button"
        onClick={signOut}
        className="flex shrink-0 items-center gap-2 rounded-[11px] px-3 py-2 text-[12px] font-semibold text-white/45"
      >
        {icons.exit}
        Sair
      </button>
    </nav>
  );
}
