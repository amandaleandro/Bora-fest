"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AuthGuard } from "@/components/AuthGuard";
import { useAuth } from "@/lib/auth";
import { eventsApi, catalogApi, eventControls } from "@/lib/api";

const inputCls = "mt-1 h-[46px] w-full rounded-xl border-[1.5px] border-line-input bg-surface px-3.5 text-[14px] font-medium outline-none focus:border-primary";
const labelCls = "text-[12px] font-bold text-ink-soft";

interface DraftLot {
  typeName: string;
  lotName: string;
  price: string;
  fee: string;
  capacity: string;
}

function Stepper({ step }: { step: number }) {
  const labels = ["Dados", "Ingressos", "Publicar"];
  return (
    <div className="flex items-center gap-3">
      {labels.map((label, i) => (
        <div key={label} className="flex items-center gap-2">
          <span className={`flex h-7 w-7 items-center justify-center rounded-full text-[12px] font-bold ${
            i < step ? "bg-success text-white" : i === step ? "bg-primary text-white" : "bg-line text-muted"
          }`}>
            {i < step ? "✓" : i + 1}
          </span>
          <span className={`text-[13px] font-bold ${i <= step ? "text-ink" : "text-muted-3"}`}>{label}</span>
          {i < 2 && <span className="h-px w-8 bg-line" />}
        </div>
      ))}
    </div>
  );
}

