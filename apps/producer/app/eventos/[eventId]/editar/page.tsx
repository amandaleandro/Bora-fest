"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth";
import { useEventShell } from "@/lib/eventContext";
import { EVENT_CATEGORIES, eventControls, type EventCategory } from "@/lib/api";
import { CancelarEvento } from "@/components/CancelarEvento";

const labelClass = "mb-1.5 block text-[12px] font-bold text-muted";
const inputClass =
  "h-12 w-full rounded-2xl border-[1.5px] border-line-input bg-surface px-3.5 text-[14px] font-bold outline-none focus:border-primary";
const areaClass =
  "w-full rounded-2xl border-[1.5px] border-line-input bg-surface px-3.5 py-3 text-[14px] font-semibold leading-relaxed outline-none focus:border-primary";

/** ISO → valor de <input type="datetime-local"> no fuso local. */
function toLocalInput(iso: string | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * Editar dados do evento (2026-08-17): o PATCH /v1/events/:id sempre existiu,
 * mas nenhuma tela editava título/descrição/line-up/datas — o Arthur contratou
 * mais um DJ e não tinha onde adicionar. Local, banner e status continuam na
 * página Ingressos; aqui é o texto e o calendário do evento.
 */
export default function EditarEventoPage({ params }: { params: { eventId: string } }) {
  const { token } = useAuth();
  const { event, reload } = useEventShell();

  const [title, setTitle] = useState("");
  const [category, setCategory] = useState<EventCategory | "">("");
  const [description, setDescription] = useState("");
  const [lineup, setLineup] = useState("");
  const [amenities, setAmenities] = useState("");
  const [minAge, setMinAge] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // pré-preenche uma vez quando o contexto do evento chega
  useEffect(() => {
    if (!event || loaded) return;
    setTitle(event.title);
    setCategory((event.category as EventCategory | null) ?? "");
    setDescription(event.description ?? "");
    setLineup(event.lineup ?? "");
    setAmenities(event.amenities ?? "");
    setMinAge(event.minAge != null ? String(event.minAge) : "");
    setStartsAt(toLocalInput(event.startsAt));
    setEndsAt(toLocalInput(event.endsAt));
    setLoaded(true);
  }, [event, loaded]);

  async function salvar() {
    if (!token) return;
    if (title.trim().length < 3) {
      setError("O título precisa de pelo menos 3 caracteres");
      return;
    }
    if (!startsAt || !endsAt) {
      setError("Informe início e fim do evento");
      return;
    }
    if (new Date(endsAt) <= new Date(startsAt)) {
      setError("O fim precisa ser depois do início");
      return;
    }
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      await eventControls.update(
        params.eventId,
        {
          title: title.trim(),
          ...(category ? { category } : {}),
          description: description.trim(),
          lineup: lineup.trim(),
          amenities: amenities.trim(),
          ...(minAge.trim() !== "" ? { minAge: Math.max(0, Math.min(99, Number(minAge) || 0)) } : {}),
          startsAt: new Date(startsAt).toISOString(),
          endsAt: new Date(endsAt).toISOString(),
        },
        token,
      );
      setSaved(true);
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível salvar — tente de novo");
    } finally {
      setSaving(false);
    }
  }

  if (!event) return <p className="mt-2 text-[13px] font-semibold text-muted">Carregando…</p>;

  return (
    <main className="mx-auto max-w-[640px] lg:mx-0">
      <p className="text-[13px] font-semibold text-muted">
        As mudanças aparecem no site na hora — inclusive para quem já comprou. Local, banner e
        publicação ficam na aba Ingressos.
      </p>

      <div className="mt-5 space-y-4">
        <div>
          <label className={labelClass}>Título do evento</label>
          <input value={title} onChange={(e) => setTitle(e.target.value)} className={inputClass} />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelClass}>Categoria</label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value as EventCategory)}
              className={inputClass}
            >
              {EVENT_CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelClass}>Idade mínima</label>
            <input
              inputMode="numeric"
              value={minAge}
              onChange={(e) => setMinAge(e.target.value.replace(/\D/g, "").slice(0, 2))}
              placeholder="Livre"
              className={inputClass}
            />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className={labelClass}>Início</label>
            <input
              type="datetime-local"
              value={startsAt}
              onChange={(e) => setStartsAt(e.target.value)}
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass}>Fim</label>
            <input
              type="datetime-local"
              value={endsAt}
              onChange={(e) => setEndsAt(e.target.value)}
              className={inputClass}
            />
          </div>
        </div>

        <div>
          <label className={labelClass}>Line-up / atrações — um nome por linha</label>
          <textarea
            rows={5}
            value={lineup}
            onChange={(e) => setLineup(e.target.value)}
            placeholder={"DJ Fulano\nBanda Tal\nDJ Beltrano"}
            className={areaClass}
          />
          <p className="mt-1 text-[11.5px] font-semibold text-muted-2">
            O hotsite monta a seção de atrações com uma linha por nome.
          </p>
        </div>

        <div>
          <label className={labelClass}>Descrição</label>
          <textarea
            rows={5}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className={areaClass}
          />
        </div>

        <div>
          <label className={labelClass}>O que está incluso — um item por linha</label>
          <textarea
            rows={3}
            value={amenities}
            onChange={(e) => setAmenities(e.target.value)}
            placeholder={"Open bar até 23h\nCopo personalizado"}
            className={areaClass}
          />
        </div>
      </div>

      {error && <p className="mt-4 text-[12.5px] font-bold text-danger">{error}</p>}
      {saved && !error && (
        <p className="mt-4 text-[12.5px] font-bold text-success">Salvo! O site já está atualizado.</p>
      )}

      <button
        onClick={salvar}
        disabled={saving}
        className={`mt-5 h-14 w-full rounded-2xl text-[15px] font-extrabold text-white lg:w-auto lg:px-10 ${
          saving ? "cursor-wait bg-primary/60" : "bg-primary shadow-cta"
        }`}
      >
        {saving ? "Salvando…" : "Salvar alterações"}
      </button>

      <CancelarEvento eventId={params.eventId} jaCancelado={event.status === "CANCELED"} />
    </main>
  );
}
