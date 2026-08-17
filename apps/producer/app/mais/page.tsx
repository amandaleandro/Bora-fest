"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { GuardedPanelShell } from "@/components/PanelShell";
import { useAuth } from "@/lib/auth";
import { CHECKOUT_URL } from "@/lib/config";
import { financeApi, organizationsApi, type Balance } from "@/lib/api";

function brl(cents: number): string {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

/** Hub "Mais" (redesenho mobile 2026-08-15): saldo em destaque + tudo da organização. */
function MaisContent() {
  const { token, logout } = useAuth();
  const router = useRouter();
  const [org, setOrg] = useState<string | null>(null);
  const [balance, setBalance] = useState<Balance | null>(null);

  useEffect(() => {
    if (!token) return;
    const salvo = localStorage.getItem("bf.activeOrg");
    if (salvo) {
      setOrg(salvo);
      return;
    }
    organizationsApi
      .list(token)
      .then((list) => {
        if (list[0]) {
          localStorage.setItem("bf.activeOrg", list[0].id);
          setOrg(list[0].id);
        }
      })
      .catch(() => undefined);
  }, [token]);

  useEffect(() => {
    if (!token || !org) return;
    financeApi.getBalance(token, org).then(setBalance).catch(() => undefined);
  }, [token, org]);

  const itens = [
    { label: "Carteira e financeiro", desc: "Saldo, extrato e saques", href: org ? `/organizacoes/${org}/financeiro` : "/organizacoes" },
    { label: "Reembolsos", desc: "Pedidos dos compradores", href: org ? `/organizacoes/${org}/reembolsos` : "/organizacoes" },
    { label: "Equipe e permissões", desc: "Admin, financeiro, check-in e vendedor", href: org ? `/organizacoes/${org}` : "/organizacoes" },
    { label: "Promoters e parceiros", desc: "Comissões, links e placares", href: org ? `/organizacoes/${org}` : "/organizacoes" },
    { label: "Perfil público", desc: "Nome que o comprador vê", href: org ? `/organizacoes/${org}` : "/organizacoes" },
    { label: "Minhas organizações", desc: "Trocar ou criar produtora", href: "/organizacoes" },
    { label: "Ajuda", desc: "Como usar cada parte do painel", href: "/ajuda" },
  ];

  return (
    <div className="mx-auto max-w-[560px] lg:max-w-none">
      <div className="rounded-[20px] bg-brand-gradient p-5 text-white">
        <p className="text-[10.5px] font-extrabold uppercase tracking-[.06em] text-white/80">Saldo disponível para saque</p>
        <p className="mt-1 text-[26px] font-extrabold">
          {balance ? brl(balance.availableForPayoutCents) : "…"}
        </p>
        {balance && balance.balanceCents !== balance.availableForPayoutCents && (
          <p className="mt-0.5 text-[11.5px] font-semibold text-white/75">
            Saldo total {brl(balance.balanceCents)} — o restante libera após os eventos
          </p>
        )}
        {org && (
          <Link
            href={`/organizacoes/${org}/financeiro`}
            className="mt-3 inline-block rounded-xl bg-white px-4 py-2 text-[12.5px] font-extrabold text-primary"
          >
            Ir para o financeiro →
          </Link>
        )}
      </div>

      <div className="mt-4 overflow-hidden rounded-[20px] border border-line bg-surface">
        {itens.map((item) => (
          <Link
            key={item.label}
            href={item.href}
            className="flex items-center justify-between gap-3 border-b border-line-divider p-4 last:border-0"
          >
            <span className="min-w-0">
              <span className="block text-[14px] font-extrabold">{item.label}</span>
              <span className="mt-0.5 block text-[12px] font-semibold text-muted">{item.desc}</span>
            </span>
            <span aria-hidden className="shrink-0 text-muted-2">›</span>
          </Link>
        ))}
        <a
          href={CHECKOUT_URL}
          target="_blank"
          rel="noopener"
          className="flex items-center justify-between gap-3 border-b border-line-divider p-4"
        >
          <span className="block text-[14px] font-extrabold">Ver o site</span>
          <span aria-hidden className="shrink-0 text-muted-2">›</span>
        </a>
        <button
          type="button"
          onClick={() => {
            logout();
            router.replace("/login");
          }}
          className="flex w-full items-center justify-between gap-3 p-4 text-left"
        >
          <span className="block text-[14px] font-extrabold text-danger">Sair</span>
        </button>
      </div>
    </div>
  );
}

export default function MaisPage() {
  return (
    <GuardedPanelShell title="Mais">
      <MaisContent />
    </GuardedPanelShell>
  );
}
