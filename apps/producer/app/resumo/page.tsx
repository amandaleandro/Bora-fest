"use client";

import Link from "next/link";
import { OrgSwitcher } from "@/components/OrgSwitcher";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { GuardedPanelShell } from "@/components/PanelShell";
import { useAuth } from "@/lib/auth";
import {
  organizationsApi,
  type EventSummary,
  type Organization,
} from "@/lib/api";

/** "R$ 96,1 mil" — número grande nunca quebra linha no celular. */
function brlCompact(cents: number): string {
  const v = cents / 100;
  if (v >= 1_000_000) return `R$ ${(v / 1_000_000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mi`;
  if (v >= 10_000) return `R$ ${(v / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mil`;
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

const STATUS_CHIP: Record<string, { bg: string; fg: string; label: string }> = {
  PUBLISHED: { bg: "bg-success/10", fg: "text-success", label: "Publicado" },
  DRAFT: { bg: "bg-warning/10", fg: "text-warning", label: "Rascunho" },
  SALES_PAUSED: { bg: "bg-warning/10", fg: "text-warning", label: "Pausado" },
  UNPUBLISHED: { bg: "bg-line", fg: "text-muted", label: "Despublicado" },
};

/**
 * RESUMO — home do painel (redesenho mobile 2026-08-15): o produtor cai nos
 * números e nos atalhos do dia, não numa lista. Organização ativa fica em
 * localStorage (bf.activeOrg) e alimenta as abas Vendas/Portaria (bf.activeEvent).
 */
function ResumoContent() {
  const { token, user } = useAuth();
  const router = useRouter();
  const [orgs, setOrgs] = useState<Array<Organization & { roleKey: string }>>([]);
  const [activeOrg, setActiveOrg] = useState<string | null>(null);
  const [events, setEvents] = useState<EventSummary[]>([]);
  const [receitaCents, setReceitaCents] = useState<number | null>(null);
  const [vendidos, setVendidos] = useState<number | null>(null);
  const [disponiveis, setDisponiveis] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!token) return;
    organizationsApi
      .list(token)
      .then((list) => {
        setOrgs(list);
        if (list.length === 0) {
          router.replace("/organizacoes");
          return;
        }
        const salvo = localStorage.getItem("bf.activeOrg");
        const escolhida = list.find((o) => o.id === salvo)?.id ?? list[0].id;
        localStorage.setItem("bf.activeOrg", escolhida);
        setActiveOrg(escolhida);
      })
      .catch(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  // troca de produtora sem sair da tela: o /resumo não remonta quando já está
  // aberto, então a mudança chega por evento (2026-08-19)
  useEffect(() => {
    const trocou = (e: Event) => {
      const id = (e as CustomEvent<string>).detail;
      if (id) setActiveOrg(id);
    };
    window.addEventListener("bf.orgchange", trocou);
    return () => window.removeEventListener("bf.orgchange", trocou);
  }, []);

  useEffect(() => {
    if (!token || !activeOrg) return;
    let atual = true;
    setLoading(true);
    // limpa o que era da produtora ANTERIOR: sem isso a tela mostrava o
    // faturamento e os eventos da outra casa até a resposta chegar
    setEvents([]);
    setReceitaCents(null);
    setVendidos(null);
    setDisponiveis(null);

    // uma requisição só (antes: lista de eventos + 1 dashboard POR evento)
    organizationsApi
      .getSummary(token, activeOrg)
      .then((resumo) => {
        if (!atual) return; // troca rápida: resposta velha não sobrescreve a nova
        setEvents(resumo.events);
        setReceitaCents(resumo.revenueCents);
        setVendidos(resumo.ticketsSold);
        setDisponiveis(resumo.ticketsCapacity);
        const preferido = resumo.events.find((e) => e.status === "PUBLISHED") ?? resumo.events[0];
        if (preferido) localStorage.setItem("bf.activeEvent", preferido.id);
        else localStorage.removeItem("bf.activeEvent");
      })
      .catch(() => undefined)
      .finally(() => {
        if (atual) setLoading(false);
      });

    return () => {
      atual = false;
    };
  }, [token, activeOrg]);

  const primeiroNome = (user?.name ?? "").split(" ")[0];
  const hora = new Date().getHours();
  const saudacao = hora < 12 ? "Bom dia" : hora < 18 ? "Boa tarde" : "Boa noite";

  const atalhos = [
    { label: "Criar evento", href: `/eventos/novo?org=${activeOrg ?? ""}`, destaque: true },
    ...(events[0] ? [{ label: "Ver vendas", href: `/eventos/${events[0].id}/vendas`, destaque: false }] : []),
    { label: "Equipe e promoters", href: activeOrg ? `/organizacoes/${activeOrg}` : "/organizacoes", destaque: false },
    { label: "Financeiro", href: activeOrg ? `/organizacoes/${activeOrg}/financeiro` : "/organizacoes", destaque: false },
  ];

  return (
    <div className="mx-auto max-w-[560px] lg:max-w-none">
      <p className="text-[12px] font-extrabold uppercase tracking-[.08em] text-primary">
        {primeiroNome ? `${saudacao}, ${primeiroNome}` : "Bem-vindo(a)"}
      </p>
      <h2 className="mt-1 text-[24px] font-extrabold leading-tight">Seu palco está vivo.</h2>

      <div className="mt-4 lg:hidden">
        <OrgSwitcher organizationId={activeOrg ?? undefined} />
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3">
        <div className="rounded-[20px] bg-brand-gradient p-4 text-white">
          <p className="text-[10.5px] font-extrabold uppercase tracking-[.06em] text-white/80">Receita total</p>
          <p className="mt-1 truncate text-[22px] font-extrabold">
            {receitaCents === null ? "…" : brlCompact(receitaCents)}
          </p>
        </div>
        <div className="rounded-[20px] border border-line bg-surface p-4">
          <p className="text-[10.5px] font-extrabold uppercase tracking-[.06em] text-muted">Ingressos vendidos</p>
          <p className="mt-1 text-[22px] font-extrabold">{vendidos === null ? "…" : vendidos.toLocaleString("pt-BR")}</p>
          {disponiveis !== null && disponiveis > 0 && (
            <p className="text-[11px] font-semibold text-muted">de {disponiveis.toLocaleString("pt-BR")} disponíveis</p>
          )}
        </div>
      </div>

      <h3 className="mt-7 text-[16px] font-extrabold">Atalhos</h3>
      <div className="mt-3 grid grid-cols-2 gap-3">
        {atalhos.map((a) => (
          <Link
            key={a.label}
            href={a.href}
            className={`rounded-[18px] p-4 text-[13.5px] font-extrabold ${
              a.destaque
                ? "bg-primary text-white shadow-cta"
                : "border border-line bg-surface text-ink"
            }`}
          >
            {a.label} <span aria-hidden>↗</span>
          </Link>
        ))}
      </div>

      <div className="mt-7 flex items-center justify-between">
        <h3 className="text-[16px] font-extrabold">Seus eventos</h3>
        {activeOrg && (
          <Link href={`/organizacoes/${activeOrg}`} className="text-[13px] font-extrabold text-primary">
            Ver todos
          </Link>
        )}
      </div>
      {loading ? (
        <p className="mt-3 text-[13px] font-semibold text-muted">Carregando…</p>
      ) : events.length === 0 ? (
        <div className="mt-3 rounded-[18px] border border-line bg-surface p-6 text-center">
          <p className="text-[14px] font-extrabold">Nenhum evento ainda</p>
          <p className="mt-1 text-[12.5px] font-semibold text-muted">Crie o primeiro e comece a vender em minutos.</p>
        </div>
      ) : (
        <div className="mt-3 space-y-2.5">
          {events.slice(0, 4).map((ev) => {
            const chip = STATUS_CHIP[ev.status] ?? { bg: "bg-line", fg: "text-muted", label: ev.status };
            return (
              <Link
                key={ev.id}
                href={`/eventos/${ev.id}/dashboard`}
                onClick={() => localStorage.setItem("bf.activeEvent", ev.id)}
                className="flex items-center gap-3.5 rounded-[18px] border border-line bg-surface p-3.5"
              >
                <span className="flex h-[52px] w-[52px] shrink-0 flex-col items-center justify-center rounded-xl bg-brand-gradient text-white">
                  <span className="text-[15px] font-extrabold leading-none">
                    {new Date(ev.startsAt).toLocaleDateString("pt-BR", { day: "2-digit" })}
                  </span>
                  <span className="text-[9px] font-bold uppercase">
                    {new Date(ev.startsAt).toLocaleDateString("pt-BR", { month: "short" }).replace(".", "")}
                  </span>
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] font-extrabold">{ev.title}</span>
                  <span className={`mt-1 inline-block rounded-full px-2 py-0.5 text-[10.5px] font-bold ${chip.bg} ${chip.fg}`}>
                    {chip.label}
                  </span>
                </span>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function ResumoPage() {
  return (
    <GuardedPanelShell title="Resumo">
      <ResumoContent />
    </GuardedPanelShell>
  );
}
