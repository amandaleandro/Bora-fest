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
  // ERRO NÃO VIRA "ZERO" (2026-10-12): parceiros caíam num .catch(() => {}) (a casa
  // via "sem parceiro" e podia cadastrar o parceiro de novo), a falha dos lotes
  // deixava o select vazio calado e a da lista mostrava "Nenhum convidado
  // cadastrado ainda" — convite repetido. Agora cada parte mostra o erro e o retry.
  const [entriesLoaded, setEntriesLoaded] = useState(false);
  const [lotsError, setLotsError] = useState<string | null>(null);
  const [partnersError, setPartnersError] = useState<string | null>(null);

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
      setEntriesLoaded(true);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível carregar a lista de convidados");
    }
  }

  async function loadLots() {
    if (!token) return;
    setLotsError(null);
    try {
      const d = await dashboardApi.get(token, eventId);
      setLots(d.lots.map((l) => ({ id: l.id, name: l.name, typeName: l.typeName })));
    } catch (err) {
      setLotsError(err instanceof Error && err.message ? err.message : "Não foi possível carregar os lotes");
    }
  }

  async function loadPartners() {
    if (!token || !organization) return;
    setPartnersError(null);
    try {
      setPartners(await organizationsApi.listSalesPartners(token, organization.id));
    } catch (err) {
      setPartnersError(err instanceof Error && err.message ? err.message : "Não foi possível carregar os parceiros");
    }
  }

  useEffect(() => {
    if (!token || !organization) return;
    setLoading(true);
    Promise.all([loadLots(), loadPartners(), loadEntries()]).finally(() => setLoading(false));
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
    // trava antes do request: mensagem imediata em vez de round-trip pro 400
    if (!ehCpfValido(guestDocument)) {
      setFormError("Informe o CPF do convidado — é o que confirma a identidade dele na porta.");
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      await guestListApi.create(token, eventId, {
        ticketLotId,
        guestName: guestName.trim(),
        guestDocument: guestDocument.trim(),
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

      {/* sem a lista carregada, o erro aparece lá embaixo, no lugar da lista */}
      {error && entriesLoaded ? <p className="mt-4 text-[13px] font-semibold text-danger">{error}</p> : null}

      <section className="mt-5 rounded-2xl border border-line bg-surface p-5">
        <h2 className="text-[15px] font-extrabold">Adicionar convidado</h2>
        {lotsError ? (
          <p className="mt-3 rounded-lg border border-danger/30 bg-danger/5 px-3 py-2.5 text-[13px] font-semibold text-danger">
            Não deu para carregar os lotes ({lotsError}).{" "}
            <button type="button" onClick={loadLots} className="font-extrabold underline">
              Tentar novamente
            </button>
          </p>
        ) : null}
        {partnersError ? (
          <p className="mt-3 rounded-lg border border-danger/30 bg-danger/5 px-3 py-2.5 text-[13px] font-semibold text-danger">
            Não deu para carregar os parceiros ({partnersError}) — sem eles, o convidado entra como da casa.{" "}
            <button type="button" onClick={loadPartners} className="font-extrabold underline">
              Tentar novamente
            </button>
          </p>
        ) : null}
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
          {/* CPF obrigatório (2026-09-15): o convidado da lista não recebe QR nem
              código — na porta o CPF é a única prova de que é ele mesmo. */}
          <input
            placeholder="CPF do convidado"
            className="w-full"
            inputMode="numeric"
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
        <h2 className="text-[15px] font-extrabold">Convidados ({entriesLoaded ? entries.length : "…"})</h2>
        {!entriesLoaded ? (
          <div className="mt-4 rounded-xl border border-danger/30 bg-danger/5 p-4 text-center">
            <p className="text-[13px] font-bold text-danger">
              {error ?? "Não foi possível carregar a lista de convidados"}
            </p>
            <button
              type="button"
              onClick={loadEntries}
              className="mt-3 h-10 rounded-xl bg-primary px-5 text-[13px] font-extrabold text-white shadow-cta"
            >
              Tentar novamente
            </button>
          </div>
        ) : entries.length === 0 ? (
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

/**
 * Cópia local de propósito: os apps web não dependem de `@borafest/contracts`
 * (falam com a API por HTTP, com tipos próprios) — mesmo motivo do `cpfValido`
 * em `PdvPorta.tsx` no checkout. A regra que vale é a do servidor
 * (`packages/contracts/src/cpf.ts`); aqui é só para avisar antes do request.
 */
function ehCpfValido(raw: string): boolean {
  const cpf = raw.replace(/\D/g, "");
  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;
  for (const len of [9, 10]) {
    let soma = 0;
    for (let i = 0; i < len; i += 1) soma += Number(cpf[i]) * (len + 1 - i);
    if (((soma * 10) % 11) % 10 !== Number(cpf[len])) return false;
  }
  return true;
}

export default function GuestListPage({ params }: { params: { eventId: string } }) {
  return (
    <AuthGuard>
      <GuestListContent eventId={params.eventId} />
    </AuthGuard>
  );
}
