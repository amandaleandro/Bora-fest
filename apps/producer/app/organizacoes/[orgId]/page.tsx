"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { GuardedPanelShell } from "@/components/PanelShell";
import { InviteMemberModal } from "@/components/InviteMemberModal";
import { useAuth } from "@/lib/auth";
import { eventsApi, organizationsApi, type EventSummary, type PromoterRow, type SalesPartner } from "@/lib/api";

function PublicProfile({ orgId }: { orgId: string }) {
  const { token } = useAuth();
  const [displayName, setDisplayName] = useState("");
  const [legalName, setLegalName] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    organizationsApi
      .list(token)
      .then((orgs) => {
        const org = orgs.find((o) => o.id === orgId);
        if (org) {
          setLegalName(org.name);
          setDisplayName(org.displayName ?? "");
        }
      })
      .catch(() => undefined);
  }, [token, orgId]);

  async function save() {
    if (!token || saving) return;
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      await organizationsApi.update(token, orgId, {
        displayName: displayName.trim() || null,
      });
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível salvar");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="mt-8 rounded-[18px] border border-line bg-surface p-5">
      <h2 className="text-[17px] font-extrabold">Perfil público</h2>
      <p className="mt-1 text-[12px] font-semibold text-muted">
        É este nome que o comprador vê na página dos seus eventos ("Por …"). Deixe em branco para
        usar o nome cadastral{legalName ? ` (${legalName})` : ""}.
      </p>
      <div className="mt-3 grid gap-2 md:grid-cols-[1fr_auto]">
        <input
          className="h-11 rounded-xl border border-line-input px-3 text-[13px]"
          placeholder="Ex.: Atlética XANA"
          maxLength={80}
          value={displayName}
          onChange={(e) => {
            setDisplayName(e.target.value);
            setSaved(false);
          }}
        />
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="h-11 rounded-xl bg-primary px-5 text-[13px] font-extrabold text-white disabled:opacity-50"
        >
          {saving ? "Salvando…" : "Salvar"}
        </button>
      </div>
      {saved ? <p className="mt-2 text-[12px] font-bold text-success">Salvo — já vale para todos os seus eventos.</p> : null}
      {error ? <p className="mt-2 text-[12px] font-bold text-danger">{error}</p> : null}
    </section>
  );
}

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

