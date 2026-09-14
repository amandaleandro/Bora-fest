"use client";

import Link from "next/link";
import QRCode from "react-qr-code";
import { useCallback, useEffect, useState } from "react";
import { API_BASE_URL } from "../../../../../lib/config";

type ReservationStatus = "REQUESTED" | "CONFIRMED" | "REJECTED" | "CANCELED";
type VipPayment = {
  id: string;
  method: "PIX" | "CARD";
  status: string;
  amountCents: number;
  pixQrCodeText: string | null;
  failReason: string | null;
  expiresAt: string | null;
  paidAt: string | null;
};
type PaymentSummary = {
  depositCents: number | null;
  paymentDueAt: string | null;
  paidCents: number;
  refundPendingCents: number;
  depositRemainingCents: number;
  totalRemainingCents: number;
  latestPayment: VipPayment | null;
};
type Reservation = {
  publicToken: string;
  status: ReservationStatus;
  units: number;
  partySize: number;
  unitPriceCents: number;
  totalCents: number;
  resolutionNote: string | null;
  respondedAt: string | null;
  createdAt: string;
  payment: PaymentSummary;
  inventory: {
    name: string;
    kind: string;
    event: { title: string; slug: string; startsAt: string };
  };
};

const STATUS: Record<ReservationStatus, { title: string; description: string }> = {
  REQUESTED: { title: "Aguardando confirmação", description: "A Casa recebeu seu pedido e ainda precisa confirmar a disponibilidade." },
  CONFIRMED: { title: "Reserva confirmada", description: "Sua unidade VIP está confirmada para este evento." },
  REJECTED: { title: "Reserva não confirmada", description: "A Casa não conseguiu confirmar este pedido." },
  CANCELED: { title: "Reserva cancelada", description: "Esta reserva foi cancelada e não ocupa mais o inventário VIP." },
};

