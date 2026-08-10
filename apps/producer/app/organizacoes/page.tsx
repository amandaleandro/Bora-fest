"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { GuardedPanelShell } from "@/components/PanelShell";
import { useAuth } from "@/lib/auth";
import { organizationsApi, type Organization, type ProducerType, type PromoterEngagement, type PromoterInvite } from "@/lib/api";

const PRODUCER_TYPES: Array<{ value: ProducerType; label: string }> = [
  { value: "CASA", label: "Casa de shows / balada" },
  { value: "ATLETICA", label: "Atlética" },
  { value: "PRODUTORA", label: "Produtora de eventos" },
  { value: "INDEPENDENTE", label: "Produtor independente" },
  { value: "OUTRO", label: "Outro" },
];
const inputCls =
  "h-[46px] w-full rounded-xl border-[1.5px] border-line-input bg-surface px-3.5 text-[14px] font-medium outline-none focus:border-primary";

/**
 * Multi-produtora fica para a v2 (decisão #6) — o login já cai em "Meus eventos".
 * Esta tela continua acessível para quem administra mais de uma organização.
 */
function PromoterInbox() {
  const { token } = useAuth();
  const [invites, setInvites] = useState<PromoterInvite[]>([]);
  const [engagements, setEngagements] = useState<PromoterEngagement[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  async function load() {
    if (!token) return;
    const [inv, eng] = await Promise.all([
      organizationsApi.myPromoterInvites(token).catch(() => []),
      organizationsApi.myPromoterEngagements(token).catch(() => []),
    ]);
    setInvites(inv);
    setEngagements(eng);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  async function respond(linkId: string, accept: boolean) {
    if (!token) return;
    setMessage(null);
    try {
      await organizationsApi.respondPromoterInvite(token, linkId, accept);
      setMessage(accept ? "Convite aceito — seu link já está ativo abaixo." : "Convite recusado.");
      await load();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Não foi possível responder");
    }
  }

  function copyLink(slug: string, id: string) {
    const base = process.env.NEXT_PUBLIC_CHECKOUT_URL ?? "https://borafest.com.br";
    navigator.clipboard.writeText(`${base}/?pr=${slug}`);
    setCopied(id);
    setTimeout(() => setCopied(null), 2000);
  }

  if (invites.length === 0 && engagements.length === 0 && !message) return null;

  return (
    <section className="mb-6 space-y-4">
      {message ? <p className="text-[13px] font-bold text-brand">{message}</p> : null}

      {invites.length > 0 ? (
        <div className="rounded-[18px] border border-brand/30 bg-brand/5 p-5">
          <h2 className="text-[15px] font-extrabold">Convites</h2>
          <p className="mt-1 text-[12px] font-semibold text-muted">
            Produtores querem você como promoter dos eventos deles.
          </p>
          <div className="mt-3 space-y-2">
            {invites.map((invite) => (
              <div
                key={invite.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-surface px-4 py-3"
              >
                <div>
                  <p className="text-[13.5px] font-extrabold">
                    {invite.organization.displayName ?? invite.organization.name}
                  </p>
                  <p className="text-[12px] font-semibold text-muted">
                    convite para {invite.promoterOrg.displayName ?? invite.promoterOrg.name}
                    {invite.commissionBps > 0
                      ? ` · comissão de ${(invite.commissionBps / 100).toFixed(1).replace(".", ",")}% sobre ingressos`
                      : ""}
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => respond(invite.id, true)}
                    className="h-10 rounded-xl bg-primary px-4 text-[13px] font-extrabold text-white"
                  >
                    Aceitar
                  </button>
                  <button
                    type="button"
                    onClick={() => respond(invite.id, false)}
                    className="h-10 rounded-xl border border-line px-4 text-[13px] font-bold"
                  >
                    Recusar
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {engagements.length > 0 ? (
        <div className="rounded-[18px] border border-line bg-surface p-5">
          <h2 className="text-[15px] font-extrabold">Sou promoter</h2>
          <p className="mt-1 text-[12px] font-semibold text-muted">
            Divulgue seu link — toda compra que vier por ele conta para você.
          </p>
          <div className="mt-3 space-y-2">
            {engagements.map((eng) => (
              <div
                key={eng.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-bg px-4 py-3"
              >
                <div>
                  <p className="text-[13.5px] font-extrabold">{eng.hostName}</p>
                  <p className="text-[12px] font-semibold text-muted">
                    {eng.paidOrders} venda{eng.paidOrders === 1 ? "" : "s"}
                    {eng.commissionBps !== undefined
                      ? ` · ${(eng.commissionBps / 100).toFixed(1).replace(".", ",")}% · ${((eng.commissionCents ?? 0) / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })} na sua carteira`
                      : ""}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => copyLink(eng.slug, eng.id)}
                  className="h-10 rounded-xl border border-line px-4 text-[13px] font-bold text-primary"
                >
                  {copied === eng.id ? "Copiado ✓" : "Copiar meu link"}
                </button>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}

function OrganizationsContent() {
  const { token } = useAuth();
  const [orgs, setOrgs] = useState<Array<Organization & { roleKey: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [document, setDocument] = useState("");
  const [kind, setKind] = useState<"INDIVIDUAL" | "COMPANY">("COMPANY");
  const [producerType, setProducerType] = useState<ProducerType | "">("");
  const [error, setError] = useState<string | null>(null);

  async function load() {
    if (!token) return;
    setLoading(true);
    try {
      setOrgs(await organizationsApi.list(token));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  async function handleCreate() {
    if (!token) return;
    setError(null);
    try {
      if (!producerType) { setError("Escolha o tipo de produtor"); return; }
      await organizationsApi.create(token, { name, document, kind, producerType });
      setShowForm(false);
      setName("");
      setDocument("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível criar a organização");
    }
  }

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-[13px] font-semibold text-muted">
          Escolha a produtora para ver os eventos e o financeiro.
        </p>
        <button
          type="button"
          className="rounded-xl border-[1.5px] border-line-input px-4 py-2.5 text-[13px] font-bold text-ink-soft"
          onClick={() => setShowForm((v) => !v)}
        >
          Nova organização
        </button>
      </div>

      <PromoterInbox />
      {showForm ? (
        <div className="mb-4 space-y-3 rounded-[18px] border border-line bg-surface p-5">
          <input placeholder="Nome" className={inputCls} value={name} onChange={(e) => setName(e.target.value)} />
          <input
            placeholder="CPF ou CNPJ"
            className={inputCls}
            value={document}
            onChange={(e) => setDocument(e.target.value.replace(/\D/g, ""))}
          />
          <select
            className={inputCls}
            value={kind}
            onChange={(e) => setKind(e.target.value as "INDIVIDUAL" | "COMPANY")}
          >
            <option value="COMPANY">Empresa (CNPJ)</option>
            <option value="INDIVIDUAL">Pessoa física (CPF)</option>
          </select>
          <select
            className={inputCls}
            value={producerType}
            onChange={(e) => setProducerType(e.target.value as ProducerType | "")}
          >
            <option value="">Tipo de produtor…</option>
            {PRODUCER_TYPES.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
          {error ? <p className="text-[12px] font-semibold text-danger">{error}</p> : null}
          <button
            type="button"
            className="h-11 rounded-xl bg-primary px-5 text-[13px] font-extrabold text-white shadow-cta"
            onClick={handleCreate}
          >
            Criar
          </button>
        </div>
      ) : null}

      {loading ? (
        <p className="text-[13px] font-semibold text-muted">Carregando…</p>
      ) : orgs.length === 0 ? (
        <div className="rounded-[18px] border border-line bg-surface p-10 text-center">
          <p className="text-[15px] font-extrabold">Nenhuma organização ainda</p>
          <p className="mt-1 text-[13px] font-semibold text-muted">Crie a primeira acima para começar a vender.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {orgs.map((org) => (
            <Link
              key={org.id}
              href={`/organizacoes/${org.id}`}
              className="flex items-center justify-between rounded-[14px] border border-line bg-surface px-5 py-4 hover:border-primary/40"
            >
              <span className="text-[14px] font-extrabold text-ink">{org.name}</span>
              <span className="text-[12px] font-semibold text-muted">
                {org.status} · {org.roleKey}
              </span>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}

export default function OrganizationsPage() {
  return (
    <GuardedPanelShell title="Suas organizações">
      <OrganizationsContent />
    </GuardedPanelShell>
  );
}
