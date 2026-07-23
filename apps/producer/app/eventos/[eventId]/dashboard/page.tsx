"use client";

import { useEffect, useState } from "react";
import { AuthGuard } from "@/components/AuthGuard";
import { Nav } from "@/components/Nav";
import { useAuth } from "@/lib/auth";
import { dashboardApi, type Dashboard } from "@/lib/api";

function formatCents(cents: number): string {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function DashboardContent({ eventId }: { eventId: string }) {
  const { token } = useAuth();
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!token) return;
    dashboardApi
      .get(token, eventId)
      .then(setDashboard)
      .finally(() => setLoading(false));
  }, [token, eventId]);

  if (loading || !dashboard) {
    return (
      <main>
        <Nav />
        <p className="mt-6 text-gray-400">Carregando...</p>
      </main>
    );
  }

  return (
    <main>
      <Nav />
      <h1 className="mt-6 text-xl font-semibold">{dashboard.event.title} — Dashboard</h1>

      <div className="mt-6 grid grid-cols-3 gap-4">
        <div className="rounded-lg bg-gray-800/60 p-4">
          <p className="text-xs text-gray-400">Receita</p>
          <p className="mt-1 text-2xl font-bold text-brand">{formatCents(dashboard.revenueCents)}</p>
        </div>
        <div className="rounded-lg bg-gray-800/60 p-4">
          <p className="text-xs text-gray-400">Pedidos</p>
          <p className="mt-1 text-2xl font-bold">{dashboard.orders.total}</p>
        </div>
        <div className="rounded-lg bg-gray-800/60 p-4">
          <p className="text-xs text-gray-400">Ingressos emitidos</p>
          <p className="mt-1 text-2xl font-bold">{dashboard.tickets.total}</p>
        </div>
      </div>

      <div className="mt-8 grid grid-cols-2 gap-6">
        <div>
          <h2 className="text-sm font-medium text-gray-300">Pedidos por status</h2>
          <table className="mt-2">
            <tbody>
              {Object.entries(dashboard.orders.byStatus).map(([status, count]) => (
                <tr key={status}>
                  <td>{status}</td>
                  <td>{count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div>
          <h2 className="text-sm font-medium text-gray-300">Ingressos por status</h2>
          <table className="mt-2">
            <tbody>
              {Object.entries(dashboard.tickets.byStatus).map(([status, count]) => (
                <tr key={status}>
                  <td>{status}</td>
                  <td>{count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <h2 className="mt-8 text-sm font-medium text-gray-300">Lotes</h2>
      <table className="mt-2">
        <thead>
          <tr>
            <th>Lote</th>
            <th>Vendido</th>
            <th>Reservado</th>
            <th>Disponível</th>
          </tr>
        </thead>
        <tbody>
          {dashboard.lots.map((lot) => (
            <tr key={lot.id}>
              <td>
                {lot.typeName} — {lot.name}
              </td>
              <td>{lot.sold}</td>
              <td>{lot.reserved}</td>
              <td>{lot.available}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}

export default function EventDashboardPage({ params }: { params: { eventId: string } }) {
  return (
    <AuthGuard>
      <DashboardContent eventId={params.eventId} />
    </AuthGuard>
  );
}
