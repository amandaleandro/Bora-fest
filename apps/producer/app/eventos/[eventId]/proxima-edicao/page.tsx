"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { useEventShell } from "@/lib/eventContext";
import { API_BASE_URL } from "@/lib/config";

type Cadence = "WEEKLY" | "BIWEEKLY" | "MONTHLY" | "CUSTOM";

interface DuplicateResponse {
  event: { id: string; title: string; slug: string; status: string; startsAt: string; endsAt: string };
  copied: {
    ticketTypes: number;
    lots: number;
    addOns: number;
    salesPartners: number;
    checkinPoints: number;
    marketing: boolean;
  };
  warnings: string[];
}

const CADENCES: Array<{ value: Cadence; label: string; help: string }> = [
  { value: "WEEKLY", label: "Toda semana", help: "Mesmo dia e horário, na próxima ocorrência disponível." },
  { value: "BIWEEKLY", label: "A cada 2 semanas", help: "Mantém o mesmo dia e horário a cada quinzena." },
  { value: "MONTHLY", label: "Todo mês", help: "Repete no mesmo dia; se não existir, usa o último dia do mês." },
  { value: "CUSTOM", label: "Escolher data", help: "Você define manualmente o início da próxima edição." },
];

function daysInUtcMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

function addCadence(date: Date, cadence: Exclude<Cadence, "CUSTOM">, monthlyAnchorDay: number): Date {
  const next = new Date(date.getTime());
  if (cadence === "WEEKLY") {
    next.setUTCDate(next.getUTCDate() + 7);
    return next;
  }
  if (cadence === "BIWEEKLY") {
    next.setUTCDate(next.getUTCDate() + 14);
    return next;
  }
  next.setUTCDate(1);
  next.setUTCMonth(next.getUTCMonth() + 1);
  next.setUTCDate(Math.min(monthlyAnchorDay, daysInUtcMonth(next.getUTCFullYear(), next.getUTCMonth())));
  return next;
}

function firstFutureOccurrence(sourceIso: string, cadence: Exclude<Cadence, "CUSTOM">): Date {
  const source = new Date(sourceIso);
  const anchor = source.getUTCDate();
  let next = addCadence(source, cadence, anchor);
  let guard = 0;
  while (next.getTime() <= Date.now() && guard < 520) {
    next = addCadence(next, cadence, anchor);
    guard += 1;
  }
  return next;
}

