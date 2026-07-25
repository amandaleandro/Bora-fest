"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { GuardedPanelShell } from "@/components/PanelShell";
import { useAuth } from "@/lib/auth";
import { organizationsApi, type Organization } from "@/lib/api";

const inputCls =
  "h-[46px] w-full rounded-xl border-[1.5px] border-line-input bg-surface px-3.5 text-[14px] font-medium outline-none focus:border-primary";

/**
 * Multi-produtora fica para a v2 (decisão #6) — o login já cai em "Meus eventos".
 * Esta tela continua acessível para quem administra mais de uma organização.
 */
function OrganizationsContent() {
  const { token } = useAuth();
  const [orgs, setOrgs] = useState<Array<Organization & { roleKey: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [document, setDocument] = useState("");
  const [kind, setKind] = useState<"INDIVIDUAL" | "COMPANY">("COMPANY");
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
      await organizationsApi.create(token, { name, document, kind });
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
