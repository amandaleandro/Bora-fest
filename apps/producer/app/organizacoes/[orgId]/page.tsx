"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { GuardedPanelShell } from "@/components/PanelShell";
import { useAuth } from "@/lib/auth";
import { eventsApi, organizationsApi, type EventSummary, type SalesPartner } from "@/lib/api";

const STATUS_STYLES: Record<string, { bg: string; fg: string; label: string }> = {
  DRAFT: { bg: "bg-warning/10", fg: "text-warning", label: "Rascunho" },
  PUBLISHED: { bg: "bg-success/10", fg: "text-success", label: "Publicado" },
  SALES_PAUSED: { bg: "bg-warning/10", fg: "text-warning", label: "Vendas pausadas" },
  UNPUBLISHED: { bg: "bg-line", fg: "text-muted", label: "Despublicado" },
  CANCELLED: { bg: "bg-danger/10", fg: "text-danger", label: "Cancelado" },
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" });
}

function EventsList({ orgId }: { orgId: string }) {
  const { token } = useAuth();
  const [events, setEvents] = useState<EventSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!token) return;
    setLoading(true);
    setError(null);
    eventsApi
      .list(token, orgId)
      .then(setEvents)
      .catch((err) => setError(err instanceof Error ? err.message : "Não foi possível carregar os eventos"))
      .finally(() => setLoading(false));
  }, [token, orgId, attempt]);

  if (loading) return <p className="text-[13px] font-semibold text-muted">Carregando…</p>;

  if (error) {
    return (
      <div className="rounded-[18px] border border-danger/30 bg-danger/5 p-6 text-center">
        <p className="text-[13px] font-bold text-danger">{error}</p>
        <button
          onClick={() => setAttempt((a) => a + 1)}
          className="mt-3 h-10 rounded-xl bg-primary px-5 text-[13px] font-extrabold text-white shadow-cta"
        >
          Tentar novamente
        </button>
      </div>
    );
  }

  if (events.length === 0) {
    return (
      <div className="rounded-[18px] border border-line bg-surface p-10 text-center">
        <p className="text-[15px] font-extrabold">Nenhum evento ainda</p>
        <p className="mt-1 text-[13px] font-semibold text-muted">
          Crie seu primeiro evento para começar a vender ingressos.
        </p>
        <Link
          href={`/eventos/novo?org=${orgId}`}
          className="mt-5 inline-flex h-11 items-center rounded-xl bg-primary px-5 text-[14px] font-extrabold text-white shadow-cta"
        >
          Criar novo evento
        </Link>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-[18px] border border-line bg-surface">
      <table className="w-full min-w-[560px] text-left text-[13px]">
        <thead>
          <tr className="border-b border-line text-[11px] font-bold uppercase tracking-[.04em] text-muted-2">
            <th className="px-5 py-3.5">Evento</th>
            <th className="px-5 py-3.5">Data</th>
            <th className="px-5 py-3.5">Status</th>
            <th className="px-5 py-3.5" />
          </tr>
        </thead>
        <tbody>
          {events.map((event) => {
            const s = STATUS_STYLES[event.status] ?? { bg: "bg-line", fg: "text-muted", label: event.status };
            return (
              <tr key={event.id} className="border-b border-line-divider last:border-0 hover:bg-bg/50">
                <td className="px-5 py-3.5">
                  <Link href={`/eventos/${event.id}`} className="font-bold text-ink">
                    {event.title}
                  </Link>
                </td>
                <td className="px-5 py-3.5 font-semibold text-muted">{formatDate(event.startsAt)}</td>
                <td className="px-5 py-3.5">
                  <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${s.bg} ${s.fg}`}>{s.label}</span>
                </td>
                <td className="px-5 py-3.5 text-right">
                  <Link href={`/eventos/${event.id}`} className="text-[12px] font-bold text-primary">
                    Gerenciar →
                  </Link>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function SalesPartners({ orgId }: { orgId: string }) {
  const { token } = useAuth();
  const [partners, setPartners] = useState<SalesPartner[]>([]);
  const [name, setName] = useState("");
  const [commission, setCommission] = useState("10");
  const [email, setEmail] = useState("");
  const [selected, setSelected] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  async function load() {
    if (token) setPartners(await organizationsApi.listSalesPartners(token, orgId));
  }
  useEffect(() => { load().catch(() => setMessage("Não foi possível carregar as atléticas")); }, [token, orgId]);

  async function createPartner() {
    if (!token || !name.trim()) return;
    const partner = await organizationsApi.createSalesPartner(token, orgId, {
      name: name.trim(), commissionBps: Math.round(Number(commission || 0) * 100),
    });
    setName(""); setSelected(partner.id); setMessage("Atlética cadastrada"); await load();
  }

  async function inviteSeller() {
    if (!token || !selected || !email.includes("@")) return;
    await organizationsApi.inviteMember(token, orgId, email, "seller", selected);
    setEmail(""); setMessage("Convite de vendedor enviado"); await load();
  }

  return (
    <section className="mt-8 rounded-[18px] border border-line bg-surface p-5">
      <div className="mb-4">
        <h2 className="text-[17px] font-extrabold">Atléticas e parceiros de venda</h2>
        <p className="mt-1 text-[12px] font-semibold text-muted">A comissão pertence à atlética; os vendedores internos não recebem comissão individual.</p>
      </div>
      <div className="grid gap-2 md:grid-cols-[1fr_140px_auto]">
        <input className="h-11 rounded-xl border border-line-input px-3 text-[13px]" placeholder="Nome da atlética" value={name} onChange={(e) => setName(e.target.value)} />
        <input className="h-11 rounded-xl border border-line-input px-3 text-[13px]" type="number" min="0" max="100" placeholder="Comissão %" value={commission} onChange={(e) => setCommission(e.target.value)} />
        <button type="button" onClick={createPartner} className="h-11 rounded-xl bg-primary px-4 text-[13px] font-extrabold text-white">Cadastrar atlética</button>
      </div>
      {partners.length > 0 ? (
        <div className="mt-4 grid gap-2 md:grid-cols-[1fr_1fr_auto]">
          <select className="h-11 rounded-xl border border-line-input px-3 text-[13px]" value={selected} onChange={(e) => setSelected(e.target.value)}>
            <option value="">Escolha a atlética</option>
            {partners.map((partner) => <option key={partner.id} value={partner.id}>{partner.name} · {(partner.commissionBps / 100).toFixed(2)}%</option>)}
          </select>
          <input className="h-11 rounded-xl border border-line-input px-3 text-[13px]" type="email" placeholder="E-mail do vendedor" value={email} onChange={(e) => setEmail(e.target.value)} />
          <button type="button" onClick={inviteSeller} className="h-11 rounded-xl border border-primary px-4 text-[13px] font-extrabold text-primary">Convidar vendedor</button>
        </div>
      ) : null}
      {message ? <p className="mt-3 text-[12px] font-bold text-success">{message}</p> : null}
    </section>
  );
}

export default function OrganizationPage({ params }: { params: { orgId: string } }) {
  return (
    <GuardedPanelShell
      title="Meus eventos"
      organizationId={params.orgId}
      actions={
        <Link
          href={`/eventos/novo?org=${params.orgId}`}
          className="h-10 rounded-xl bg-primary px-4 text-[13px] font-extrabold leading-10 text-white shadow-cta"
        >
          Criar novo evento
        </Link>
      }
    >
      <EventsList orgId={params.orgId} />
      <SalesPartners orgId={params.orgId} />
    </GuardedPanelShell>
  );
}
