"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { eventRecurrenceApi } from "@/lib/event-recurrence-api";
import { useEventShell } from "@/lib/eventContext";

const CADENCES = [
  { days: 7, label: "Toda semana" },
  { days: 14, label: "A cada 2 semanas" },
  { days: 28, label: "A cada 4 semanas" },
] as const;

function toLocalInput(iso: string) {
  const d = new Date(iso);
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

export default function EventRecurrencePage() {
  const { token } = useAuth();
  const { event, organization, loading } = useEventShell();
  const router = useRouter();
  const [mode, setMode] = useState<"quick" | "custom">("quick");
  const [cadenceDays, setCadenceDays] = useState(7);
  const [title, setTitle] = useState("");
  const [copyTicketCatalog, setCopyTicketCatalog] = useState(true);
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const preview = useMemo(() => {
    if (!event) return null;
    const start = new Date(event.startsAt);
    const end = new Date(event.endsAt);
    if (mode === "custom" && startsAt && endsAt) {
      return { start: new Date(startsAt), end: new Date(endsAt) };
    }
    const delta = cadenceDays * 86_400_000;
    return { start: new Date(start.getTime() + delta), end: new Date(end.getTime() + delta) };
  }, [cadenceDays, endsAt, event, mode, startsAt]);

  function switchToCustom() {
    if (event && !startsAt) {
      const delta = cadenceDays * 86_400_000;
      setStartsAt(toLocalInput(new Date(new Date(event.startsAt).getTime() + delta).toISOString()));
      setEndsAt(toLocalInput(new Date(new Date(event.endsAt).getTime() + delta).toISOString()));
    }
    setMode("custom");
  }

  async function createEdition() {
    if (!token || !event || saving) return;
    setSaving(true);
    setError(null);
    try {
      const result = mode === "quick"
        ? await eventRecurrenceApi.nextEdition(token, event.id, {
            cadenceDays,
            title: title.trim() || undefined,
            copyTicketCatalog,
          })
        : await eventRecurrenceApi.duplicate(token, event.id, {
            startsAt: new Date(startsAt).toISOString(),
            endsAt: new Date(endsAt).toISOString(),
            title: title.trim() || undefined,
            copyTicketCatalog,
          });

      localStorage.setItem("bf.activeEvent", result.id);
      localStorage.setItem(
        "bf.activeEventInfo",
        JSON.stringify({ id: result.id, title: result.title, status: result.status }),
      );
      router.push(`/eventos/${result.id}/dashboard`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível criar a próxima edição");
    } finally {
      setSaving(false);
    }
  }

  if (loading || !event || !organization) {
    return <p className="p-6 text-[13px] font-semibold text-muted">Carregando evento…</p>;
  }

  return (
    <main className="mx-auto max-w-3xl px-5 py-7 lg:px-8 lg:py-10">
      <div>
        <p className="text-[11px] font-extrabold uppercase tracking-[.08em] text-primary">N3 · recorrência</p>
        <h1 className="mt-1 text-[27px] font-black tracking-tight text-ink">Criar próxima edição</h1>
        <p className="mt-2 text-[13px] font-semibold leading-relaxed text-muted">
          Reaproveite a estrutura de <strong className="text-ink">{event.title}</strong> sem carregar vendas, pedidos, check-ins ou convidados da edição anterior.
        </p>
      </div>

      <section className="mt-7 rounded-3xl border border-line bg-surface p-5 lg:p-6">
        <div className="grid grid-cols-2 gap-2 rounded-2xl bg-bg p-1">
          <button
            type="button"
            onClick={() => setMode("quick")}
            className={`rounded-xl px-4 py-2.5 text-[13px] font-extrabold ${mode === "quick" ? "bg-surface text-primary shadow-sm" : "text-muted"}`}
          >
            Próxima edição
          </button>
          <button
            type="button"
            onClick={switchToCustom}
            className={`rounded-xl px-4 py-2.5 text-[13px] font-extrabold ${mode === "custom" ? "bg-surface text-primary shadow-sm" : "text-muted"}`}
          >
            Data personalizada
          </button>
        </div>

        {mode === "quick" ? (
          <div className="mt-5">
            <label className="text-[12px] font-extrabold text-ink">Frequência</label>
            <div className="mt-2 grid gap-2 sm:grid-cols-3">
              {CADENCES.map((item) => (
                <button
                  key={item.days}
                  type="button"
                  onClick={() => setCadenceDays(item.days)}
                  className={`rounded-2xl border px-3 py-3 text-left text-[12px] font-extrabold ${cadenceDays === item.days ? "border-primary bg-primary/5 text-primary" : "border-line text-ink"}`}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <label>
              <span className="text-[12px] font-extrabold text-ink">Início</span>
              <input type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} className="mt-2 h-11 w-full rounded-xl border border-line-input px-3 text-[13px]" />
            </label>
            <label>
              <span className="text-[12px] font-extrabold text-ink">Fim</span>
              <input type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} className="mt-2 h-11 w-full rounded-xl border border-line-input px-3 text-[13px]" />
            </label>
          </div>
        )}

        <label className="mt-5 block">
          <span className="text-[12px] font-extrabold text-ink">Nome desta edição</span>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={event.title}
            className="mt-2 h-11 w-full rounded-xl border border-line-input px-3 text-[13px]"
          />
          <span className="mt-1 block text-[11px] font-semibold text-muted">Deixe vazio para manter o mesmo nome recorrente.</span>
        </label>

        <label className="mt-5 flex cursor-pointer items-start gap-3 rounded-2xl border border-line bg-bg/50 p-4">
          <input type="checkbox" checked={copyTicketCatalog} onChange={(e) => setCopyTicketCatalog(e.target.checked)} className="mt-0.5 h-4 w-4" />
          <span>
            <span className="block text-[13px] font-extrabold text-ink">Copiar tipos e lotes</span>
            <span className="mt-1 block text-[11px] font-semibold leading-relaxed text-muted">
              Preços, capacidades e regras são copiados. Todos os lotes renascem como rascunho, com vendidos/reservados zerados e datas deslocadas para a nova edição.
            </span>
          </span>
        </label>

        {preview ? (
          <div className="mt-5 rounded-2xl border border-primary/15 bg-primary/5 p-4">
            <p className="text-[11px] font-extrabold uppercase tracking-[.05em] text-primary">Prévia da nova edição</p>
            <p className="mt-1 text-[14px] font-black text-ink">
              {preview.start.toLocaleString("pt-BR", { dateStyle: "medium", timeStyle: "short" })}
            </p>
            <p className="mt-1 text-[12px] font-semibold text-muted">
              até {preview.end.toLocaleString("pt-BR", { dateStyle: "medium", timeStyle: "short" })}
            </p>
          </div>
        ) : null}

        <div className="mt-6 rounded-2xl border border-warning/20 bg-warning/5 p-4 text-[11.5px] font-semibold leading-relaxed text-muted">
          Não copiamos pedidos, ingressos emitidos, reservas, check-ins, lista de convidados, cupons usados, vínculos específicos de promoter nem credenciais de portaria. A nova edição nasce em <strong className="text-ink">rascunho</strong> para revisão humana antes de publicar.
        </div>

        {error ? <p className="mt-4 text-[12px] font-bold text-danger">{error}</p> : null}

        <div className="mt-6 flex flex-wrap justify-end gap-2">
          <button type="button" onClick={() => router.back()} className="h-11 rounded-xl border border-line-input px-5 text-[13px] font-extrabold text-muted">
            Cancelar
          </button>
          <button
            type="button"
            onClick={createEdition}
            disabled={saving || (mode === "custom" && (!startsAt || !endsAt))}
            className="h-11 rounded-xl bg-primary px-5 text-[13px] font-extrabold text-white shadow-cta disabled:opacity-50"
          >
            {saving ? "Criando edição…" : "Criar edição em rascunho"}
          </button>
        </div>
      </section>
    </main>
  );
}
