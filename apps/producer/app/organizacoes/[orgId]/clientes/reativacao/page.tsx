"use client";

import { ClientesTabs } from "@/components/ClientesTabs";
import { useEffect, useMemo, useState } from "react";
import { GuardedPanelShell } from "@/components/PanelShell";
import { useAuth } from "@/lib/auth";
import type { CustomerSegment } from "@/lib/customer-crm-api";
import {
  previewReactivation,
  sendReactivation,
  type ReactivationPreview,
  type ReactivationSendResult,
} from "@/lib/crm-reactivation-api";

const SEGMENTS: Array<{ value: CustomerSegment; label: string; help: string }> = [
  { value: "ALL", label: "Todos com opt-in", help: "Toda a base que aceitou receber ofertas por e-mail." },
  { value: "FIRST_TIME", label: "Primeira compra", help: "Clientes que compraram em apenas um evento." },
  { value: "RECURRING", label: "Recorrentes", help: "Clientes que já compraram em 2 ou mais eventos." },
  { value: "FREQUENT", label: "Frequentes", help: "Clientes que já compraram em 3 ou mais eventos." },
  { value: "LAPSED_30", label: "Inativos 30d", help: "Já foram à Casa, mas não têm próxima compra e estão há mais de 30 dias sem evento." },
  { value: "NO_SHOW", label: "No-show", help: "Compraram evento passado, mas não registraram presença." },
  { value: "FOLLOWER", label: "Seguidores", help: "Pessoas que seguem a Casa e também deram opt-in para ofertas." },
  { value: "EMAIL_OPT_IN", label: "Opt-in e-mail", help: "Toda a base com consentimento de marketing por e-mail." },
];

