"use client";

import { useEffect, useState } from "react";
import { AuthGuard } from "@/components/AuthGuard";
import { Nav } from "@/components/Nav";
import { useAuth } from "@/lib/auth";
import { adminApi, type WebhookDelivery } from "@/lib/api";

function WebhooksContent() {
  const { token } = useAuth();
  const [webhooks, setWebhooks] = useState<WebhookDelivery[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!token) return;
    adminApi
      .listWebhooks(token)
      .then(setWebhooks)
      .finally(() => setLoading(false));
  }, [token]);

  return (
    <main>
      <Nav />
      <h1 className="mt-6 text-xl font-semibold">Webhooks recebidos</h1>

      {loading ? (
        <p className="mt-6 text-gray-400">Carregando...</p>
      ) : (
        <table className="mt-6">
          <thead>
            <tr>
              <th>Provedor</th>
              <th>Evento</th>
              <th>Assinatura</th>
              <th>Status</th>
              <th>Recebido em</th>
            </tr>
          </thead>
          <tbody>
            {webhooks.map((w) => (
              <tr key={w.id}>
                <td>{w.provider}</td>
                <td>{w.eventType ?? "—"}</td>
                <td className={w.signatureValid ? "text-green-400" : "text-red-400"}>
                  {w.signatureValid ? "válida" : "inválida"}
                </td>
                <td>{w.status}</td>
                <td>{new Date(w.receivedAt).toLocaleString("pt-BR")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}

export default function WebhooksPage() {
  return (
    <AuthGuard>
      <WebhooksContent />
    </AuthGuard>
  );
}