function NewEventContent() {
  const router = useRouter();
  const { token } = useAuth();
  const orgId = useSearchParams().get("org") ?? "";

  const [step, setStep] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // etapa 1
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [bannerUrl, setBannerUrl] = useState("");
  const [eventId, setEventId] = useState<string | null>(null);
  const [slug, setSlug] = useState<string | null>(null);

  // etapa 2
  const [lots, setLots] = useState<DraftLot[]>([]);
  const [draft, setDraft] = useState<DraftLot>({ typeName: "Pista", lotName: "1º Lote", price: "", fee: "", capacity: "" });
  const [createdLots, setCreatedLots] = useState<string[]>([]);

  // etapa 3
  const [published, setPublished] = useState(false);

  async function saveStep1() {
    if (!token || !orgId) { setError("Abra pelo botão Criar evento da organização"); return; }
    setBusy(true);
    setError(null);
    try {
      const event = await eventsApi.create(token, orgId, {
        title,
        description: description || undefined,
        startsAt: new Date(startsAt).toISOString(),
        endsAt: new Date(endsAt).toISOString(),
      }) as { id: string; slug: string };
      setEventId(event.id);
      setSlug(event.slug);
      if (bannerUrl) await eventControls.update(event.id, { bannerUrl }, token).catch(() => {});
      setStep(1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível criar o evento");
    } finally {
      setBusy(false);
    }
  }

  async function addLot() {
    if (!token || !eventId) return;
    setBusy(true);
    setError(null);
    try {
      const type = await catalogApi.createTicketType(token, eventId, { name: draft.typeName }) as { id: string };
      const lot = await catalogApi.createLot(token, type.id, {
        name: draft.lotName,
        priceCents: Math.round(Number(draft.price) * 100),
        feeCents: Math.round(Number(draft.fee || "0") * 100),
        capacity: Number(draft.capacity),
      }) as { id: string };
      await catalogApi.activateLot(token, lot.id);
      setLots((prev) => [...prev, draft]);
      setCreatedLots((prev) => [...prev, lot.id]);
      setDraft({ typeName: draft.typeName, lotName: "", price: "", fee: draft.fee, capacity: "" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível criar o lote");
    } finally {
      setBusy(false);
    }
  }

  async function publish() {
    if (!token || !eventId) return;
    setBusy(true);
    setError(null);
    try {
      await eventsApi.publish(token, eventId);
      setPublished(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível publicar");
    } finally {
      setBusy(false);
    }
  }

  const publicUrl = slug ? `http://localhost:3000/evento/${slug}` : "";

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <h1 className="text-[26px] font-extrabold">Criar evento</h1>
      <div className="mt-4"><Stepper step={step} /></div>
      {error && <p className="mt-3 text-[12px] font-semibold text-danger">{error}</p>}

      {step === 0 && (
        <section className="mt-6 space-y-4 rounded-2xl border border-line bg-surface p-5">
          <div>
            <label className={labelCls}>Nome do evento</label>
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ex.: CIA 2026 · Copa Inter Atléticas" className={inputCls} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Início</label>
              <input type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Término</label>
              <input type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} className={inputCls} />
            </div>
          </div>
          <div>
            <label className={labelCls}>Descrição</label>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={4}
              className="mt-1 w-full rounded-xl border-[1.5px] border-line-input bg-surface px-3.5 py-3 text-[14px] font-medium outline-none focus:border-primary" />
          </div>
          <div>
            <label className={labelCls}>Banner (URL da imagem)</label>
            <input value={bannerUrl} onChange={(e) => setBannerUrl(e.target.value)} placeholder="https://…" className={inputCls} />
          </div>
          <button onClick={saveStep1} disabled={busy || title.length < 3 || !startsAt || !endsAt}
            className="h-12 rounded-xl bg-primary px-8 text-[14px] font-extrabold text-white shadow-cta disabled:bg-[#d9d2e8] disabled:shadow-none">
            {busy ? "Salvando…" : "Continuar"}
          </button>
        </section>
      )}

      {step === 1 && (
        <section className="mt-6 rounded-2xl border border-line bg-surface p-5">
          <h2 className="text-[16px] font-extrabold">Ingressos</h2>
          <div className="mt-3 grid grid-cols-2 gap-2 lg:grid-cols-5">
            <input placeholder="Tipo (Pista)" value={draft.typeName} onChange={(e) => setDraft({ ...draft, typeName: e.target.value })} className={inputCls} />
            <input placeholder="Lote (1º Lote)" value={draft.lotName} onChange={(e) => setDraft({ ...draft, lotName: e.target.value })} className={inputCls} />
            <input placeholder="Preço R$" value={draft.price} onChange={(e) => setDraft({ ...draft, price: e.target.value })} className={inputCls} />
            <input placeholder="Taxa R$" value={draft.fee} onChange={(e) => setDraft({ ...draft, fee: e.target.value })} className={inputCls} />
            <input placeholder="Qtd" value={draft.capacity} onChange={(e) => setDraft({ ...draft, capacity: e.target.value })} className={inputCls} />
          </div>
          {draft.price && (
            <p className="mt-2 text-[12px] font-bold text-success">
              Preço final ao comprador: R$ {(Number(draft.price || "0") + Number(draft.fee || "0")).toFixed(2).replace(".", ",")}
            </p>
          )}
          <button onClick={addLot} disabled={busy || !draft.typeName || !draft.lotName || !draft.price || !draft.capacity}
            className="mt-3 rounded-xl bg-primary px-5 py-2.5 text-[13px] font-extrabold text-white disabled:opacity-40">
            + Adicionar ingresso
          </button>

          <div className="mt-4 space-y-2">
            {lots.map((lot, i) => (
              <div key={i} className="flex items-center justify-between rounded-lg bg-bg px-4 py-2.5 text-[13px] font-semibold">
                <span>{lot.typeName} — {lot.lotName}</span>
                <span>R$ {lot.price} + R$ {lot.fee || "0"} · {lot.capacity} un · <span className="text-success">Disponível</span></span>
              </div>
            ))}
            {lots.length === 0 && <p className="text-[13px] text-muted">Nenhum ingresso ainda — adicione o primeiro acima.</p>}
          </div>

          <div className="mt-5 flex gap-2">
            <button onClick={() => setStep(0)} className="rounded-xl border-[1.5px] border-line-input px-6 py-2.5 text-[13px] font-bold">Voltar</button>
            <button onClick={() => setStep(2)} disabled={createdLots.length === 0}
              className="rounded-xl bg-primary px-6 py-2.5 text-[13px] font-extrabold text-white disabled:opacity-40">
              Continuar
            </button>
          </div>
        </section>
      )}

      {step === 2 && (
        <section className="mt-6 rounded-2xl border border-line bg-surface p-5">
          <h2 className="text-[16px] font-extrabold">Revisão e publicação</h2>
          <div className="mt-3 space-y-1.5 rounded-xl bg-bg p-4 text-[13px] font-semibold">
            <p><span className="text-muted">Evento:</span> {title}</p>
            <p><span className="text-muted">Início:</span> {startsAt ? new Date(startsAt).toLocaleString("pt-BR") : "—"}</p>
            <p><span className="text-muted">Ingressos:</span> {lots.length} lote(s)</p>
            <p><span className="text-muted">Hotsite:</span> <code>{publicUrl}</code></p>
          </div>
          <div className="mt-3 rounded-xl border border-success/30 bg-success/5 p-3 text-[12px] font-bold text-success">
            Ao publicar, a venda começa imediatamente — sem espera de aprovação.
          </div>
          {published ? (
            <div className="mt-4 space-y-3">
              <p className="text-[14px] font-extrabold text-success">✓ Evento publicado!</p>
              <div className="flex gap-2">
                <a href={publicUrl} target="_blank" className="rounded-xl bg-primary px-5 py-2.5 text-[13px] font-extrabold text-white">Ver hotsite</a>
                <button onClick={() => router.push(`/eventos/${eventId}`)} className="rounded-xl border-[1.5px] border-line-input px-5 py-2.5 text-[13px] font-bold">
                  Ir para o evento
                </button>
              </div>
            </div>
          ) : (
            <div className="mt-4 flex gap-2">
              <button onClick={() => setStep(1)} className="rounded-xl border-[1.5px] border-line-input px-6 py-2.5 text-[13px] font-bold">Voltar</button>
              <button onClick={() => router.push(`/eventos/${eventId}`)} className="rounded-xl border-[1.5px] border-line-input px-6 py-2.5 text-[13px] font-bold">
                Salvar rascunho
              </button>
              <button onClick={publish} disabled={busy}
                className="rounded-xl bg-success px-6 py-2.5 text-[13px] font-extrabold text-white shadow-cta-green disabled:opacity-40">
                {busy ? "Publicando…" : "Publicar evento"}
              </button>
            </div>
          )}
        </section>
      )}
    </main>
  );
}

export default function NewEventPage() {
  return (
    <AuthGuard>
      <Suspense>
        <NewEventContent />
      </Suspense>
    </AuthGuard>
  );
}
