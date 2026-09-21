"use client";

import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/lib/auth";
import { useEventShell } from "@/lib/eventContext";
import { eventControls, type TicketTheme, type TicketTemplate } from "@/lib/api";

const PRESETS: Array<{
  template: TicketTemplate;
  label: string;
  description: string;
  primaryColor: string;
  secondaryColor: string;
}> = [
  { template: "CLASSIC", label: "Clássico", description: "Limpo e fácil de ler.", primaryColor: "#6D28D9", secondaryColor: "#111827" },
  { template: "DARK", label: "Dark", description: "Escuro e premium.", primaryColor: "#2563EB", secondaryColor: "#050B18" },
  { template: "FESTA", label: "Festa", description: "Mais vibrante para festas e atléticas.", primaryColor: "#DB2777", secondaryColor: "#581C87" },
  { template: "PREMIUM", label: "Premium", description: "Visual elegante para VIP e eventos especiais.", primaryColor: "#D97706", secondaryColor: "#111827" },
];

const DEFAULT_THEME: TicketTheme = {
  template: "CLASSIC",
  primaryColor: "#6D28D9",
  secondaryColor: "#111827",
  backgroundImageUrl: null,
  logoUrl: null,
  sponsorText: null,
  showVenue: true,
  showLot: true,
  showAttendee: true,
};

