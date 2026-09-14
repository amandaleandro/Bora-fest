"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { API_BASE_URL } from "../../../lib/config";

type Space = {
  id: string;
  kind: "MESA" | "CAMAROTE" | "LOUNGE" | "BISTRO" | "OUTRO";
  name: string;
  description: string | null;
  benefits: string | null;
  unitPriceCents: number;
  capacityPerUnit: number;
  maxUnitsPerReservation: number;
  availableUnits: number;
};

type VipPayload = {
  event: { id: string; title: string; slug: string; startsAt: string };
  spaces: Space[];
};

const KIND: Record<Space["kind"], string> = {
  MESA: "Mesa",
  CAMAROTE: "Camarote",
  LOUNGE: "Lounge",
  BISTRO: "Bistrô",
  OUTRO: "Espaço VIP",
};

function money(cents: number) {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export default function VipReservationPage({ params }: { params: { slug: string } }) {
  const [data, setData] = useState<VipPayload | null>(null);
  const [selected, setSelected] = useState<Space | null>(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", email: "", phone: "", partySize: "", units: "1", note: "" });

  useEffect(() => {
    let active = true;
    fetch(`${API_BASE_URL}/v1/public/events/${encodeURIComponent(params.slug)}/vip`)
      .then(async (response) => {
        if (!response.ok) throw new Error(response.status === 404 ? "Evento não encontrado" : "Não foi possível carregar os espaços VIP");
        return response.json() as Promise<VipPayload>;
      })
      .then((payload) => {
        if (active) setData(payload);
      })
      .catch((err) => {
        if (active) setError(err instanceof Error ? err.message : "Não foi possível carregar");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [params.slug]);

  const total = useMemo(() => selected ? selected.unitPriceCents * Number(form.units || 1) : 0, [selected, form.units]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!selected) return;
    setSending(true);
    setError(null);
    setSuccess(null);
    try {
      const response = await fetch(`${API_BASE_URL}/v1/public/events/${encodeURIComponent(params.slug)}/vip/reservations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          inventoryId: selected.id,
          contactName: form.name,
          contactEmail: form.email,
          contactPhone: form.phone,
          partySize: Number(form.partySize),
          units: Number(form.units),
          customerNote: form.note || undefined,
        }),
      });
      const payload = await response.json().catch(() => ({})) as { message?: string | string[] };
      if (!response.ok) {
        const message = Array.isArray(payload.message) ? payload.message.join(" · ") : payload.message;
        throw new Error(message || "Não foi possível enviar a reserva");
      }
      setSuccess("Pedido enviado. A Casa ainda precisa confirmar sua reserva.");
      setSelected(null);
      setForm({ name: "", email: "", phone: "", partySize: "", units: "1", note: "" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível enviar a reserva");
    } finally {
      setSending(false);
    }
  }

  if (loading) return <main className="mx-auto max-w-5xl px-5 py-16 text-center text-sm text-white/60">Carregando espaços VIP…</main>;

  return (
    <main className="mx-auto min-h-screen max-w-6xl px-5 py-10 text-white lg:py-14">
      <Link href={`/${params.slug}`} className="text-sm font-bold text-white/60 hover:text-white">← Voltar para o evento</Link>

      {data ? (
        <header className="mt-8 max-w-3xl">
          <p className="text-xs font-black uppercase tracking-[.14em] text-primary">Reserva VIP</p>
          <h1 className="mt-2 text-3xl font-black tracking-tight lg:text-4xl">{data.event.title}</h1>
          <p className="mt-3 text-sm font-semibold leading-relaxed text-white/60">
            Escolha uma mesa ou camarote e envie seu pedido. A unidade só fica reservada depois da confirmação da Casa; nenhum pagamento é cobrado nesta etapa.
          </p>
        </header>
      ) : null}

      {error ? <p className="mt-6 rounded-2xl border border-red-400/25 bg-red-400/10 p-4 text-sm font-bold text-red-200">{error}</p> : null}
      {success ? <p className="mt-6 rounded-2xl border border-emerald-400/25 bg-emerald-400/10 p-4 text-sm font-bold text-emerald-200">{success}</p> : null}

      {data && data.spaces.length === 0 ? (
        <div className="mt-8 rounded-3xl border border-white/10 bg-white/5 p-10 text-center">
          <h2 className="font-black">Nenhum espaço VIP disponível agora</h2>
          <p className="mt-2 text-sm text-white/55">Acompanhe o evento para novas liberações.</p>
        </div>
      ) : null}

      <section className="mt-8 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {data?.spaces.map((space) => (
          <article key={space.id} className="rounded-3xl border border-white/10 bg-white/[.045] p-5">
            <div className="flex items-start justify-between gap-4">
              <div><p className="text-[11px] font-black uppercase tracking-[.08em] text-primary">{KIND[space.kind]}</p><h2 className="mt-1 text-xl font-black">{space.name}</h2></div>
              <div className="text-right"><p className="text-lg font-black">{money(space.unitPriceCents)}</p><p className="text-[10px] font-bold text-white/45">por unidade</p></div>
            </div>
            {space.description ? <p className="mt-3 text-sm font-semibold leading-relaxed text-white/60">{space.description}</p> : null}
            {space.benefits ? <div className="mt-4 whitespace-pre-line rounded-2xl bg-black/15 p-3 text-xs font-semibold leading-relaxed text-white/65">{space.benefits}</div> : null}
            <div className="mt-4 grid grid-cols-2 gap-2 text-center"><div className="rounded-xl bg-black/15 p-3"><b className="block text-lg">{space.capacityPerUnit}</b><span className="text-[10px] text-white/45">pessoas/unidade</span></div><div className="rounded-xl bg-black/15 p-3"><b className="block text-lg">{space.availableUnits}</b><span className="text-[10px] text-white/45">disponíveis</span></div></div>
            <button type="button" disabled={space.availableUnits <= 0} onClick={() => { setSelected(space); setSuccess(null); setForm((v) => ({ ...v, units: "1", partySize: String(Math.min(space.capacityPerUnit, 4)) })); }} className="mt-4 h-11 w-full rounded-xl bg-primary text-sm font-black text-white disabled:cursor-not-allowed disabled:opacity-40">{space.availableUnits > 0 ? "Pedir reserva" : "Esgotado"}</button>
          </article>
        ))}
      </section>

      {selected ? (
        <section className="mt-8 rounded-3xl border border-white/10 bg-white/[.055] p-5 lg:p-7">
          <div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-xs font-black uppercase text-primary">Pedido de reserva</p><h2 className="mt-1 text-xl font-black">{selected.name}</h2></div><button type="button" onClick={() => setSelected(null)} className="text-sm font-bold text-white/55">Fechar</button></div>
          <form onSubmit={submit} className="mt-5 grid gap-4 md:grid-cols-2">
            <label className="text-xs font-bold text-white/60">Nome<input required minLength={2} value={form.name} onChange={(e) => setForm((v) => ({ ...v, name: e.target.value }))} className="mt-1.5 h-12 w-full rounded-xl border border-white/10 bg-black/20 px-4 text-sm text-white outline-none focus:border-primary" /></label>
            <label className="text-xs font-bold text-white/60">E-mail<input required type="email" value={form.email} onChange={(e) => setForm((v) => ({ ...v, email: e.target.value }))} className="mt-1.5 h-12 w-full rounded-xl border border-white/10 bg-black/20 px-4 text-sm text-white outline-none focus:border-primary" /></label>
            <label className="text-xs font-bold text-white/60">WhatsApp / telefone<input required value={form.phone} onChange={(e) => setForm((v) => ({ ...v, phone: e.target.value }))} className="mt-1.5 h-12 w-full rounded-xl border border-white/10 bg-black/20 px-4 text-sm text-white outline-none focus:border-primary" /></label>
            <label className="text-xs font-bold text-white/60">Pessoas no grupo<input required type="number" min={1} max={Number(form.units || 1) * selected.capacityPerUnit} value={form.partySize} onChange={(e) => setForm((v) => ({ ...v, partySize: e.target.value }))} className="mt-1.5 h-12 w-full rounded-xl border border-white/10 bg-black/20 px-4 text-sm text-white outline-none focus:border-primary" /></label>
            <label className="text-xs font-bold text-white/60">Unidades<select value={form.units} onChange={(e) => setForm((v) => ({ ...v, units: e.target.value }))} className="mt-1.5 h-12 w-full rounded-xl border border-white/10 bg-black/20 px-4 text-sm text-white outline-none focus:border-primary">{Array.from({ length: Math.min(selected.maxUnitsPerReservation, selected.availableUnits) }, (_, index) => index + 1).map((units) => <option key={units} value={units}>{units}</option>)}</select></label>
            <label className="text-xs font-bold text-white/60 md:col-span-2">Observação<textarea value={form.note} maxLength={1000} onChange={(e) => setForm((v) => ({ ...v, note: e.target.value }))} rows={3} className="mt-1.5 w-full rounded-xl border border-white/10 bg-black/20 p-4 text-sm text-white outline-none focus:border-primary" placeholder="Aniversário, localização preferida, acessibilidade…" /></label>
            <div className="md:col-span-2 flex flex-col gap-3 rounded-2xl bg-black/15 p-4 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-xs font-bold text-white/45">Valor de referência</p><p className="mt-1 text-xl font-black">{money(total)}</p></div><button disabled={sending} className="h-12 rounded-xl bg-primary px-6 text-sm font-black text-white disabled:opacity-50">{sending ? "Enviando…" : "Enviar pedido de reserva"}</button></div>
          </form>
        </section>
      ) : null}
    </main>
  );
}