export default function ReactivationCampaignPage({ params }: { params: { orgId: string } }) {
  const { token } = useAuth();
  const [segment, setSegment] = useState<CustomerSegment>("LAPSED_30");
  const [preview, setPreview] = useState<ReactivationPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [ctaLabel, setCtaLabel] = useState("");
  const [ctaUrl, setCtaUrl] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<ReactivationSendResult | null>(null);
  const [idempotencyKey, setIdempotencyKey] = useState("");

  useEffect(() => {
    setIdempotencyKey(globalThis.crypto?.randomUUID?.() ?? `campaign-${Date.now()}-${Math.random()}`);
  }, []);

  useEffect(() => {
    if (!token) return;
    let active = true;
    setPreviewLoading(true);
    setError(null);
    previewReactivation(token, params.orgId, segment)
      .then((result) => {
        if (active) setPreview(result);
      })
      .catch((err) => {
        if (active) {
          setPreview(null);
          setError(err instanceof Error ? err.message : "Não foi possível calcular o público");
        }
      })
      .finally(() => {
        if (active) setPreviewLoading(false);
      });
    return () => {
      active = false;
    };
  }, [token, params.orgId, segment]);

  const selected = useMemo(() => SEGMENTS.find((item) => item.value === segment), [segment]);
  const validCta = (!ctaLabel && !ctaUrl) || (ctaLabel.trim().length >= 2 && /^https?:\/\//i.test(ctaUrl.trim()));
  const canSend = Boolean(
    token &&
      preview?.canSend &&
      subject.trim().length >= 3 &&
      message.trim().length >= 10 &&
      validCta &&
      idempotencyKey &&
      !sending,
  );

  async function sendCampaign() {
    if (!token || !canSend) return;
    setSending(true);
    setError(null);
    setSent(null);
    try {
      const result = await sendReactivation(
        token,
        params.orgId,
        {
          segment,
          subject: subject.trim(),
          message: message.trim(),
          ...(ctaLabel.trim() && ctaUrl.trim()
            ? { ctaLabel: ctaLabel.trim(), ctaUrl: ctaUrl.trim() }
            : {}),
        },
        idempotencyKey,
      );
      setSent(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível enviar a campanha");
    } finally {
      setSending(false);
    }
  }

  return (
    <GuardedPanelShell title="Reativação" organizationId={params.orgId}>
      <main className="mx-auto max-w-5xl px-5 py-7 lg:px-8 lg:py-9">
        <ClientesTabs orgId={params.orgId} />
        <div>
          <p className="text-[11px] font-extrabold uppercase tracking-[.08em] text-primary">Reativação</p>
          <h1 className="mt-1 text-[27px] font-black tracking-tight text-ink">Campanha para clientes</h1>
          <p className="mt-2 max-w-3xl text-[13px] font-semibold leading-relaxed text-muted">
            Reative públicos da sua Casa sem disparar para quem não autorizou marketing. Todo envio desta tela é limitado a clientes com opt-in de ofertas por e-mail.
          </p>
        </div>

        <section className="mt-7 grid gap-5 lg:grid-cols-[1fr_320px]">
          <div className="rounded-3xl border border-line bg-surface p-5 lg:p-6">
            <label className="block">
              <span className="text-[12px] font-extrabold text-ink">Público</span>
              <select value={segment} onChange={(e) => setSegment(e.target.value as CustomerSegment)} className="mt-2 h-11 w-full rounded-xl border border-line-input bg-bg px-3 text-[13px] font-bold text-ink">
                {SEGMENTS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
              </select>
              <span className="mt-1.5 block text-[11px] font-semibold leading-relaxed text-muted">{selected?.help}</span>
            </label>

            <label className="mt-5 block">
              <span className="text-[12px] font-extrabold text-ink">Assunto</span>
              <input value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={120} placeholder="Ex.: Sentimos sua falta — olha o próximo rolê" className="mt-2 h-11 w-full rounded-xl border border-line-input bg-bg px-3 text-[13px] font-semibold text-ink" />
            </label>

            <label className="mt-5 block">
              <span className="text-[12px] font-extrabold text-ink">Mensagem</span>
              <textarea value={message} onChange={(e) => setMessage(e.target.value)} maxLength={2500} rows={8} placeholder="Escreva uma mensagem curta, direta e útil para este segmento." className="mt-2 w-full rounded-xl border border-line-input bg-bg px-3 py-3 text-[13px] font-semibold leading-relaxed text-ink" />
              <span className="mt-1 block text-right text-[10.5px] font-semibold text-muted-2">{message.length}/2500</span>
            </label>

            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <label>
                <span className="text-[12px] font-extrabold text-ink">Texto do botão (opcional)</span>
                <input value={ctaLabel} onChange={(e) => setCtaLabel(e.target.value)} maxLength={50} placeholder="Ver próximo evento" className="mt-2 h-11 w-full rounded-xl border border-line-input bg-bg px-3 text-[13px] font-semibold text-ink" />
              </label>
              <label>
                <span className="text-[12px] font-extrabold text-ink">Link do botão</span>
                <input value={ctaUrl} onChange={(e) => setCtaUrl(e.target.value)} maxLength={500} placeholder="https://borafest.com.br/..." className="mt-2 h-11 w-full rounded-xl border border-line-input bg-bg px-3 text-[13px] font-semibold text-ink" />
              </label>
            </div>
            {!validCta ? <p className="mt-2 text-[11px] font-bold text-danger">Informe texto e link HTTP/HTTPS juntos.</p> : null}

            {error ? <p className="mt-5 rounded-2xl border border-danger/25 bg-danger/5 p-4 text-[12px] font-bold text-danger">{error}</p> : null}
            {sent ? (
              <div className="mt-5 rounded-2xl border border-success/30 bg-success/5 p-4">
                <p className="text-[13px] font-extrabold text-success">Campanha enfileirada</p>
                <p className="mt-1 text-[11.5px] font-semibold text-muted">{sent.queued.toLocaleString("pt-BR")} e-mail{sent.queued === 1 ? "" : "s"} aguardando processamento.</p>
              </div>
            ) : null}

            <div className="mt-6 flex justify-end">
              <button type="button" onClick={sendCampaign} disabled={!canSend} className="h-11 rounded-xl bg-primary px-6 text-[13px] font-extrabold text-white shadow-cta disabled:opacity-40">
                {sending ? "Enfileirando…" : `Enviar para ${preview?.eligibleCount ?? 0} cliente${preview?.eligibleCount === 1 ? "" : "s"}`}
              </button>
            </div>
          </div>

          <aside className="space-y-4">
            <div className="rounded-3xl border border-line bg-surface p-5">
              <p className="text-[10.5px] font-extrabold uppercase tracking-[.05em] text-muted-2">Público elegível</p>
              <p className="mt-2 text-[30px] font-black text-ink">{previewLoading ? "…" : (preview?.eligibleCount ?? 0).toLocaleString("pt-BR")}</p>
              <p className="mt-1 text-[11px] font-semibold text-muted">Somente pessoas com consentimento de ofertas.</p>
              {preview?.truncated ? <p className="mt-3 rounded-xl bg-warning/10 p-3 text-[11px] font-bold text-warning">Base grande demais para disparo único. Refine o segmento.</p> : null}
              {preview && preview.eligibleCount > preview.maxSend ? <p className="mt-3 rounded-xl bg-warning/10 p-3 text-[11px] font-bold text-warning">Limite atual: {preview.maxSend.toLocaleString("pt-BR")} destinatários por campanha.</p> : null}
            </div>

            {preview?.sample.length ? (
              <div className="rounded-3xl border border-line bg-surface p-5">
                <p className="text-[10.5px] font-extrabold uppercase tracking-[.05em] text-muted-2">Amostra do público</p>
                <div className="mt-3 space-y-3">
                  {preview.sample.map((item) => (
                    <div key={item.email.toLowerCase()} className="border-b border-line-divider pb-3 last:border-0 last:pb-0">
                      <p className="truncate text-[12px] font-extrabold text-ink">{item.name || item.email}</p>
                      <p className="mt-0.5 truncate text-[10.5px] font-semibold text-muted">{item.email}</p>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </aside>
        </section>
      </main>
    </GuardedPanelShell>
  );
}