export default function TicketStudioPage({ params }: { params: { eventId: string } }) {
  const { token } = useAuth();
  const { event } = useEventShell();
  const [theme, setTheme] = useState<TicketTheme>(DEFAULT_THEME);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!event) return;
    setTheme({ ...DEFAULT_THEME, ...(event.ticketTheme ?? {}) });
  }, [event]);

  const previewBackground = useMemo(() => {
    if (theme.backgroundImageUrl) {
      return {
        backgroundImage: `linear-gradient(135deg, ${theme.secondaryColor}E6, ${theme.primaryColor}CC), url("${theme.backgroundImageUrl}")`,
        backgroundSize: "cover",
        backgroundPosition: "center",
      };
    }
    return {
      background: `linear-gradient(135deg, ${theme.secondaryColor}, ${theme.primaryColor})`,
    };
  }, [theme]);

  function applyPreset(template: TicketTemplate) {
    const preset = PRESETS.find((item) => item.template === template);
    if (!preset) return;
    setTheme((current) => ({
      ...current,
      template,
      primaryColor: preset.primaryColor,
      secondaryColor: preset.secondaryColor,
    }));
  }

  async function save() {
    if (!token) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      await eventControls.update(params.eventId, { ticketTheme: theme }, token);
      setMessage("Tema do ingresso salvo. Novas aberturas da carteira já usam este visual.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível salvar o tema");
    } finally {
      setSaving(false);
    }
  }

  async function reset() {
    if (!token) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      await eventControls.update(params.eventId, { ticketTheme: null }, token);
      setTheme(DEFAULT_THEME);
      setMessage("Personalização removida. O ingresso voltou ao padrão BoraFest.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível restaurar o tema");
    } finally {
      setSaving(false);
    }
  }

  if (!event) {
    return <p className="mt-4 text-[13px] font-semibold text-muted">Carregando Ticket Studio…</p>;
  }

  return (
    <main className="pb-10">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-[11px] font-extrabold uppercase tracking-[.1em] text-primary">BF-020 · Ticket Studio</p>
          <h1 className="mt-1 text-[27px] font-black tracking-tight text-ink">Ingresso personalizado</h1>
          <p className="mt-2 max-w-3xl text-[13px] font-semibold leading-relaxed text-muted">
            Personalize a apresentação. QR, código, assinatura e validade continuam controlados pelo BoraFest e não são editáveis.
          </p>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={reset} disabled={saving} className="rounded-xl border border-line-input bg-surface px-4 py-2.5 text-[12px] font-extrabold text-muted disabled:opacity-50">
            Restaurar padrão
          </button>
          <button type="button" onClick={save} disabled={saving} className="rounded-xl bg-primary px-5 py-2.5 text-[12px] font-extrabold text-white shadow-cta disabled:opacity-50">
            {saving ? "Salvando…" : "Salvar tema"}
          </button>
        </div>
      </div>

      {message ? <p className="mt-4 rounded-2xl border border-success/25 bg-success/5 p-4 text-[12px] font-bold text-success">{message}</p> : null}
      {error ? <p className="mt-4 rounded-2xl border border-danger/25 bg-danger/5 p-4 text-[12px] font-bold text-danger">{error}</p> : null}

      <div className="mt-6 grid gap-6 xl:grid-cols-[1fr_420px]">
        <section className="space-y-5">
          <div className="rounded-3xl border border-line bg-surface p-5">
            <h2 className="text-[16px] font-black text-ink">Modelo</h2>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {PRESETS.map((preset) => (
                <button
                  key={preset.template}
                  type="button"
                  onClick={() => applyPreset(preset.template)}
                  className={`rounded-2xl border p-4 text-left transition ${
                    theme.template === preset.template ? "border-primary bg-primary/5" : "border-line bg-bg hover:border-primary/30"
                  }`}
                >
                  <div className="flex gap-2">
                    <span className="h-7 w-7 rounded-full border border-white/30" style={{ background: preset.secondaryColor }} />
                    <span className="h-7 w-7 -ml-4 rounded-full border border-white/30" style={{ background: preset.primaryColor }} />
                  </div>
                  <p className="mt-3 text-[13px] font-extrabold text-ink">{preset.label}</p>
                  <p className="mt-0.5 text-[11px] font-semibold text-muted">{preset.description}</p>
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-3xl border border-line bg-surface p-5">
            <h2 className="text-[16px] font-black text-ink">Cores e identidade</h2>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <label className="text-[11px] font-bold text-muted">
                Cor principal
                <div className="mt-1 flex h-11 items-center gap-2 rounded-xl border border-line-input bg-bg px-3">
                  <input type="color" value={theme.primaryColor} onChange={(e) => setTheme({ ...theme, primaryColor: e.target.value })} className="h-7 w-8 cursor-pointer bg-transparent" />
                  <input value={theme.primaryColor} onChange={(e) => setTheme({ ...theme, primaryColor: e.target.value })} className="min-w-0 flex-1 bg-transparent text-[12px] font-bold uppercase outline-none" />
                </div>
              </label>
              <label className="text-[11px] font-bold text-muted">
                Cor de fundo
                <div className="mt-1 flex h-11 items-center gap-2 rounded-xl border border-line-input bg-bg px-3">
                  <input type="color" value={theme.secondaryColor} onChange={(e) => setTheme({ ...theme, secondaryColor: e.target.value })} className="h-7 w-8 cursor-pointer bg-transparent" />
                  <input value={theme.secondaryColor} onChange={(e) => setTheme({ ...theme, secondaryColor: e.target.value })} className="min-w-0 flex-1 bg-transparent text-[12px] font-bold uppercase outline-none" />
                </div>
              </label>
            </div>

            <label className="mt-4 block text-[11px] font-bold text-muted">
              Imagem de fundo
              <input
                value={theme.backgroundImageUrl ?? ""}
                onChange={(e) => setTheme({ ...theme, backgroundImageUrl: e.target.value || null })}
                placeholder="https://... ou use a arte do evento"
                className="mt-1 h-11 w-full rounded-xl border border-line-input bg-bg px-3 text-[12px] text-ink outline-none focus:border-primary"
              />
            </label>
            {event.bannerUrl ? (
              <button
                type="button"
                onClick={() => setTheme({ ...theme, backgroundImageUrl: event.bannerUrl ?? null })}
                className="mt-2 text-[11.5px] font-extrabold text-primary"
              >
                Usar a arte atual do evento →
              </button>
            ) : null}

            <label className="mt-4 block text-[11px] font-bold text-muted">
              Logo no ingresso
              <input
                value={theme.logoUrl ?? ""}
                onChange={(e) => setTheme({ ...theme, logoUrl: e.target.value || null })}
                placeholder="https://..."
                className="mt-1 h-11 w-full rounded-xl border border-line-input bg-bg px-3 text-[12px] text-ink outline-none focus:border-primary"
              />
            </label>

            <label className="mt-4 block text-[11px] font-bold text-muted">
              Patrocínio / assinatura
              <input
                value={theme.sponsorText ?? ""}
                maxLength={120}
                onChange={(e) => setTheme({ ...theme, sponsorText: e.target.value || null })}
                placeholder="Ex.: Apresentado por Atlética CompExatas"
                className="mt-1 h-11 w-full rounded-xl border border-line-input bg-bg px-3 text-[12px] text-ink outline-none focus:border-primary"
              />
            </label>
          </div>

          <div className="rounded-3xl border border-line bg-surface p-5">
            <h2 className="text-[16px] font-black text-ink">Informações visíveis</h2>
            <div className="mt-3 grid gap-2 sm:grid-cols-3">
              {[
                ["showAttendee", "Nome do participante"],
                ["showLot", "Tipo e lote"],
                ["showVenue", "Local do evento"],
              ].map(([key, label]) => (
                <label key={key} className="flex items-center gap-2 rounded-xl border border-line bg-bg p-3 text-[12px] font-bold text-ink">
                  <input
                    type="checkbox"
                    checked={Boolean(theme[key as keyof TicketTheme])}
                    onChange={(e) => setTheme({ ...theme, [key]: e.target.checked })}
                    className="h-4 w-4 accent-primary"
                  />
                  {label}
                </label>
              ))}
            </div>
          </div>
        </section>

        <aside className="xl:sticky xl:top-6 xl:self-start">
          <p className="mb-2 text-[11px] font-extrabold uppercase tracking-[.08em] text-muted-2">Prévia</p>
          <article className="overflow-hidden rounded-[28px] bg-surface shadow-card">
            <div className="min-h-[190px] p-6 text-white" style={previewBackground}>
              {theme.logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={theme.logoUrl} alt="" className="mb-5 h-10 max-w-[150px] object-contain object-left" />
              ) : (
                <p className="mb-5 text-[11px] font-black uppercase tracking-[.12em] text-white/70">BoraFest</p>
              )}
              <h2 className="text-[23px] font-black leading-tight">{event.title}</h2>
              <p className="mt-2 text-[12px] font-bold text-white/80">18 out · 22:00</p>
              {theme.showVenue ? <p className="mt-1 text-[11px] font-semibold text-white/75">{event.venue?.name ?? "Local do evento"}</p> : null}
              {theme.sponsorText ? <p className="mt-5 text-[10.5px] font-bold text-white/75">{theme.sponsorText}</p> : null}
            </div>
            <div className="border-t-2 border-dashed border-line p-6 text-center">
              <div className="mx-auto flex h-[170px] w-[170px] items-center justify-center rounded-2xl border border-line bg-white">
                <div className="grid grid-cols-7 gap-1">
                  {Array.from({ length: 49 }).map((_, i) => (
                    <span key={i} className={`h-2 w-2 ${i % 3 === 0 || i % 7 === 0 ? "bg-black" : "bg-black/15"}`} />
                  ))}
                </div>
              </div>
              {theme.showAttendee ? <p className="mt-4 text-[15px] font-black text-ink">Amanda</p> : null}
              <p className="text-[11px] font-bold text-muted">BF-EXEMPLO</p>
              {theme.showLot ? (
                <span className="mt-2 inline-block rounded-full px-3 py-1 text-[11px] font-extrabold" style={{ backgroundColor: `${theme.primaryColor}15`, color: theme.primaryColor }}>
                  Pista · 1º lote
                </span>
              ) : null}
            </div>
          </article>
          <p className="mt-3 text-[10.5px] font-semibold leading-relaxed text-muted">
            Esta prévia não representa um QR válido. O QR real continua sendo gerado e assinado pelo backend.
          </p>
        </aside>
      </div>
    </main>
  );
}
