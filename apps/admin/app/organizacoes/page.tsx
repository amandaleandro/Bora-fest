"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AuthGuard } from "@/components/AuthGuard";
import { Nav } from "@/components/Nav";
import { useAuth } from "@/lib/auth";
import { adminApi, type AdminOrganization } from "@/lib/api";
import { Button, Card, Badge, Table, TableHeader, TableRow, TableHead, TableCell } from "@borafest/ui";

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
    <main className="space-y-6">
      <Nav />
      
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-white sm:text-3xl">Organizações</h1>
          <p className="mt-1 text-sm text-slate-400">Gerencie todas as produtoras e parceiros cadastrados.</p>
        </div>
        <Button size="sm" onClick={load} variant="secondary">
          Atualizar
        </Button>
      </div>

      {loading ? (
        <Card className="flex items-center justify-center py-16">
          <div className="flex items-center gap-3 text-slate-400">
            <svg className="animate-spin h-5 w-5 text-brand" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            <span className="font-medium text-sm">Carregando organizações...</span>
          </div>
        </Card>
      ) : orgs.length === 0 ? (
        <Card className="text-center py-12">
          <p className="text-slate-400">Nenhuma organização encontrada.</p>
        </Card>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nome</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Eventos</TableHead>
              <TableHead>Membros</TableHead>
              <TableHead>Taxa Pix/Cartão</TableHead>
              <TableHead className="text-right">Ação</TableHead>
            </TableRow>
          </TableHeader>
          <tbody>
            {orgs.map((org) => (
              <TableRow key={org.id}>
                <TableCell className="font-semibold text-white">{org.name}</TableCell>
                <TableCell>
                  <Badge variant={org.status === "ACTIVE" ? "success" : "neutral"}>
                    {org.status}
                  </Badge>
                </TableCell>
                <TableCell>{org._count.events}</TableCell>
                <TableCell>{org._count.members}</TableCell>
                <TableCell className="font-mono text-xs">
                  {org.pixFeeBps != null ? `${(org.pixFeeBps / 100).toFixed(2)}%` : "padrão"} /{" "}
                  {org.cardFeeBps != null ? `${(org.cardFeeBps / 100).toFixed(2)}%` : "padrão"}
                </TableCell>
                <TableCell className="text-right">
                  <Link href={`/organizacoes/${org.id}`}>
                    <Button size="sm" variant="ghost" className="hover:text-brand-light">
                      Detalhes →
                    </Button>
                  </Link>
                </TableCell>
              </TableRow>
            ))}
          </tbody>
        </Table>
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
