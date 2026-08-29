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
  type OrgEarnings,
} from "@/lib/api";

type EventoComGanho = EventSummary & { netCents: number | null };

function brl(cents: number): string {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

const STATUS_CHIP: Record<string, { bg: string; fg: string; label: string }> = {
  PUBLISHED: { bg: "bg-success/10", fg: "text-success", label: "Publicado" },
  DRAFT: { bg: "bg-warning/10", fg: "text-warning", label: "Rascunho" },
  SALES_PAUSED: { bg: "bg-warning/10", fg: "text-warning", label: "Pausado" },
  SALES_CLOSED: { bg: "bg-line", fg: "text-muted", label: "Vendas fechadas" },
  COMPLETED: { bg: "bg-line", fg: "text-muted", label: "Realizado" },
  CANCELED: { bg: "bg-danger/10", fg: "text-danger", label: "Cancelado" },
  UNPUBLISHED: { bg: "bg-line", fg: "text-muted", label: "Despublicado" },
};

/** Uma parcela do dinheiro. `href` deixa o número levar pra onde se age nele. */
function Parcela({
  label,
  cents,
  nota,
  href,
}: {
  label: string;
  cents: number | null;
  nota?: string;
  href?: string;
}) {
  const corpo = (
    <>
      <p className="text-[10px] font-extrabold uppercase tracking-[.06em] text-muted">{label}</p>
      <p className="mt-1 truncate text-[16px] font-extrabold tabular-nums">
        {cents === null ? "…" : brl(cents)}
      </p>
      {nota && <p className="mt-0.5 text-[10.5px] font-semibold text-muted-2">{nota}</p>}
    </>
  );
  const classe = "min-w-0 rounded-2xl border border-line bg-surface p-3.5";
  return href ? (
    <Link href={href} className={`${classe} block`}>
      {corpo}
    </Link>
  ) : (
    <div className={classe}>{corpo}</div>
  );
}

/**
 * RESUMO — o nível da PRODUTORA (estrutura de 2026-08-29).
 *
 * É aqui que o dono vê o negócio inteiro: quanto já é dele, quanto já caiu na
 * conta, quanto pode sacar hoje e quanto ainda está preso na janela pós-evento.
 * As quatro parcelas somam o total por construção — a conta nunca abre.
 *
 * O número vem do ledger, não dos pedidos: antes esta tela somava
 * `order.totalCents`, que é o BRUTO pago pelo comprador (taxa da plataforma
 * dentro) e que ainda perdia o pedido inteiro no primeiro reembolso parcial.
 * A taxa da plataforma não aparece em lugar nenhum daqui de propósito: o
 * produtor vê o que é dele.
 *
 * Entrar num evento leva ao nível 2 (dados e operação daquele evento); voltar
 * pra cá é sempre um clique na lateral.
 */
function ResumoContent() {
  const { token, user } = useAuth();
  const router = useRouter();
  const [activeOrg, setActiveOrg] = useState<string | null>(null);
  const [events, setEvents] = useState<EventoComGanho[]>([]);
  const [ganhos, setGanhos] = useState<OrgEarnings | null>(null);
  const [semFinanceiro, setSemFinanceiro] = useState(false);
  const [vendidos, setVendidos] = useState<number | null>(null);
  const [disponiveis, setDisponiveis] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!token) return;
    organizationsApi
      .list(token)
      .then((list: Array<Organization & { roleKey: string }>) => {
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
    // dinheiro e os eventos da outra casa até a resposta chegar
    setEvents([]);
    setGanhos(null);
    setSemFinanceiro(false);
    setVendidos(null);
    setDisponiveis(null);

    // uma requisição só (antes: lista de eventos + 1 dashboard POR evento)
    organizationsApi
      .getSummary(token, activeOrg)
      .then((resumo) => {
        if (!atual) return; // troca rápida: resposta velha não sobrescreve a nova
        setEvents(resumo.events);
        setGanhos(resumo.earnings);
        setSemFinanceiro(resumo.earnings === null);
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
  const financeiroHref = activeOrg ? `/organizacoes/${activeOrg}/financeiro` : "/organizacoes";

  return (
    <div className="mx-auto max-w-[560px] lg:max-w-none">
      <p className="text-[12px] font-extrabold uppercase tracking-[.08em] text-primary">
        {primeiroNome ? `${saudacao}, ${primeiroNome}` : "Bem-vindo(a)"}
      </p>
      <h2 className="mt-1 text-[24px] font-extrabold leading-tight">Seu palco está vivo.</h2>

      <div className="mt-4 lg:hidden">
        <OrgSwitcher organizationId={activeOrg ?? undefined} />
      </div>

      {semFinanceiro ? (
        <div className="mt-4 rounded-[20px] border border-line bg-surface p-4">
          <p className="text-[13px] font-semibold text-muted">
            Seu acesso é de vendas — os valores da produtora ficam com quem tem permissão de
            financeiro.
          </p>
        </div>
      ) : (
        <>
          <div className="mt-4 rounded-[20px] bg-brand-gradient p-5 text-white">
            <p className="text-[10.5px] font-extrabold uppercase tracking-[.06em] text-white/80">
              Seu total
            </p>
            <p className="mt-1 truncate text-[30px] font-extrabold tabular-nums">
              {ganhos === null ? "…" : brl(ganhos.totalCents)}
            </p>
            <p className="mt-1 text-[11.5px] font-semibold text-white/75">
              Tudo que já é seu — vendas pagas, sem o que foi reembolsado.
            </p>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Parcela label="Já recebido" cents={ganhos?.receivedCents ?? null} nota="caiu na conta" />
            <Parcela
              label="Disponível"
              cents={ganhos?.availableCents ?? null}
              nota="pode sacar"
              href={financeiroHref}
            />
            <Parcela
              label="A liberar"
              cents={ganhos?.pendingReleaseCents ?? null}
              nota="depois do evento"
            />
            {ganhos !== null && ganhos.inTransitCents > 0 && (
              <Parcela label="A caminho" cents={ganhos.inTransitCents} nota="saque pedido" />
            )}
          </div>

          {/* Só aparece quando existe: saldo devedor é raro (sacou e depois
              houve estorno ou cancelamento) mas precisa ter nome, senão o
              produtor via um "já recebido" que não existe mais. */}
          {ganhos !== null && ganhos.debtCents > 0 && (
            <div className="mt-3 rounded-2xl border border-danger/30 bg-danger/[.04] p-3.5">
              <p className="text-[10px] font-extrabold uppercase tracking-[.06em] text-danger">
                Em aberto
              </p>
              <p className="mt-1 text-[16px] font-extrabold tabular-nums text-danger">
                {brl(ganhos.debtCents)}
              </p>
              <p className="mt-0.5 text-[11.5px] font-semibold text-muted">
                Saiu mais do que entrou — reembolso depois do saque. Some sozinho com as
                próximas vendas, e os saques ficam parados até lá.
              </p>
            </div>
          )}
        </>
      )}

      <div className="mt-3 rounded-[20px] border border-line bg-surface p-4">
        <p className="text-[10.5px] font-extrabold uppercase tracking-[.06em] text-muted">
          Ingressos vendidos
        </p>
        <p className="mt-1 text-[22px] font-extrabold tabular-nums">
          {vendidos === null ? "…" : vendidos.toLocaleString("pt-BR")}
          {disponiveis !== null && disponiveis > 0 && (
            <span className="text-[13px] font-bold text-muted">
              {" "}
              de {disponiveis.toLocaleString("pt-BR")}
            </span>
          )}
        </p>
      </div>

      <div className="mt-7 flex items-center justify-between">
        <h3 className="text-[16px] font-extrabold">Seus eventos</h3>
        {/* o ?org= é obrigatório: sem ele o wizard trava na etapa 1 pedindo
            "abra pelo botão da organização" */}
        <Link
          href={`/eventos/novo?org=${activeOrg ?? ""}`}
          className="text-[13px] font-extrabold text-primary"
        >
          Criar evento
        </Link>
      </div>
      {loading ? (
        <p className="mt-3 text-[13px] font-semibold text-muted">Carregando…</p>
      ) : events.length === 0 ? (
        <div className="mt-3 rounded-[18px] border border-line bg-surface p-6 text-center">
          <p className="text-[14px] font-extrabold">Nenhum evento ainda</p>
          <p className="mt-1 text-[12.5px] font-semibold text-muted">
            Crie o primeiro e comece a vender em minutos.
          </p>
        </div>
      ) : (
        <div className="mt-3 space-y-2.5">
          {events.map((ev) => {
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
                {ev.netCents !== null && (
                  <span className="shrink-0 text-right">
                    <span className="block text-[14px] font-extrabold tabular-nums">{brl(ev.netCents)}</span>
                    <span className="block text-[10px] font-bold uppercase tracking-[.04em] text-muted-2">
                      seu
                    </span>
                  </span>
                )}
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
