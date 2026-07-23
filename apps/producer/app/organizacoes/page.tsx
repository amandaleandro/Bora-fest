"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AuthGuard } from "@/components/AuthGuard";
import { Nav } from "@/components/Nav";
import { useAuth } from "@/lib/auth";
import { organizationsApi, type Organization } from "@/lib/api";

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
    <main>
      <Nav />
      <div className="mt-8 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Suas organizações</h1>
        <button
          type="button"
          className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-brand-dark"
          onClick={() => setShowForm((v) => !v)}
        >
          Nova organização
        </button>
      </div>

      {showForm ? (
        <div className="mt-4 space-y-3 rounded-lg bg-gray-800/60 p-4">
          <input placeholder="Nome" className="w-full" value={name} onChange={(e) => setName(e.target.value)} />
          <input
            placeholder="CPF ou CNPJ"
            className="w-full"
            value={document}
            onChange={(e) => setDocument(e.target.value.replace(/\D/g, ""))}
          />
          <select className="w-full" value={kind} onChange={(e) => setKind(e.target.value as any)}>
            <option value="COMPANY">Empresa (CNPJ)</option>
            <option value="INDIVIDUAL">Pessoa física (CPF)</option>
          </select>
          {error ? <p className="text-sm text-red-400">{error}</p> : null}
          <button
            type="button"
            className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-brand-dark"
            onClick={handleCreate}
          >
            Criar
          </button>
        </div>
      ) : null}

      {loading ? (
        <p className="mt-6 text-gray-400">Carregando...</p>
      ) : (
        <div className="mt-6 space-y-2">
          {orgs.map((org) => (
            <Link
              key={org.id}
              href={`/organizacoes/${org.id}`}
              className="flex items-center justify-between rounded-lg bg-gray-800/60 px-4 py-3"
            >
              <span>{org.name}</span>
              <span className="text-xs text-gray-400">
                {org.status} · {org.roleKey}
              </span>
            </Link>
          ))}
          {orgs.length === 0 ? (
            <p className="text-gray-500">Nenhuma organização ainda — crie a primeira acima.</p>
          ) : null}
        </div>
      )}
    </main>
  );
}

export default function OrganizationsPage() {
  return (
    <AuthGuard>
      <OrganizationsContent />
    </AuthGuard>
  );
}
