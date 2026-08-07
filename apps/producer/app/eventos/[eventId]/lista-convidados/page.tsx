"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AuthGuard } from "@/components/AuthGuard";
import { useAuth } from "@/lib/auth";
import { useEventShell } from "@/lib/eventContext";
import {
  catalogApi,
  dashboardApi,
  guestListApi,
  organizationsApi,
  type GuestListEntry,
  type SalesPartner,
} from "@/lib/api";

const STATUS_LABELS: Record<string, { label: string; bg: string; fg: string }> = {
  CONFIRMED: { label: "Confirmado", bg: "bg-primary/10", fg: "text-primary" },
  CHECKED_IN: { label: "Entrou", bg: "bg-success/10", fg: "text-success" },
  CANCELED: { label: "Cancelado", bg: "bg-line", fg: "text-muted" },
};

function GuestListContent({ eventId }: { eventId: string }) {
  const { token } = useAuth();
  const { organization } = useEventShell();

  const [entries, setEntries] = useState<GuestListEntry[]>([]);
  const [lots, setLots] = useState<Array<{ id: string; name: string; typeName: string }>>([]);
  const [partners, setPartners] = useState<SalesPartner[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [ticketLotId, setTicketLotId] = useState("");
  const [guestName, setGuestName] = useState("");
  const [guestDocument, setGuestDocument] = useState("");
  const [guestPhone, setGuestPhone] = useState("");
  const [salesPartnerId, setSalesPartnerId] = useState("");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  async function loadEntries() {
    if (!token) return;
    try {
      const list = await guestListApi.list(token, eventId);
      setEntries(list);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível carregar a lista de convidados");
    }
  }

  useEffect(() => {
    if (!token || !organization) return;
    setLoading(true);
    Promise.all([
      dashboardApi.get(token, eventId).then((d) =>
        setLots(d.lots.map((l) => ({ id: l.id, name: l.name, typeName: l.typeName }))),
      ),
      organizationsApi.listSalesPartners(token, organization.id).then(setPartners).catch(() => {}),
      loadEntries(),
    ]).finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, organization, eventId]);

  // Emissão do ingresso do convidado roda assíncrona (worker via outbox) —
  // como no check-in ao vivo, atualizamos periodicamente pra refletir o status sem F5.
  useEffect(() => {
    if (!token) return;
    const id = setInterval(loadEntries, 10_000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, eventId]);

  async function handleAddGuest() {
    if (!token || !ticketLotId || guestName.trim().length < 2) return;
    setSaving(true);
    setFormError(null);
    try {
      await guestListApi.create(token, eventId, {
        ticketLotId,
        guestName: guestName.trim(),
        guestDocument: guestDocument.trim() || undefined,
        guestPhone: guestPhone.trim() || undefined,
        salesPartnerId: salesPartnerId || undefined,
      });
      setGuestName("");
      setGuestDocument("");
      setGuestPhone("");
      await loadEntries();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Não foi possível adicionar o convidado");
    } finally {
      setSaving(false);
    }
  }

  async function handleCancel(entry: GuestListEntry) {
    if (!token) return;
    if (!window.confirm(`Cancelar a entrada de "${entry.guestName}" na lista?`)) return;
    try {
      await guestListApi.cancel(token, eventId, entry.id);
      await loadEntries();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível cancelar o convidado");
    }
  }

  if (loading) {
    return (
      <main>
        <p className="mt-6 text-muted">Carregando...</p>
      </main>
    );
  }

  return (
    <main>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-[22px] font-extrabold">Lista de convidados</h1>
          <Link href={`/eventos/${eventId}`} className="text-[13px] font-bold text-primary">
            Voltar ao evento →
          </Link>
        </div>
      </div>

      {error ? <p className="mt-4 text-[13px] font-semibold text-danger">{error}</p> : null}

      <section className="mt-5 rounded-2xl border border-line bg-surface p-5">
        <h2 className="text-[15px] font-extrabold">Adicionar convidado</h2>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <select className="w-full" value={ticketLotId} onChange={(e) => setTicketLotId(e.target.value)}>
            <option value="">Selecione o lote da lista de convidados</option>
            {lots.map((lot) => (
              <option key={lot.id} value={lot.id}>
                {lot.typeName} — {lot.name}
              </option>
            ))}
          </select>
          <select className="w-full" value={salesPartnerId} onChange={(e) => setSalesPartnerId(e.target.value)}>
            <option value="">Sem parceiro (cadastrado direto pela casa)</option>
            {partners.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <input
            placeholder="Nome do convidado"
            className="w-full"
            value={guestName}
            onChange={(e) => setGuestName(e.target.value)}
          />
          <input
            placeholder="CPF (opcional)"
            className="w-full"
            value={guestDocument}
            onChange={(e) => setGuestDocument(e.target.value)}
          />
          <input
            placeholder="Telefone (opcional)"
            className="w-full sm:col-span-2"
            value={guestPhone}
            onChange={(e) => setGuestPhone(e.target.value)}
          />
        </div>
        {formError ? <p className="mt-2 text-[13px] font-semibold text-danger">{formError}</p> : null}
        <button
          type="button"
          className="btn-primary mt-3"
          onClick={handleAddGuest}
          disabled={saving || !ticketLotId || guestName.trim().length < 2}
        >
          {saving ? "Adicionando…" : "Adicionar à lista"}
        </button>
      </section>

      <section className="mt-5 rounded-2xl border border-line bg-surface p-5">
        <h2 className="text-[15px] font-extrabold">Convidados ({entries.length})</h2>
        {entries.length === 0 ? (
          <p className="mt-4 text-[13px] font-semibold text-muted">Nenhum convidado cadastrado ainda.</p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-left text-[13px]">
              <thead>
                <tr className="border-b border-line text-muted">
                  <th className="py-2 pr-3 font-bold">Nome</th>
                  <th className="py-2 pr-3 font-bold">Parceiro</th>
                  <th className="py-2 pr-3 font-bold">Lote</th>
                  <th className="py-2 pr-3 font-bold">Status</th>
                  <th className="py-2 pr-3 font-bold">Ingresso</th>
                  <th className="py-2 pr-3 font-bold" />
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => {
                  const statusStyle = STATUS_LABELS[entry.status] ?? {
                    label: entry.status,
                    bg: "bg-line",
                    fg: "text-muted",
                  };
                  return (
                    <tr key={entry.id} className="border-b border-line last:border-0">
                      <td className="py-2 pr-3">
                        <p className="font-bold">{entry.guestName}</p>
                        {entry.guestDocument ? <p className="text-muted">{entry.guestDocument}</p> : null}
                      </td>
                      <td className="py-2 pr-3">{entry.salesPartner?.name ?? "—"}</td>
                      <td className="py-2 pr-3">{entry.ticketLot.name}</td>
                      <td className="py-2 pr-3">
                        <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${statusStyle.bg} ${statusStyle.fg}`}>
                          {statusStyle.label}
                        </span>
                      </td>
                      <td className="py-2 pr-3">
                        {entry.ticket ? (
                          <span>
                            {entry.ticket.code}
                            {entry.ticket.checkedInAt ? " · entrou" : ""}
                          </span>
                        ) : (
                          <span className="text-muted">emitindo…</span>
                        )}
                      </td>
                      <td className="py-2 pr-3 text-right">
                        {entry.status !== "CANCELED" ? (
                          <button
                            type="button"
                            className="font-semibold text-danger"
                            onClick={() => handleCancel(entry)}
                          >
                            Cancelar
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}

export default function GuestListPage({ params }: { params: { eventId: string } }) {
  return (
    <AuthGuard>
      <GuestListContent eventId={params.eventId} />
    </AuthGuard>
  );
}
