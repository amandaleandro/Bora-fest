"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/lib/auth";
import { CHECKOUT_URL } from "@/lib/config";
import { useEventShell } from "@/lib/eventContext";
import {
  configureVipDeposit,
  createVipInventory,
  getVipInventory,
  getVipPaymentSummary,
  getVipReservations,
  manageVipReservation,
  updateVipInventory,
  type VipInventory,
  type VipInventoryKind,
  type VipPaymentSummary,
  type VipReservation,
} from "@/lib/vip-api";

const KIND_LABEL: Record<VipInventoryKind, string> = {
  MESA: "Mesa",
  CAMAROTE: "Camarote",
  LOUNGE: "Lounge",
  BISTRO: "Bistrô",
  OUTRO: "Outro",
};

const STATUS_LABEL: Record<VipReservation["status"], string> = {
  REQUESTED: "Solicitada",
  CONFIRMED: "Confirmada",
  REJECTED: "Recusada",
  CANCELED: "Cancelada",
};

function money(cents: number) {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function parseMoney(value: string) {
  const normalized = value.trim().replace(/\./g, "").replace(",", ".");
  const amount = Number(normalized);
  return Number.isFinite(amount) ? Math.round(amount * 100) : NaN;
}

export default function VipPage() {
  const { token } = useAuth();
  const { event, loading: contextLoading } = useEventShell();
  const [inventory, setInventory] = useState<VipInventory[]>([]);
  const [reservations, setReservations] = useState<VipReservation[]>([]);
  const [payments, setPayments] = useState<Record<string, VipPaymentSummary>>({});
  const [depositDrafts, setDepositDrafts] = useState<Record<string, { value: string; dueAt: string }>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    kind: "MESA" as VipInventoryKind,
    name: "",
    description: "",
    benefits: "",
    price: "",
    quantity: "1",
    capacity: "4",
    maxUnits: "1",
  });

  const refresh = useCallback(async () => {
    if (!token || !event) return;
    setLoading(true);
    setError(null);
    try {
      const [spaces, requests] = await Promise.all([
        getVipInventory(token, event.id),
        getVipReservations(token, event.id),
      ]);
      setInventory(spaces);
      setReservations(requests);

      const confirmed = requests.filter((item) => item.status === "CONFIRMED");
      const summaries = await Promise.allSettled(
        confirmed.map(async (item) => [item.id, await getVipPaymentSummary(token, item.id)] as const),
      );
      const nextPayments: Record<string, VipPaymentSummary> = {};
      for (const result of summaries) {
        if (result.status === "fulfilled") nextPayments[result.value[0]] = result.value[1];
      }
      setPayments(nextPayments);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível carregar o VIP");
    } finally {
      setLoading(false);
    }
  }, [token, event]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const summary = useMemo(() => {
    const total = inventory.reduce((sum, item) => sum + item.quantity, 0);
    const confirmed = inventory.reduce((sum, item) => sum + item.confirmedUnits, 0);
    const pending = reservations.filter((item) => item.status === "REQUESTED").length;
    return { total, confirmed, available: Math.max(0, total - confirmed), pending };
  }, [inventory, reservations]);

  async function submitInventory(e: FormEvent) {
    e.preventDefault();
    if (!token || !event) return;
    const price = Math.round(Number(form.price.replace(",", ".")) * 100);
    if (!Number.isFinite(price) || price < 0) {
      setError("Informe um preço válido");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await createVipInventory(token, event.id, {
        kind: form.kind,
        name: form.name.trim(),
        description: form.description.trim() || undefined,
        benefits: form.benefits.trim() || undefined,
        unitPriceCents: price,
        quantity: Number(form.quantity),
        capacityPerUnit: Number(form.capacity),
        maxUnitsPerReservation: Number(form.maxUnits),
      });
      setForm({ kind: "MESA", name: "", description: "", benefits: "", price: "", quantity: "1", capacity: "4", maxUnits: "1" });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível criar o espaço VIP");
    } finally {
      setSaving(false);
    }
  }

  async function toggleInventory(item: VipInventory) {
    if (!token) return;
    setSaving(true);
    try {
      await updateVipInventory(token, item.id, { active: !item.active });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível atualizar o espaço VIP");
    } finally {
      setSaving(false);
    }
  }

  async function decide(item: VipReservation, action: "CONFIRM" | "REJECT" | "CANCEL") {
    if (!token) return;
    setSaving(true);
    setError(null);
    try {
      await manageVipReservation(token, item.id, action);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível atualizar a reserva");
    } finally {
      setSaving(false);
    }
  }

  async function saveDeposit(item: VipReservation, presetPercent?: number) {
    if (!token) return;
    const draft = depositDrafts[item.id] ?? { value: "", dueAt: "" };
    const depositCents = presetPercent
      ? Math.max(1, Math.round(item.totalCents * (presetPercent / 100)))
      : parseMoney(draft.value);
    if (!Number.isFinite(depositCents) || depositCents < 0 || depositCents > item.totalCents) {
      setError("Informe um sinal válido, entre zero e o total da reserva");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const paymentDueAt = draft.dueAt ? new Date(draft.dueAt).toISOString() : null;
      const next = await configureVipDeposit(token, item.id, { depositCents, paymentDueAt });
      setPayments((current) => ({ ...current, [item.id]: next }));
      setDepositDrafts((current) => ({ ...current, [item.id]: { value: "", dueAt: draft.dueAt } }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível configurar o sinal");
    } finally {
      setSaving(false);
    }
  }

  if (contextLoading || !event) return <p className="p-6 text-[13px] font-semibold text-muted">Carregando evento…</p>;

  return (
    <main className="mx-auto max-w-7xl px-5 py-7 lg:px-8 lg:py-9">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-[11px] font-extrabold uppercase tracking-[.08em] text-primary">N8.1 · operação VIP</p>
          <h1 className="mt-1 text-[27px] font-black tracking-tight text-ink">Mesas, camarotes e sinal</h1>
          <p className="mt-1.5 max-w-3xl text-[13px] font-semibold text-muted">
            Controle inventário, confirme reservas e defina o sinal Pix para <strong className="text-ink">{event.title}</strong>.
          </p>
        </div>
        <a href={`${CHECKOUT_URL}/${event.slug}/vip`} target="_blank" rel="noopener" className="inline-flex h-10 items-center justify-center rounded-xl border border-line-input bg-surface px-4 text-[12px] font-extrabold text-primary">Abrir página VIP ↗</a>
      </div>

      {error ? <p className="mt-5 rounded-2xl border border-danger/25 bg-danger/5 p-4 text-[12px] font-bold text-danger">{error}</p> : null}

      <section className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[["Unidades", summary.total], ["Confirmadas", summary.confirmed], ["Disponíveis", summary.available], ["Pedidos pendentes", summary.pending]].map(([label, value]) => (
          <div key={String(label)} className="rounded-2xl border border-line bg-surface p-4"><p className="text-[10.5px] font-extrabold uppercase tracking-[.04em] text-muted-2">{label}</p><p className="mt-1.5 text-[24px] font-black text-ink">{Number(value).toLocaleString("pt-BR")}</p></div>
        ))}
      </section>

      <section className="mt-6 grid gap-5 xl:grid-cols-[380px_1fr]">
        <form onSubmit={submitInventory} className="rounded-3xl border border-line bg-surface p-5">
          <h2 className="text-[16px] font-black text-ink">Novo espaço VIP</h2>
          <div className="mt-4 grid gap-3">
            <select value={form.kind} onChange={(e) => setForm((v) => ({ ...v, kind: e.target.value as VipInventoryKind }))} className="h-11 rounded-xl border border-line-input bg-bg px-3 text-[13px] font-semibold text-ink">{Object.entries(KIND_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
            <input required value={form.name} onChange={(e) => setForm((v) => ({ ...v, name: e.target.value }))} placeholder="Ex.: Camarote Premium" className="h-11 rounded-xl border border-line-input bg-bg px-3 text-[13px] text-ink" />
            <textarea value={form.description} onChange={(e) => setForm((v) => ({ ...v, description: e.target.value }))} placeholder="Descrição" rows={3} className="rounded-xl border border-line-input bg-bg p-3 text-[13px] text-ink" />
            <textarea value={form.benefits} onChange={(e) => setForm((v) => ({ ...v, benefits: e.target.value }))} placeholder="Benefícios, um por linha" rows={3} className="rounded-xl border border-line-input bg-bg p-3 text-[13px] text-ink" />
            <div className="grid grid-cols-2 gap-3">
              <label className="text-[11px] font-bold text-muted">Preço/unidade<input required inputMode="decimal" value={form.price} onChange={(e) => setForm((v) => ({ ...v, price: e.target.value }))} placeholder="500,00" className="mt-1 h-11 w-full rounded-xl border border-line-input bg-bg px-3 text-[13px] text-ink" /></label>
              <label className="text-[11px] font-bold text-muted">Quantidade<input required type="number" min={1} value={form.quantity} onChange={(e) => setForm((v) => ({ ...v, quantity: e.target.value }))} className="mt-1 h-11 w-full rounded-xl border border-line-input bg-bg px-3 text-[13px] text-ink" /></label>
              <label className="text-[11px] font-bold text-muted">Pessoas/unidade<input required type="number" min={1} value={form.capacity} onChange={(e) => setForm((v) => ({ ...v, capacity: e.target.value }))} className="mt-1 h-11 w-full rounded-xl border border-line-input bg-bg px-3 text-[13px] text-ink" /></label>
              <label className="text-[11px] font-bold text-muted">Máx. por pedido<input required type="number" min={1} value={form.maxUnits} onChange={(e) => setForm((v) => ({ ...v, maxUnits: e.target.value }))} className="mt-1 h-11 w-full rounded-xl border border-line-input bg-bg px-3 text-[13px] text-ink" /></label>
            </div>
            <button disabled={saving} className="h-11 rounded-xl bg-primary px-4 text-[12.5px] font-extrabold text-white disabled:opacity-50">{saving ? "Salvando…" : "Criar espaço VIP"}</button>
          </div>
        </form>

        <div className="space-y-3">
          {loading ? <div className="rounded-3xl border border-line bg-surface p-10 text-center text-[13px] font-semibold text-muted">Carregando inventário…</div> : null}
          {!loading && inventory.length === 0 ? <div className="rounded-3xl border border-line bg-surface p-10 text-center"><p className="font-extrabold text-ink">Nenhum espaço VIP cadastrado</p><p className="mt-1 text-[12px] font-semibold text-muted">Crie a primeira mesa, camarote, lounge ou bistrô.</p></div> : null}
          {inventory.map((item) => (
            <article key={item.id} className="rounded-2xl border border-line bg-surface p-4">
              <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-[10px] font-extrabold uppercase text-primary">{KIND_LABEL[item.kind]}</p><h3 className="mt-1 text-[15px] font-black text-ink">{item.name}</h3><p className="mt-1 text-[11.5px] font-semibold text-muted">{item.capacityPerUnit} pessoas/unidade · {money(item.unitPriceCents)}</p></div><button type="button" disabled={saving} onClick={() => toggleInventory(item)} className="rounded-lg border border-line-input px-3 py-2 text-[11px] font-extrabold text-primary disabled:opacity-50">{item.active ? "Pausar" : "Reativar"}</button></div>
              <div className="mt-4 grid grid-cols-3 gap-2 text-center"><div className="rounded-xl bg-bg p-2"><b className="block text-ink">{item.quantity}</b><span className="text-[10px] text-muted">total</span></div><div className="rounded-xl bg-bg p-2"><b className="block text-ink">{item.confirmedUnits}</b><span className="text-[10px] text-muted">confirmadas</span></div><div className="rounded-xl bg-bg p-2"><b className="block text-success">{item.availableUnits}</b><span className="text-[10px] text-muted">livres</span></div></div>
            </article>
          ))}
        </div>
      </section>

      <section className="mt-7 overflow-hidden rounded-3xl border border-line bg-surface">
        <div className="border-b border-line px-5 py-4"><h2 className="text-[16px] font-black text-ink">Pedidos de reserva</h2><p className="mt-1 text-[11.5px] font-semibold text-muted">Confirme a reserva e, se quiser, cobre um sinal Pix para garantir a operação.</p></div>
        {reservations.length === 0 ? <div className="p-10 text-center text-[12px] font-semibold text-muted">Nenhum pedido de reserva ainda.</div> : (
          <div className="divide-y divide-line-divider">
            {reservations.map((item) => {
              const payment = payments[item.id];
              const draft = depositDrafts[item.id] ?? { value: "", dueAt: "" };
              const hasFinancialLock = Boolean(payment && (payment.paidCents > 0 || payment.refundPendingCents > 0 || payment.latestPayment));
              return (
                <article key={item.id} className="p-5">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div><div className="flex flex-wrap items-center gap-2"><h3 className="font-extrabold text-ink">{item.contactName}</h3><span className="rounded-full bg-bg px-2.5 py-1 text-[10px] font-extrabold text-muted">{STATUS_LABEL[item.status]}</span></div><p className="mt-1 text-[11.5px] font-semibold text-muted">{item.inventory.name} · {item.units} unidade(s) · {item.partySize} pessoas · {money(item.totalCents)}</p><p className="mt-1 text-[11px] text-muted-2">{item.contactEmail} · {item.contactPhone}</p>{item.customerNote ? <p className="mt-2 text-[11.5px] font-semibold text-muted">“{item.customerNote}”</p> : null}</div>
                    <div className="flex flex-wrap gap-2">
                      {item.status === "REQUESTED" ? <><button disabled={saving} onClick={() => decide(item, "CONFIRM")} className="rounded-xl bg-primary px-4 py-2 text-[11px] font-extrabold text-white disabled:opacity-50">Confirmar</button><button disabled={saving} onClick={() => decide(item, "REJECT")} className="rounded-xl border border-line-input px-4 py-2 text-[11px] font-extrabold text-danger disabled:opacity-50">Recusar</button></> : null}
                      {item.status === "CONFIRMED" && !hasFinancialLock ? <button disabled={saving} onClick={() => decide(item, "CANCEL")} className="rounded-xl border border-line-input px-4 py-2 text-[11px] font-extrabold text-danger disabled:opacity-50">Cancelar</button> : null}
                      <a href={`${CHECKOUT_URL}/${event.slug}/vip/reserva/${item.publicToken}`} target="_blank" rel="noopener" className="rounded-xl border border-line-input px-4 py-2 text-[11px] font-extrabold text-primary">Abrir acompanhamento ↗</a>
                    </div>
                  </div>

                  {item.status === "CONFIRMED" ? (
                    <div className="mt-4 rounded-2xl border border-line bg-bg p-4">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <p className="text-[10px] font-extrabold uppercase tracking-[.06em] text-muted-2">Sinal da reserva</p>
                          <p className="mt-1 text-[13px] font-extrabold text-ink">
                            {payment?.paidCents ? `Pago ${money(payment.paidCents)}` : payment?.depositCents ? `Cobrar ${money(payment.depositCents)}` : "Sem sinal definido"}
                          </p>
                          {payment?.refundPendingCents ? <p className="mt-1 text-[11px] font-bold text-warning">Estorno em processamento: {money(payment.refundPendingCents)}</p> : null}
                          {payment?.latestPayment ? <p className="mt-1 text-[11px] font-semibold text-muted">Pix aberto de {money(payment.latestPayment.amountCents)}{payment.latestPayment.expiresAt ? ` · expira ${new Date(payment.latestPayment.expiresAt).toLocaleString("pt-BR")}` : ""}</p> : null}
                        </div>
                        {!hasFinancialLock ? <div className="flex flex-wrap gap-2">{[30, 50, 100].map((percent) => <button key={percent} type="button" disabled={saving} onClick={() => saveDeposit(item, percent)} className="rounded-lg border border-line-input bg-surface px-3 py-2 text-[11px] font-extrabold text-primary disabled:opacity-50">{percent}% · {money(Math.round(item.totalCents * percent / 100))}</button>)}</div> : null}
                      </div>

                      {!hasFinancialLock ? (
                        <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
                          <input value={draft.value} onChange={(e) => setDepositDrafts((current) => ({ ...current, [item.id]: { ...draft, value: e.target.value } }))} placeholder="Valor personalizado, ex.: 250,00" className="h-10 rounded-xl border border-line-input bg-surface px-3 text-[12px] text-ink" />
                          <input type="datetime-local" value={draft.dueAt} onChange={(e) => setDepositDrafts((current) => ({ ...current, [item.id]: { ...draft, dueAt: e.target.value } }))} className="h-10 rounded-xl border border-line-input bg-surface px-3 text-[12px] text-ink" />
                          <button type="button" disabled={saving || !draft.value.trim()} onClick={() => saveDeposit(item)} className="h-10 rounded-xl bg-primary px-4 text-[11px] font-extrabold text-white disabled:opacity-40">Salvar sinal</button>
                        </div>
                      ) : <p className="mt-3 text-[11px] font-semibold text-muted">A reserva fica protegida contra cancelamento enquanto existe Pix ativo, pagamento confirmado ou estorno em processamento.</p>}
                    </div>
                  ) : null}
                </article>
              );
            })}
          </div>
        )}
      </section>
    </main>
  );
}
