"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { eventsApi, type EventSummary } from "@/lib/api";
import type { SidebarEventInfo } from "@/components/Sidebar";

const STATUS_LABEL: Record<string, string> = {
  DRAFT: "Rascunho",
  PUBLISHED: "Publicado",
  SALES_PAUSED: "Vendas pausadas",
  SALES_CLOSED: "Vendas fechadas",
  COMPLETED: "Realizado",
  CANCELED: "Cancelado",
  UNPUBLISHED: "Despublicado",
};

/**
 * Trocador de EVENTO (2026-08-29) — o irmão do OrgSwitcher, um nível abaixo.
 *
 * Sem ele, sair de um evento para outro obrigava a voltar ao Resumo e entrar
 * de novo. Aqui o nome do evento na lateral vira o botão de troca e, o mais
 * importante, a troca MANTÉM A SEÇÃO: quem está em Vendas do evento A cai em
 * Vendas do evento B, não no começo. É o que faz a navegação parecer um só
 * lugar em vez de duas viagens.
 */
export function EventSwitcher({
  event,
  organizationId,
}: {
  event: SidebarEventInfo;
  organizationId?: string;
}) {
  const { token } = useAuth();
  const router = useRouter();
  const pathname = usePathname() ?? "";
  const [eventos, setEventos] = useState<EventSummary[]>([]);
  const [aberto, setAberto] = useState(false);
  const caixa = useRef<HTMLDivElement | null>(null);

  // busca a lista a CADA abertura e refaz quando a produtora muda (bug
  // 2026-08-30: o cache por eventos.length nunca refazia a busca, e depois de
  // trocar de produtora o dropdown ainda listava os eventos da anterior).
  useEffect(() => {
    if (!token || !organizationId || !aberto) return;
    eventsApi.list(token, organizationId).then(setEventos).catch(() => setEventos([]));
  }, [token, organizationId, aberto]);
  useEffect(() => {
    setEventos([]);
  }, [organizationId]);

  useEffect(() => {
    if (!aberto) return;
    const fora = (e: MouseEvent) => {
      if (caixa.current && !caixa.current.contains(e.target as Node)) setAberto(false);
    };
    document.addEventListener("mousedown", fora);
    return () => document.removeEventListener("mousedown", fora);
  }, [aberto]);

  /** A seção aberta agora ("vendas", "portaria", …) para reabrir no outro evento. */
  function secaoAtual(): string {
    const depois = pathname.split(`/eventos/${event.id}`)[1];
    if (depois === undefined) return "/dashboard";
    const seção = depois.replace(/^\//, "").split("/")[0];
    return seção ? `/${seção}` : "";
  }

  function trocar(destino: EventSummary) {
    setAberto(false);
    if (destino.id === event.id) return;
    localStorage.setItem("bf.activeEvent", destino.id);
    localStorage.setItem(
      "bf.activeEventInfo",
      JSON.stringify({ id: destino.id, title: destino.title, status: destino.status }),
    );
    router.push(`/eventos/${destino.id}${secaoAtual()}`);
  }

  return (
    <div ref={caixa} className="relative mx-2 mb-1">
      <button
        type="button"
        onClick={() => setAberto((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={aberto}
        className="flex w-full items-center gap-2.5 rounded-xl bg-white/[.06] px-3 py-[11px] text-left hover:bg-white/10"
      >
        <span className="h-[30px] w-[30px] shrink-0 rounded-lg bg-brand-gradient" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[12px] font-bold leading-[1.1] text-white">
            {event.title}
          </span>
          <span className="mt-[3px] block text-[10px] font-medium text-white/45">
            {STATUS_LABEL[event.status] ?? event.status} · trocar
          </span>
        </span>
        <span aria-hidden className="shrink-0 text-[10px] text-white/45">▼</span>
      </button>

      {aberto && (
        <div
          role="listbox"
          className="absolute left-0 right-0 top-[calc(100%+6px)] z-50 max-h-[320px] overflow-y-auto rounded-xl border border-line bg-surface shadow-card"
        >
          {eventos.length === 0 ? (
            <p className="px-3 py-2.5 text-[12.5px] font-semibold text-muted">Carregando…</p>
          ) : (
            eventos.map((e) => (
              <button
                key={e.id}
                type="button"
                role="option"
                aria-selected={e.id === event.id}
                onClick={() => trocar(e)}
                className={`flex w-full items-center gap-2 px-3 py-2.5 text-left text-[13px] font-bold hover:bg-bg ${
                  e.id === event.id ? "text-primary" : "text-ink"
                }`}
              >
                <span
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{ background: e.id === event.id ? "currentColor" : "transparent" }}
                />
                <span className="min-w-0 flex-1 truncate">{e.title}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
