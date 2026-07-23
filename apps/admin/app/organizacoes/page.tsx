"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AuthGuard } from "@/components/AuthGuard";
import { Nav } from "@/components/Nav";
import { useAuth } from "@/lib/auth";
import { adminApi, type AdminOrganization } from "@/lib/api";

function OrganizationsContent() {
  const { token } = useAuth();
  const [orgs, setOrgs] = useState<AdminOrganization[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    if (!token) return;
    setLoading(true);
    try {
      setOrgs(await adminApi.listOrganizations(token));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  return (
    <main>
      <Nav />
      <h1 className="mt-6 text-xl font-semibold">Organizações</h1>

      {loading ? (
        <p className="mt-6 text-gray-400">Carregando...</p>
      ) : (
        <table className="mt-6">
          <thead>
            <tr>
              <th>Nome</th>
              <th>Status</th>
              <th>Eventos</th>
              <th>Membros</th>
              <th>Taxa Pix/Cartão</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {orgs.map((org) => (
              <tr key={org.id}>
                <td>{org.name}</td>
                <td>{org.status}</td>
                <td>{org._count.events}</td>
                <td>{org._count.members}</td>
                <td>
                  {org.pixFeeBps != null ? `${(org.pixFeeBps / 100).toFixed(2)}%` : "padrão"} /{" "}
                  {org.cardFeeBps != null ? `${(org.cardFeeBps / 100).toFixed(2)}%` : "padrão"}
                </td>
                <td>
                  <Link href={`/organizacoes/${org.id}`} className="text-brand underline">
                    Detalhes
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
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