function toLocalInput(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatDate(date: Date): string {
  return date.toLocaleString("pt-BR", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function CopyToggle({
  checked,
  onChange,
  title,
  description,
  warning,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  title: string;
  description: string;
  warning?: string;
}) {
  return (
    <label className="flex cursor-pointer gap-3 rounded-2xl border border-line bg-surface p-4">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-1 h-4 w-4 shrink-0 accent-primary"
      />
      <span className="min-w-0">
        <span className="block text-[13px] font-extrabold text-ink">{title}</span>
        <span className="mt-0.5 block text-[12px] font-semibold leading-relaxed text-muted">{description}</span>
        {warning ? <span className="mt-1 block text-[11.5px] font-bold text-warning">{warning}</span> : null}
      </span>
    </label>
  );
}

export default function ProximaEdicaoPage({ params }: { params: { eventId: string } }) {
  const router = useRouter();
  const { token } = useAuth();
  const { event } = useEventShell();

  const [title, setTitle] = useState("");
  const [cadence, setCadence] = useState<Cadence>("WEEKLY");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const [copyTickets, setCopyTickets] = useState(true);
  const [copyAddOns, setCopyAddOns] = useState(true);
  const [copySalesPartners, setCopySalesPartners] = useState(true);
  const [copyCheckinPoints, setCopyCheckinPoints] = useState(true);
  const [copyMarketing, setCopyMarketing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<DuplicateResponse | null>(null);

  useEffect(() => {
    if (!event) return;
    setTitle((current) => current || event.title);
    setCustomStart((current) => current || toLocalInput(firstFutureOccurrence(event.startsAt, "WEEKLY")));
  }, [event]);

  const previewDate = useMemo(() => {
    if (!event) return null;
    if (cadence === "CUSTOM") {
      if (!customStart) return null;
      const date = new Date(customStart);
      return Number.isFinite(date.getTime()) ? date : null;
    }
    return firstFutureOccurrence(event.startsAt, cadence);
  }, [cadence, customStart, event]);

  const durationText = useMemo(() => {
    if (!event) return "";
    const minutes = Math.max(1, Math.round((new Date(event.endsAt).getTime() - new Date(event.startsAt).getTime()) / 60_000));
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    if (hours && rest) return `${hours}h ${rest}min`;
    if (hours) return `${hours}h`;
    return `${rest}min`;
  }, [event]);

  async function createNextEdition() {
    if (!token || !event || saving) return;
    setError(null);

    if (title.trim().length < 3) {
      setError("O título precisa de pelo menos 3 caracteres.");
      return;
    }
    if (cadence === "CUSTOM") {
      if (!customStart) {
        setError("Escolha a data de início da próxima edição.");
        return;
      }
      const start = new Date(customStart);
      if (!Number.isFinite(start.getTime()) || start.getTime() <= Date.now()) {
        setError("A próxima edição precisa começar no futuro.");
        return;
      }
      if (customEnd) {
        const end = new Date(customEnd);
        if (!Number.isFinite(end.getTime()) || end.getTime() <= start.getTime()) {
          setError("O término precisa ser depois do início.");
          return;
        }
      }
    }

    setSaving(true);
    try {
      const body = {
        title: title.trim(),
        cadence,
        ...(cadence === "CUSTOM" && customStart ? { startsAt: new Date(customStart).toISOString() } : {}),
        ...(cadence === "CUSTOM" && customEnd ? { endsAt: new Date(customEnd).toISOString() } : {}),
        copyTickets,
        copyAddOns,
        copySalesPartners,
        copyCheckinPoints,
        copyMarketing,
      };

      const response = await fetch(`${API_BASE_URL}/v1/events/${params.eventId}/duplicate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      });
      const payload = (await response.json().catch(() => null)) as DuplicateResponse | { message?: string } | null;
      if (!response.ok) {
        const message = payload && "message" in payload ? payload.message : null;
        throw new Error(message || "Não foi possível criar a próxima edição.");
      }

      setCreated(payload as DuplicateResponse);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível criar a próxima edição.");
    } finally {
      setSaving(false);
    }
  }

  if (!event) {
    return <p className="mt-2 text-[13px] font-semibold text-muted">Carregando evento…</p>;
  }

  if (created) {
    return (
      <main className="mx-auto max-w-[820px] lg:mx-0">
        <section className="rounded-3xl border border-success/25 bg-success/[0.06] p-6 lg:p-7">
          <p className="text-[11px] font-extrabold uppercase tracking-[.08em] text-success">Próxima edição criada</p>
          <h2 className="mt-1 text-[24px] font-black text-ink">{created.event.title}</h2>
          <p className="mt-2 text-[14px] font-extrabold text-ink-soft">{formatDate(new Date(created.event.startsAt))}</p>
          <p className="mt-1 text-[12.5px] font-semibold text-muted">Nasceu como rascunho. Nada foi publicado automaticamente.</p>
        </section>

        <section className="mt-4 rounded-3xl border border-line bg-surface p-5 lg:p-6">
          <h3 className="text-[14px] font-extrabold text-ink">Estrutura reaproveitada</h3>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
            {[
              [created.copied.ticketTypes, "ingressos"],
              [created.copied.lots, "lotes"],
              [created.copied.addOns, "adicionais"],
              [created.copied.salesPartners, "parceiros"],
              [created.copied.checkinPoints, "portões"],
            ].map(([value, label]) => (
              <div key={String(label)} className="rounded-2xl bg-bg p-3 text-center">
                <p className="text-[20px] font-black text-ink">{value}</p>
                <p className="text-[10.5px] font-bold uppercase tracking-[.04em] text-muted">{label}</p>
              </div>
            ))}
          </div>
          <p className="mt-3 text-[11.5px] font-semibold text-muted">
            Marketing: {created.copied.marketing ? "copiado por sua escolha" : "não copiado"}.
          </p>
        </section>

        {created.warnings.length > 0 ? (
          <section className="mt-4 rounded-3xl border border-warning/30 bg-warning/[0.06] p-5">
            <p className="text-[13px] font-extrabold text-ink">Revise antes de publicar</p>
            <ul className="mt-2 space-y-1 text-[12px] font-semibold leading-relaxed text-muted">
              {created.warnings.map((warning) => (
                <li key={warning}>• {warning}</li>
              ))}
            </ul>
          </section>
        ) : null}

        <section className="mt-4 rounded-3xl border border-line bg-surface p-5">
          <p className="text-[12.5px] font-extrabold text-ink">Estado novo, histórico separado</p>
          <p className="mt-1 text-[12px] font-semibold leading-relaxed text-muted">
            Vendidos, reservados, pedidos, ingressos, cortesias, check-ins, aparelhos de portaria, avaliações e financeiro ficaram na edição anterior.
          </p>
        </section>

        <div className="mt-6 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => router.push(`/eventos/${created.event.id}/editar?duplicado=1`)}
            className="h-12 rounded-2xl bg-primary px-6 text-[14px] font-extrabold text-white shadow-cta"
          >
            Revisar novo rascunho →
          </button>
          <button
            type="button"
            onClick={() => router.push(`/eventos/${created.event.id}`)}
            className="h-12 rounded-2xl border border-line-input bg-surface px-5 text-[13px] font-extrabold text-ink-soft"
          >
            Ver ingressos e lotes
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-[820px] lg:mx-0">
      <section className="rounded-3xl border border-primary/20 bg-primary/[0.04] p-5 lg:p-6">
        <p className="text-[11px] font-extrabold uppercase tracking-[.08em] text-primary">N3 · Recorrência</p>
        <h2 className="mt-1 text-[22px] font-black text-ink">Criar a próxima edição em segundos</h2>
        <p className="mt-2 max-w-2xl text-[13px] font-semibold leading-relaxed text-muted">
          O BoraFest reaproveita a estrutura do evento, cria um novo rascunho e zera tudo que pertence à edição anterior. Você revisa antes de publicar.
        </p>
      </section>

      <section className="mt-6 rounded-3xl border border-line bg-surface p-5 lg:p-6">
        <h3 className="text-[15px] font-extrabold text-ink">1. Quando acontece de novo?</h3>
        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          {CADENCES.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => setCadence(option.value)}
              className={`rounded-2xl border p-4 text-left transition ${
                cadence === option.value
                  ? "border-primary bg-primary/[0.06] ring-1 ring-primary/20"
                  : "border-line bg-bg/50 hover:border-primary/30"
              }`}
            >
              <span className="block text-[13px] font-extrabold text-ink">{option.label}</span>
              <span className="mt-1 block text-[11.5px] font-semibold leading-relaxed text-muted">{option.help}</span>
            </button>
          ))}
        </div>

        {cadence === "CUSTOM" ? (
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <label>
              <span className="mb-1.5 block text-[12px] font-bold text-muted">Início</span>
              <input
                type="datetime-local"
                value={customStart}
                onChange={(event) => setCustomStart(event.target.value)}
                className="h-12 w-full rounded-2xl border border-line-input bg-bg px-3.5 text-[13px] font-bold outline-none focus:border-primary"
              />
            </label>
            <label>
              <span className="mb-1.5 block text-[12px] font-bold text-muted">Fim (opcional)</span>
              <input
                type="datetime-local"
                value={customEnd}
                onChange={(event) => setCustomEnd(event.target.value)}
                className="h-12 w-full rounded-2xl border border-line-input bg-bg px-3.5 text-[13px] font-bold outline-none focus:border-primary"
              />
              <span className="mt-1 block text-[10.5px] font-semibold text-muted">Vazio = mantém a duração atual de {durationText}.</span>
            </label>
          </div>
        ) : null}

        {previewDate ? (
          <div className="mt-4 rounded-2xl border border-line bg-bg/60 px-4 py-3">
            <span className="text-[11px] font-bold uppercase tracking-[.05em] text-muted-2">Próxima ocorrência</span>
            <p className="mt-0.5 text-[15px] font-extrabold text-ink">{formatDate(previewDate)}</p>
            <p className="mt-0.5 text-[11.5px] font-semibold text-muted">Duração preservada: {durationText}.</p>
          </div>
        ) : null}
      </section>

      <section className="mt-4 rounded-3xl border border-line bg-surface p-5 lg:p-6">
        <h3 className="text-[15px] font-extrabold text-ink">2. Nome da nova edição</h3>
        <input
          value={title}
          maxLength={160}
          onChange={(event) => setTitle(event.target.value)}
          className="mt-3 h-12 w-full rounded-2xl border border-line-input bg-bg px-3.5 text-[14px] font-bold outline-none focus:border-primary"
        />
        <p className="mt-1.5 text-[11.5px] font-semibold text-muted">Pode manter o nome da festa. O link público ganha um slug único automaticamente.</p>
      </section>

      <section className="mt-4 rounded-3xl border border-line bg-surface p-5 lg:p-6">
        <h3 className="text-[15px] font-extrabold text-ink">3. O que reaproveitar?</h3>
        <p className="mt-1 text-[12px] font-semibold text-muted">Você pode desligar qualquer grupo antes de criar o rascunho.</p>
        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          <CopyToggle
            checked={copyTickets}
            onChange={setCopyTickets}
            title="Ingressos e lotes"
            description="Copia nomes, preços, capacidade e regras. Vendidos e reservados começam em zero; janelas de lote acompanham a nova data."
          />
          <CopyToggle
            checked={copyAddOns}
            onChange={setCopyAddOns}
            title="Itens adicionais"
            description="Copia os extras do checkout, como camiseta, copo ou consumação antecipada."
          />
          <CopyToggle
            checked={copySalesPartners}
            onChange={setCopySalesPartners}
            title="Atléticas e parceiros"
            description="Mantém os parceiros já vinculados à edição para a nova operação comercial."
          />
          <CopyToggle
            checked={copyCheckinPoints}
            onChange={setCopyCheckinPoints}
            title="Portões / pontos de check-in"
            description="Copia apenas a configuração dos portões. PINs e aparelhos autorizados nunca são copiados."
          />
          <div className="sm:col-span-2">
            <CopyToggle
              checked={copyMarketing}
              onChange={setCopyMarketing}
              title="Pixels e CAPI"
              description="Replica IDs de tracking e o token server-side para a nova edição."
              warning="Desligado por padrão: ative somente se esta edição deve usar exatamente a mesma mensuração."
            />
          </div>
        </div>
      </section>

      <section className="mt-4 rounded-3xl border border-success/20 bg-success/[0.04] p-5">
        <p className="text-[13px] font-extrabold text-ink">O que nunca é copiado</p>
        <p className="mt-1 text-[12px] font-semibold leading-relaxed text-muted">
          Pedidos, compradores, ingressos emitidos, reservas, cortesias já usadas, check-ins, aparelhos da portaria, avaliações e histórico financeiro ficam presos à edição original.
        </p>
        <p className="mt-2 text-[11.5px] font-semibold text-muted">
          Promoters com vínculo geral da Casa continuam valendo naturalmente. Vínculos exclusivos deste evento não são duplicados.
        </p>
      </section>

      {error ? (
        <div className="mt-4 rounded-2xl border border-danger/30 bg-danger/5 px-4 py-3 text-[12.5px] font-bold text-danger">
          {error}
        </div>
      ) : null}

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={saving}
          onClick={createNextEdition}
          className="h-12 rounded-2xl bg-primary px-6 text-[14px] font-extrabold text-white shadow-cta disabled:opacity-60"
        >
          {saving ? "Criando próxima edição…" : "Criar rascunho"}
        </button>
        <button
          type="button"
          onClick={() => router.back()}
          disabled={saving}
          className="h-12 rounded-2xl border border-line-input bg-surface px-5 text-[13px] font-extrabold text-ink-soft disabled:opacity-60"
        >
          Cancelar
        </button>
      </div>
    </main>
  );
}
