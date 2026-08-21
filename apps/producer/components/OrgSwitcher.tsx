"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/lib/auth";
import { organizationsApi, type Organization } from "@/lib/api";

/**
 * Trocador de produtora (2026-08-19). O redesenho gravava a organização ativa
 * e TODOS os caminhos de volta apontavam pra ela — quem tem mais de uma casa
 * ficava preso: a lista geral existia mas nenhum botão levava até ela.
 * Aqui o nome da produtora vira o botão de troca, no lugar onde todo painel
 * multi-conta coloca (topo da navegação).
 */
export function OrgSwitcher({ organizationId, dark }: { organizationId?: string; dark?: boolean }) {
  const { token } = useAuth();
  const router = useRouter();
  const [orgs, setOrgs] = useState<Array<Organization & { roleKey: string }>>([]);
  const [aberto, setAberto] = useState(false);
  const caixa = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!token) return;
    organizationsApi.list(token).then(setOrgs).catch(() => setOrgs([]));
  }, [token]);

  // fecha ao clicar fora
  useEffect(() => {
    if (!aberto) return;
    const fora = (e: MouseEvent) => {
      if (caixa.current && !caixa.current.contains(e.target as Node)) setAberto(false);
    };
    document.addEventListener("mousedown", fora);
    return () => document.removeEventListener("mousedown", fora);
  }, [aberto]);

  const ativaId = organizationId ?? (typeof window !== "undefined" ? localStorage.getItem("bf.activeOrg") : null);
  const ativa = orgs.find((o) => o.id === ativaId) ?? orgs[0];
  if (!ativa) return null;

  const nome = (o: Organization) => o.displayName ?? o.name;

  function trocar(id: string) {
    localStorage.setItem("bf.activeOrg", id);
    // evento ativo pertence à casa antiga — some, senão as abas Vendas/Portaria
    // levariam pra um evento de outra produtora
    localStorage.removeItem("bf.activeEvent");
    setAberto(false);
    router.push("/resumo");
    router.refresh();
  }

  const claro = !dark;

  return (
    <div ref={caixa} className="relative">
      <button
        type="button"
        onClick={() => setAberto((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={aberto}
        className={`flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left transition-colors ${
          claro ? "border border-line bg-surface hover:bg-bg" : "bg-white/[.06] hover:bg-white/10"
        }`}
      >
        <span className="h-[26px] w-[26px] shrink-0 rounded-lg bg-brand-gradient" />
        <span className="min-w-0 flex-1">
          <span className={`block truncate text-[12.5px] font-extrabold leading-tight ${claro ? "text-ink" : "text-white"}`}>
            {nome(ativa)}
          </span>
          <span className={`block text-[10px] font-semibold ${claro ? "text-muted-2" : "text-white/45"}`}>
            {orgs.length > 1 ? "Trocar de produtora" : "Sua produtora"}
          </span>
        </span>
        <span aria-hidden className={`shrink-0 text-[10px] ${claro ? "text-muted-2" : "text-white/45"}`}>▼</span>
      </button>

      {aberto && (
        <div
          role="listbox"
          className="absolute left-0 right-0 top-[calc(100%+6px)] z-50 overflow-hidden rounded-xl border border-line bg-surface shadow-card"
        >
          {orgs.map((o) => (
            <button
              key={o.id}
              type="button"
              role="option"
              aria-selected={o.id === ativa.id}
              onClick={() => trocar(o.id)}
              className={`flex w-full items-center gap-2 px-3 py-2.5 text-left text-[13px] font-bold hover:bg-bg ${
                o.id === ativa.id ? "text-primary" : "text-ink"
              }`}
            >
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: o.id === ativa.id ? "currentColor" : "transparent" }} />
              <span className="min-w-0 flex-1 truncate">{nome(o)}</span>
            </button>
          ))}
          <Link
            href="/organizacoes"
            onClick={() => setAberto(false)}
            className="block border-t border-line-divider px-3 py-2.5 text-[12.5px] font-extrabold text-primary hover:bg-bg"
          >
            + Nova produtora
          </Link>
        </div>
      )}
    </div>
  );
}
