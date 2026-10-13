"use client";

import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/lib/auth";
import { useEventShell } from "@/lib/eventContext";
import {
  EVENT_CATEGORIES,
  eventControls,
  type EventCategory,
  type EventSummary,
  type UpdateEventInput,
} from "@/lib/api";
import { hotsiteUrl } from "@/lib/config";
import { copiarTexto } from "@/lib/copiar";
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

// isPrivate e followersNotifiedAt agora são do EventSummary (lib/api.ts, 2026-10-12)

/**
 * EVENTO PRIVADO (2026-10-12): o servidor aceita `isPrivate` desde 10/10, mas
 * não havia chave no painel. Salva na hora, como a sala de espera — o resto do
 * formulário continua no "Salvar alterações".
 *
 * Abrir ao público um evento já à venda manda o aviso aos seguidores da Casa
 * (uma vez só, decidido no servidor). Como esse e-mail não volta atrás, pede
 * confirmação no próprio lugar. Fechar (deixar privado) não manda nada.
 */
function EventoPrivado({
  eventId,
  event,
  onSalvo,
}: {
  eventId: string;
  event: EventSummary;
  onSalvo: () => void;
}) {
  const { token } = useAuth();
  const [privado, setPrivado] = useState(event.isPrivate === true);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [confirmarAbrir, setConfirmarAbrir] = useState(false);
  const [copia, setCopia] = useState<"ok" | "falhou" | null>(null);
  // trava de clique duplo: o estado do React só muda no próximo render
  const emAndamento = useRef(false);

  // o evento recarregou: a chave mostra o que está gravado
  useEffect(() => {
    if (typeof event.isPrivate === "boolean") setPrivado(event.isPrivate);
  }, [event.isPrivate]);

  const link = hotsiteUrl(event.slug);
  const linkAbre = event.status === "PUBLISHED" || event.status === "SALES_PAUSED";
  // mesma condição do servidor (events.service anunciarAosSeguidoresUmaVez)
  const abrirAvisaSeguidores =
    privado && event.status === "PUBLISHED" && !event.followersNotifiedAt && new Date(event.endsAt) > new Date();

  async function gravar(proximo: boolean) {
    if (!token || emAndamento.current) return;
    emAndamento.current = true;
    setSalvando(true);
    setErro(null);
    setAviso(null);
    try {
      const corpo: UpdateEventInput = { isPrivate: proximo };
      const salvo = await eventControls.update(eventId, corpo, token);
      const ficou = typeof salvo?.isPrivate === "boolean" ? salvo.isPrivate : proximo;
      const avisou = !event.followersNotifiedAt && Boolean(salvo?.followersNotifiedAt);
      setPrivado(ficou);
      setConfirmarAbrir(false);
      setAviso(
        ficou
          ? "Salvo — o evento agora é privado. Só entra quem tiver o link."
          : avisou
            ? "Salvo — o evento está aberto ao público, e os seguidores da Casa vão receber o aviso."
            : "Salvo — o evento está aberto ao público.",
      );
      onSalvo();
    } catch (err) {
      setErro(err instanceof Error && err.message ? err.message : "Não foi possível salvar — tente de novo.");
    } finally {
      emAndamento.current = false;
      setSalvando(false);
    }
  }

  function alternar() {
    if (salvando) return;
    if (privado && abrirAvisaSeguidores) {
      setAviso(null);
      setErro(null);
      setConfirmarAbrir(true);
      return;
    }
    gravar(!privado);
  }

  async function copiar() {
    const ok = await copiarTexto(link);
    setCopia(ok ? "ok" : "falhou");
    if (ok) setTimeout(() => setCopia(null), 2000);
  }

  return (
    <section className="mt-5 space-y-3">
      <div
        className={`flex items-center justify-between gap-3 rounded-2xl border-[1.5px] px-3.5 py-3 ${
          privado ? "border-success bg-success/10" : "border-line-input bg-surface"
        }`}
      >
        <div className="min-w-0">
          <p className="text-[13.5px] font-extrabold text-ink">Evento privado</p>
          <p className="text-[11.5px] font-semibold text-muted">
            Fora da home, da busca, da página da Casa e do Google. Abre só por link.
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={privado}
          aria-label="Evento privado"
          onClick={alternar}
          disabled={salvando || confirmarAbrir}
          className={`relative h-7 w-[46px] shrink-0 rounded-full transition-colors disabled:opacity-60 ${
            privado ? "bg-success" : "bg-line-input"
          }`}
        >
          <span
            className={`absolute left-[3px] top-[3px] h-[22px] w-[22px] rounded-full bg-white shadow transition-transform ${
              privado ? "translate-x-[18px]" : ""
            }`}
          />
        </button>
      </div>

      {confirmarAbrir ? (
        <div className="space-y-2 rounded-xl border-[1.5px] border-primary/30 bg-primary/5 p-3.5">
          <p className="text-[14px] font-extrabold text-ink">Abrir ao público?</p>
          <p className="text-[13px] text-ink-soft">
            O evento volta para a home, a busca e a página da Casa, e os seguidores da Casa recebem o aviso agora.
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setConfirmarAbrir(false)}
              disabled={salvando}
              className="flex-1 rounded-lg border border-line bg-surface px-3 py-2 text-[13px] font-bold text-muted"
            >
              Voltar
            </button>
            <button
              type="button"
              onClick={() => gravar(false)}
              disabled={salvando}
              className="flex-1 rounded-lg bg-primary px-3 py-2 text-[13px] font-bold text-white disabled:opacity-40"
            >
              {salvando ? "Abrindo…" : "Abrir ao público"}
            </button>
          </div>
        </div>
      ) : null}

      {erro ? <p className="text-[12.5px] font-bold text-danger">{erro}</p> : null}
      {aviso && !erro ? <p className="text-[12.5px] font-bold text-success">{aviso}</p> : null}

      <div>
        <label className={labelClass}>Link do evento</label>
        <div className="flex items-center gap-2 rounded-xl border border-dashed border-line-input bg-bg px-3 py-2.5">
          <code className="min-w-0 flex-1 break-all font-mono text-[12px] text-ink">
            {link.replace(/^https?:\/\//, "")}
          </code>
          <button
            type="button"
            onClick={copiar}
            className="h-10 shrink-0 rounded-xl border-[1.5px] border-line-input bg-surface px-3 text-[12.5px] font-extrabold text-ink"
          >
            {copia === "ok" ? "Copiado ✓" : "Copiar"}
          </button>
        </div>
        {copia === "falhou" ? (
          <p className="mt-1 text-[11.5px] font-semibold text-danger">
            Não deu para copiar sozinho. Selecione o link acima e copie.
          </p>
        ) : null}
        {!linkAbre ? (
          <p className="mt-1 text-[11.5px] font-bold text-warning">
            {event.status === "CANCELED"
              ? "Evento cancelado: o link não abre mais."
              : "O link só abre depois que o evento for publicado."}
          </p>
        ) : null}
      </div>
      <p className="text-[11.5px] font-semibold text-muted">
        Seguidores da Casa não recebem aviso enquanto ele for privado. Se você abrir ao público depois, eles recebem
        o aviso uma vez.
      </p>
    </section>
  );
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

      {typeof event.isPrivate === "boolean" ? (
        <EventoPrivado eventId={params.eventId} event={event} onSalvo={reload} />
      ) : (
        // não sabemos se é privado: melhor não mostrar a chave do que mostrar "público" chutado
        <p className="mt-5 text-[12.5px] font-bold text-danger">
          Não foi possível saber se o evento é privado. Recarregue a página para ver a chave.
        </p>
      )}

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