function NewPartnerForm({ orgId, onCreated }: { orgId: string; onCreated: () => Promise<void> }) {
  const { token } = useAuth();
  const [name, setName] = useState("");
  const [commission, setCommission] = useState("10");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function createPartner() {
    if (!token || !name.trim() || saving) return;
    setSaving(true);
    setError(null);
    try {
      await organizationsApi.createSalesPartner(token, orgId, {
        name: name.trim(), commissionBps: Math.round(Number(commission || 0) * 100),
      });
      setName("");
      setCommission("10");
      await onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível cadastrar a atlética");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-[16px] border border-dashed border-line bg-bg/40 p-4">
      <p className="text-[13px] font-extrabold">Cadastrar nova atlética</p>
      <div className="mt-3 grid gap-2 md:grid-cols-[1fr_140px_auto]">
        <input className="h-11 rounded-xl border border-line-input px-3 text-[13px]" placeholder="Nome da atlética" value={name} onChange={(e) => setName(e.target.value)} />
        <input className="h-11 rounded-xl border border-line-input px-3 text-[13px]" type="number" min="0" max="100" placeholder="Comissão %" value={commission} onChange={(e) => setCommission(e.target.value)} />
        <button
          type="button"
          onClick={createPartner}
          disabled={saving || !name.trim()}
          className="h-11 rounded-xl bg-primary px-4 text-[13px] font-extrabold text-white disabled:opacity-50"
        >
          {saving ? "Cadastrando…" : "Cadastrar atlética"}
        </button>
      </div>
      {error ? <p className="mt-2 text-[12px] font-bold text-danger">{error}</p> : null}
    </div>
  );
}

function PartnerCard({ orgId, partner, onChanged }: { orgId: string; partner: SalesPartner; onChanged: () => Promise<void> }) {
  const { token } = useAuth();
  const [email, setEmail] = useState("");
  const [inviting, setInviting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function inviteSeller() {
    if (!token || !email.includes("@") || inviting) return;
    setInviting(true);
    setError(null);
    setSuccess(null);
    try {
      await organizationsApi.inviteMember(token, orgId, email, "seller", partner.id);
      setEmail("");
      setSuccess("Convite enviado");
      await onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível enviar o convite");
    } finally {
      setInviting(false);
    }
  }

  return (
    <div className="rounded-[16px] border border-line bg-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[14px] font-extrabold">{partner.name}</p>
        <span className="rounded-full bg-primary/10 px-2.5 py-1 text-[11px] font-bold text-primary">
          {(partner.commissionBps / 100).toFixed(2)}% comissão
        </span>
      </div>

      <div className="mt-3">
        <p className="text-[11px] font-bold uppercase tracking-[.04em] text-muted-2">
          Vendedores {partner.members.length > 0 ? `(${partner.members.length})` : ""}
        </p>
        {partner.members.length === 0 ? (
          <p className="mt-1.5 text-[12px] font-semibold text-muted">Nenhum vendedor convidado ainda.</p>
        ) : (
          <ul className="mt-1.5 flex flex-col gap-1">
            {partner.members.map((m) => (
              <li key={m.user.id} className="flex items-center gap-2 text-[13px] font-semibold">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-line text-[10px] font-extrabold text-muted-2">
                  {(m.user.name ?? m.user.email ?? "?").slice(0, 1).toUpperCase()}
                </span>
                <span>{m.user.name ?? m.user.email ?? m.user.id}</span>
                {m.user.name && m.user.email ? <span className="text-muted">· {m.user.email}</span> : null}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <input
          className="h-10 min-w-[200px] flex-1 rounded-xl border border-line-input px-3 text-[13px]"
          type="email"
          placeholder="E-mail do vendedor"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <button
          type="button"
          onClick={inviteSeller}
          disabled={inviting || !email.includes("@")}
          className="h-10 rounded-xl border border-primary px-4 text-[13px] font-extrabold text-primary disabled:opacity-50"
        >
          {inviting ? "Enviando…" : "Convidar vendedor"}
        </button>
      </div>
      {error ? <p className="mt-2 text-[12px] font-bold text-danger">{error}</p> : null}
      {success ? <p className="mt-2 text-[12px] font-bold text-success">{success}</p> : null}
    </div>
  );
}


function brl(cents: number): string {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function Promoters({ orgId }: { orgId: string }) {
  const { token } = useAuth();
  const [promoters, setPromoters] = useState<PromoterRow[]>([]);
  const [email, setEmail] = useState("");
  const [commissionType, setCommissionType] = useState<"NONE" | "PERCENT" | "FIXED">("NONE");
  const [valor, setValor] = useState("10");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [aberto, setAberto] = useState<string | null>(null);
  const [sellers, setSellers] = useState<Record<string, Array<{ id: string; sellerName: string; status: string; paidOrders: number; soldCents: number }>>>({});

  async function load() {
    if (!token) return;
    setPromoters(await organizationsApi.listPromoters(token, orgId).catch(() => []));
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, orgId]);

  async function convidar() {
    if (!token || !email.includes("@")) return;
    setBusy(true);
    setMessage(null);
    try {
      await organizationsApi.invitePromoter(token, orgId, {
        email: email.trim(),
        commissionType,
        // contrato: commissionBps 0..5000 (máx. 50%) — clampa pra não tomar 400
        ...(commissionType === "PERCENT"
          ? { commissionBps: Math.min(Math.round(Number(valor || 0) * 100), 5000) }
          : {}),
        ...(commissionType === "FIXED" ? { commissionFixedCents: Math.round(Number(valor || 0) * 100) } : {}),
      });
      setMessage("Convite enviado — a pessoa aceita no painel dela (não precisa ser produtor).");
      setEmail("");
      await load();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Não foi possível convidar");
    } finally {
      setBusy(false);
    }
  }

  async function verVendedores(linkId: string) {
    if (!token) return;
    if (aberto === linkId) {
      setAberto(null);
      return;
    }
    setAberto(linkId);
    const lista = await organizationsApi.listSellersOfPromoter(token, linkId).catch(() => []);
    setSellers((prev) => ({ ...prev, [linkId]: lista }));
  }

  function copyLink(slug: string, id: string) {
    const base = process.env.NEXT_PUBLIC_CHECKOUT_URL ?? "https://borafest.com.br";
    navigator.clipboard.writeText(`${base}/?pr=${slug}`);
    setCopied(id);
    setTimeout(() => setCopied(null), 2000);
  }

  function comissaoLabel(p: PromoterRow): string {
    if (p.commissionType === "PERCENT") return `${((p.commissionBps ?? 0) / 100).toFixed(1).replace(".", ",")}% por venda`;
    if (p.commissionType === "FIXED") return `${brl(p.commissionFixedCents ?? 0)} por ingresso`;
    return "sem comissão (só contabiliza)";
  }

  return (
    <section className="mt-8">
      <div className="mb-4">
        <h2 className="text-[17px] font-extrabold">Promoters</h2>
        <p className="mt-1 text-[12px] font-semibold text-muted">
          Convide por e-mail — a pessoa não precisa ter conta de produtor. Você define se ela recebe
          comissão; sem comissão, o dinheiro das vendas fica todo com você e o sistema só contabiliza.
        </p>
      </div>

      <div className="rounded-[16px] border border-dashed border-line bg-bg/40 p-4">
        <div className="grid gap-2 md:grid-cols-[1fr_170px_120px_auto]">
          <input
            className="h-11 rounded-xl border border-line-input px-3 text-[13px]"
            placeholder="E-mail do promoter"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <select
            className="h-11 rounded-xl border border-line-input px-3 text-[13px]"
            value={commissionType}
            onChange={(e) => setCommissionType(e.target.value as "NONE" | "PERCENT" | "FIXED")}
          >
            <option value="NONE">Sem comissão</option>
            <option value="PERCENT">% por venda</option>
            <option value="FIXED">R$ por ingresso</option>
          </select>
          {commissionType !== "NONE" ? (
            <input
              className="h-11 rounded-xl border border-line-input px-3 text-[13px]"
              type="number"
              min="0.5"
              step="0.5"
              max={commissionType === "PERCENT" ? 50 : undefined}
              value={valor}
              onChange={(e) => setValor(e.target.value)}
              placeholder={commissionType === "PERCENT" ? "% (máx. 50)" : "R$"}
            />
          ) : (
            <span />
          )}
          <button
            type="button"
            onClick={convidar}
            disabled={busy || !email.includes("@")}
            className="h-11 rounded-xl bg-primary px-5 text-[13px] font-extrabold text-white disabled:opacity-50"
          >
            {busy ? "Enviando…" : "Convidar"}
          </button>
        </div>
        {message ? <p className="mt-2 text-[12px] font-bold text-brand">{message}</p> : null}
      </div>

      {promoters.length > 0 ? (
        <div className="mt-3 space-y-2">
          {promoters.map((p) => (
            <div key={p.id} className="rounded-[16px] border border-line bg-surface px-4 py-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-[13.5px] font-extrabold">{p.promoterName}</p>
                  <p className="text-[12px] font-semibold text-muted">
                    {p.status === "INVITED" ? "Aguardando aceite" : "Ativo"} · {comissaoLabel(p)} ·{" "}
                    {p.paidOrders} venda{p.paidOrders === 1 ? "" : "s"} ({brl(p.soldCents)})
                    {p.commissionCents > 0 ? ` · ${brl(p.commissionCents)} em comissões` : ""}
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => verVendedores(p.id)}
                    className="h-9 rounded-xl border border-line px-3 text-[12.5px] font-bold"
                  >
                    {p.sellers} vendedor{p.sellers === 1 ? "" : "es"}
                  </button>
                  {p.status === "ACTIVE" ? (
                    <button
                      type="button"
                      onClick={() => copyLink(p.slug, p.id)}
                      className="h-9 rounded-xl border border-line px-4 text-[12.5px] font-bold text-primary"
                    >
                      {copied === p.id ? "Copiado ✓" : "Copiar link"}
                    </button>
                  ) : null}
                </div>
              </div>
              {aberto === p.id ? (
                <div className="mt-3 border-t border-line-divider pt-3">
                  {(sellers[p.id] ?? []).length === 0 ? (
                    <p className="text-[12px] font-semibold text-muted">
                      Nenhum vendedor ainda — quem cadastra é o próprio promoter, no painel dele.
                    </p>
                  ) : (
                    <ul className="space-y-1.5">
                      {(sellers[p.id] ?? []).map((s) => (
                        <li key={s.id} className="flex justify-between text-[12.5px] font-semibold">
                          <span>
                            {s.sellerName}
                            {s.status === "INVITED" ? " (aguardando)" : ""}
                          </span>
                          <span className="text-muted">
                            {s.paidOrders} venda{s.paidOrders === 1 ? "" : "s"} · {brl(s.soldCents)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function SalesPartners({ orgId }: { orgId: string }) {
  const { token } = useAuth();
  const [partners, setPartners] = useState<SalesPartner[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    if (!token) return;
    const data = await organizationsApi.listSalesPartners(token, orgId);
    setPartners(data);
  }

  useEffect(() => {
    setLoading(true);
    load()
      .catch((err) => setError(err instanceof Error ? err.message : "Não foi possível carregar as atléticas"))
      .finally(() => setLoading(false));
  }, [token, orgId]);

  return (
    <section className="mt-8">
      <div className="mb-4">
        <h2 className="text-[17px] font-extrabold">Atléticas e parceiros de venda</h2>
        <p className="mt-1 text-[12px] font-semibold text-muted">A comissão pertence à atlética; cada uma pode ter vários vendedores, que não recebem comissão individual.</p>
      </div>

      {loading ? (
        <p className="text-[13px] font-semibold text-muted">Carregando…</p>
      ) : error ? (
        <p className="text-[13px] font-bold text-danger">{error}</p>
      ) : (
        <div className="flex flex-col gap-3">
          {partners.map((partner) => (
            <PartnerCard key={partner.id} orgId={orgId} partner={partner} onChanged={load} />
          ))}
        </div>
      )}

      <div className="mt-3">
        <NewPartnerForm orgId={orgId} onCreated={load} />
      </div>
    </section>
  );
}

/**
 * Equipe da organização: convite de papéis internos (admin/financeiro/check-in).
 * Antes, o InviteMemberModal existia pronto mas não era renderizado em lugar
 * nenhum — não havia como o dono delegar esses papéis pela UI (só vendedor, via
 * atlética). Não há endpoint de LISTAR membros, então por ora a seção é só de
 * convite; os rótulos dos papéis foram alinhados ao poder real (lib/api.ts).
 */
function Team({ orgId }: { orgId: string }) {
  const [open, setOpen] = useState(false);
  return (
    <section className="mt-8 rounded-[18px] border border-line bg-surface p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-[17px] font-extrabold">Equipe</h2>
          <p className="mt-1 max-w-xl text-[12px] font-semibold text-muted">
            Convide pessoas para ajudar a tocar seus eventos. Cada papel dá acesso só ao que
            precisa — administrador (tudo, menos check-in no app), financeiro (pedidos, reembolsos
            e saque) ou check-in (só o app de validação).
          </p>
        </div>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="h-11 shrink-0 rounded-xl bg-primary px-5 text-[13px] font-extrabold text-white shadow-cta"
        >
          Convidar para a equipe
        </button>
      </div>
      {open ? <InviteMemberModal organizationId={orgId} onClose={() => setOpen(false)} /> : null}
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
      <PublicProfile orgId={params.orgId} />
      <Team orgId={params.orgId} />
      <Promoters orgId={params.orgId} />
      <SalesPartners orgId={params.orgId} />
    </GuardedPanelShell>
  );
}