function money(cents: number) {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
const digits = (value: string) => value.replace(/\D/g, "");

export default function VipReservationStatusPage({ params }: { params: { slug: string; publicToken: string } }) {
  const [reservation, setReservation] = useState<Reservation | null>(null);
  const [loading, setLoading] = useState(true);
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cpf, setCpf] = useState("");
  const [phone, setPhone] = useState("");
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    const response = await fetch(`${API_BASE_URL}/v1/public/vip/reservations/${encodeURIComponent(params.publicToken)}`, { cache: "no-store" });
    if (!response.ok) throw new Error(response.status === 404 ? "Reserva não encontrada" : "Não foi possível consultar a reserva");
    const payload = await response.json() as Reservation;
    setReservation(payload);
    return payload;
  }, [params.publicToken]);

  useEffect(() => {
    let active = true;
    load()
      .catch((err) => { if (active) setError(err instanceof Error ? err.message : "Não foi possível consultar a reserva"); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [load]);

  useEffect(() => {
    const payment = reservation?.payment.latestPayment;
    if (!payment || !["PENDING", "AUTHORIZED"].includes(payment.status)) return;
    const id = setInterval(async () => {
      try {
        await fetch(`${API_BASE_URL}/v1/public/vip/reservations/${encodeURIComponent(params.publicToken)}/payments/sync`, { method: "POST" });
        await load();
      } catch {
        // polling é best-effort; o webhook continua sendo a fonte principal
      }
    }, 5000);
    return () => clearInterval(id);
  }, [reservation?.payment.latestPayment?.id, reservation?.payment.latestPayment?.status, params.publicToken, load]);

  async function createPix() {
    if (!reservation) return;
    const payerDocument = digits(cpf);
    const payerPhone = digits(phone);
    if (payerDocument.length !== 11 && payerDocument.length !== 14) {
      setError("Informe um CPF ou CNPJ válido para gerar o Pix");
      return;
    }
    if (payerPhone && payerPhone.length < 10) {
      setError("Informe um telefone com DDD ou deixe o campo vazio");
      return;
    }
    setPaying(true);
    setError(null);
    try {
      const response = await fetch(`${API_BASE_URL}/v1/public/vip/reservations/${encodeURIComponent(params.publicToken)}/payments/pix`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": crypto.randomUUID(),
        },
        body: JSON.stringify({ payerDocument, payerPhone: payerPhone || undefined }),
      });
      const body = await response.json().catch(() => ({})) as { message?: string | string[] };
      if (!response.ok) {
        const message = Array.isArray(body.message) ? body.message.join(" · ") : body.message;
        throw new Error(message || "Não foi possível gerar o Pix");
      }
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível gerar o Pix");
    } finally {
      setPaying(false);
    }
  }

  async function copyPix(code: string) {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }

  if (loading) return <main className="mx-auto max-w-3xl px-5 py-16 text-center text-sm text-white/60">Consultando reserva…</main>;

  const payment = reservation?.payment;
  const pix = payment?.latestPayment;
  const depositPaid = Boolean(payment?.depositCents && payment.paidCents >= payment.depositCents);

  return (
    <main className="mx-auto min-h-screen max-w-3xl px-5 py-12 text-white">
      <Link href={`/${params.slug}`} className="text-sm font-bold text-white/60 hover:text-white">← Voltar para o evento</Link>
      {error ? <div className="mt-8 rounded-3xl border border-red-400/25 bg-red-400/10 p-6 text-sm font-bold text-red-200">{error}</div> : null}
      {reservation ? (
        <section className="mt-8 rounded-3xl border border-white/10 bg-white/[.055] p-6 lg:p-8">
          <p className="text-xs font-black uppercase tracking-[.12em] text-primary">Reserva VIP</p>
          <h1 className="mt-2 text-3xl font-black">{STATUS[reservation.status].title}</h1>
          <p className="mt-3 text-sm font-semibold leading-relaxed text-white/60">{STATUS[reservation.status].description}</p>
          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            <div className="rounded-2xl bg-black/15 p-4"><p className="text-[10px] font-black uppercase text-white/40">Evento</p><p className="mt-1 font-black">{reservation.inventory.event.title}</p></div>
            <div className="rounded-2xl bg-black/15 p-4"><p className="text-[10px] font-black uppercase text-white/40">Espaço</p><p className="mt-1 font-black">{reservation.inventory.name}</p></div>
            <div className="rounded-2xl bg-black/15 p-4"><p className="text-[10px] font-black uppercase text-white/40">Reserva</p><p className="mt-1 font-black">{reservation.units} unidade(s) · {reservation.partySize} pessoas</p></div>
            <div className="rounded-2xl bg-black/15 p-4"><p className="text-[10px] font-black uppercase text-white/40">Valor total</p><p className="mt-1 font-black">{money(reservation.totalCents)}</p></div>
          </div>

          {reservation.status === "CONFIRMED" && payment?.depositCents ? (
            <div className="mt-6 rounded-3xl border border-primary/25 bg-primary/10 p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div><p className="text-[10px] font-black uppercase tracking-[.08em] text-primary">Sinal da reserva</p><p className="mt-1 text-2xl font-black">{money(payment.depositCents)}</p></div>
                {depositPaid ? <span className="rounded-full bg-emerald-400/15 px-3 py-1.5 text-xs font-black text-emerald-200">✓ Sinal pago</span> : <span className="rounded-full bg-amber-300/15 px-3 py-1.5 text-xs font-black text-amber-100">Aguardando pagamento</span>}
              </div>
              {payment.paymentDueAt ? <p className="mt-2 text-xs font-semibold text-white/55">Prazo: {new Date(payment.paymentDueAt).toLocaleString("pt-BR")}</p> : null}
              {payment.refundPendingCents > 0 ? <p className="mt-4 rounded-xl bg-amber-300/10 p-3 text-xs font-bold text-amber-100">Estorno em processamento: {money(payment.refundPendingCents)}</p> : null}

              {!depositPaid && payment.refundPendingCents === 0 && !pix?.pixQrCodeText ? (
                <div className="mt-5 grid gap-3 sm:grid-cols-2">
                  <label className="text-xs font-bold text-white/60">CPF/CNPJ do pagador<input value={cpf} onChange={(e) => setCpf(e.target.value)} inputMode="numeric" placeholder="Somente números" className="mt-1.5 h-12 w-full rounded-xl border border-white/10 bg-black/20 px-4 text-sm text-white outline-none focus:border-primary" /></label>
                  <label className="text-xs font-bold text-white/60">Telefone com DDD <span className="font-medium text-white/35">(opcional)</span><input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" placeholder="34999999999" className="mt-1.5 h-12 w-full rounded-xl border border-white/10 bg-black/20 px-4 text-sm text-white outline-none focus:border-primary" /></label>
                  <button type="button" disabled={paying} onClick={createPix} className="h-12 rounded-xl bg-primary px-5 text-sm font-black text-white disabled:opacity-50 sm:col-span-2">{paying ? "Gerando Pix…" : `Gerar Pix de ${money(payment.depositRemainingCents)}`}</button>
                </div>
              ) : null}

              {!depositPaid && pix?.pixQrCodeText ? (
                <div className="mt-5 grid gap-5 md:grid-cols-[180px_1fr] md:items-center">
                  <div className="mx-auto rounded-2xl bg-white p-3"><QRCode value={pix.pixQrCodeText} size={156} /></div>
                  <div><p className="text-sm font-black">Escaneie ou copie o código Pix</p><p className="mt-1 text-xs font-semibold text-white/55">A confirmação acontece automaticamente. Você pode manter esta página aberta.</p><div className="mt-3 break-all rounded-xl bg-black/20 p-3 text-[10px] font-semibold text-white/55">{pix.pixQrCodeText}</div><button type="button" onClick={() => copyPix(pix.pixQrCodeText!)} className="mt-3 h-10 rounded-xl border border-white/15 px-4 text-xs font-black text-white">{copied ? "Copiado ✓" : "Copiar Pix"}</button>{pix.expiresAt ? <p className="mt-2 text-[11px] text-white/40">QR válido até {new Date(pix.expiresAt).toLocaleString("pt-BR")}</p> : null}</div>
                </div>
              ) : null}

              {depositPaid ? <div className="mt-4 rounded-2xl bg-emerald-400/10 p-4 text-sm font-bold text-emerald-100">Sinal confirmado. Saldo restante da reserva: {money(payment.totalRemainingCents)}.</div> : null}
            </div>
          ) : null}

          {reservation.status === "CONFIRMED" && !payment?.depositCents ? <div className="mt-6 rounded-2xl border border-white/10 p-4 text-sm font-semibold text-white/60">A Casa confirmou sua reserva sem exigir sinal online até o momento.</div> : null}
          {reservation.resolutionNote ? <div className="mt-5 rounded-2xl border border-white/10 p-4 text-sm font-semibold text-white/70">{reservation.resolutionNote}</div> : null}
          <p className="mt-6 break-all text-[11px] font-semibold text-white/35">Código: {reservation.publicToken}</p>
        </section>
      ) : null}
    </main>
  );
}
