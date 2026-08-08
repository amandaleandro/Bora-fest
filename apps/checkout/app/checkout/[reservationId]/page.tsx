"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import QRCode from "react-qr-code";
import {
  api,
  ApiError,
  type Order,
  type OrderAttendeeInput,
  type PublicEvent,
  type Reservation,
} from "../../../lib/api";
import { formatCents, formatDateTime } from "../../../lib/format";
import { getAttributedPartnerSlug } from "../../../lib/attribution";
import { Icon, paths } from "../../../components/icons";

type Step = "ident" | "participantes" | "pagamento";
type PayTab = "pix" | "cartao";

/** Versão vigente de Termos/Privacidade — vai junto do pedido para auditoria LGPD. */
const CONSENT_VERSION = "v2026-07";
/** Avisos de sandbox só aparecem em ambiente de teste. */
const SHOW_TEST_HINTS = process.env.NEXT_PUBLIC_SHOW_TEST_HINTS === "true";

const inputClass =
  "mt-1 h-[50px] w-full rounded-2xl border-[1.5px] border-line-input bg-surface px-4 text-[14px] font-medium outline-none focus:border-primary";
const labelClass = "text-[12px] font-bold text-ink-soft";
const cardClass = "lg:rounded-[20px] lg:border lg:border-line lg:bg-surface lg:p-6";

function ctaClass(disabled: boolean) {
  return `h-14 w-full rounded-2xl text-[15px] font-extrabold text-white ${
    disabled ? "cursor-not-allowed bg-[#ecd6e4]" : "bg-primary shadow-cta"
  }`;
}

const onlyDigits = (value: string) => value.replace(/\D/g, "");

function maskCpf(value: string) {
  const d = onlyDigits(value).slice(0, 11);
  return d
    .replace(/(\d{3})(\d)/, "$1.$2")
    .replace(/(\d{3})\.(\d{3})(\d)/, "$1.$2.$3")
    .replace(/(\d{3})\.(\d{3})\.(\d{3})(\d)/, "$1.$2.$3-$4");
}

function useCountdown(target: string | null) {
  // sem alvo carregado ainda => infinito (nunca tratar como expirado)
  const [left, setLeft] = useState<number>(() =>
    target ? Math.max(0, new Date(target).getTime() - Date.now()) : Number.POSITIVE_INFINITY,
  );
  useEffect(() => {
    if (!target) {
      setLeft(Number.POSITIVE_INFINITY);
      return;
    }
    // recalcula imediatamente ao receber o alvo (sem esperar o 1º tick)
    setLeft(Math.max(0, new Date(target).getTime() - Date.now()));
    const id = setInterval(
      () => setLeft(Math.max(0, new Date(target).getTime() - Date.now())),
      1000,
    );
    return () => clearInterval(id);
  }, [target]);
  const finite = Number.isFinite(left);
  const mm = finite ? String(Math.floor(left / 60000)).padStart(2, "0") : "--";
  const ss = finite ? String(Math.floor((left % 60000) / 1000)).padStart(2, "0") : "--";
  return { left, label: `${mm}:${ss}`, visible: finite };
}

function ProgressBar({ step, stages }: { step: Step; stages: Array<{ key: Step; label: string }> }) {
  const idx = stages.findIndex((s) => s.key === step);
  return (
    <div className="flex items-center gap-2 pt-1">
      {stages.map((s, i) => (
        <div key={s.key} className="flex-1">
          <div className={`h-1.5 rounded-full ${i <= idx ? "bg-primary" : "bg-line"}`} />
          <p className={`mt-1 text-[10px] font-bold ${i <= idx ? "text-primary" : "text-muted-3"}`}>
            {i < idx ? "✓ " : ""}
            {s.label}
          </p>
        </div>
      ))}
    </div>
  );
}

export default function CheckoutPage({ params }: { params: { reservationId: string } }) {
  const { reservationId } = params;
  const router = useRouter();

  const [reservation, setReservation] = useState<Reservation | null>(null);
  const [event, setEvent] = useState<PublicEvent | null>(null);
  const [slug, setSlug] = useState<string | null>(null);
  const [catalogReady, setCatalogReady] = useState(false);
  const [order, setOrder] = useState<Order | null>(null);
  const [step, setStep] = useState<Step>("ident");
  const [error, setError] = useState<string | null>(null);

  // identificação
  const [mode, setMode] = useState<"guest" | "otp">("guest");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  // CPF do pagador: exigência do Asaas para emitir Pix/cartão
  const [buyerCpf, setBuyerCpf] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [otpCode, setOtpCode] = useState("");
  const [otpResendIn, setOtpResendIn] = useState(0);

  // participantes (ingressos nominais)
  const [attendees, setAttendees] = useState<Record<string, { name: string; cpf: string }>>({});

  // cupom
  const [coupon, setCoupon] = useState("");
  const [couponInfo, setCouponInfo] = useState<string | null>(null);
  const [couponPreview, setCouponPreview] = useState<{ code: string; discountCents: number } | null>(null);

  // itens adicionais (upsell)
  const [addOnQty, setAddOnQty] = useState<Record<string, number>>({});

  // resumo compacto no celular: o comprador vê O QUE está comprando enquanto
  // preenche — no desktop o aside sticky já resolve
  const [summaryOpen, setSummaryOpen] = useState(false);

  // pagamento
  const [consent, setConsent] = useState(false);
  const [creating, setCreating] = useState(false);
  const [tab, setTab] = useState<PayTab>("pix");
  const [pixCode, setPixCode] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [pixChecking, setPixChecking] = useState(false);
  const [pixNotice, setPixNotice] = useState<string | null>(null);
  const [approved, setApproved] = useState(false);
  const [cardNumber, setCardNumber] = useState("");
  const [cardExp, setCardExp] = useState("");
  const [cardCvv, setCardCvv] = useState("");
  const [cardHolder, setCardHolder] = useState("");
  const [cardCpf, setCardCpf] = useState("");
  const [cardCep, setCardCep] = useState("");
  const [cardAddrNum, setCardAddrNum] = useState("");
  const [installments, setInstallments] = useState(1);
  const [cardError, setCardError] = useState<string | null>(null);
  const [paying, setPaying] = useState(false);

  // o cronômetro segue visível no pagamento: reserva antes do pedido, janela do
  // pedido depois que ele é criado
  const { left, label: timerLabel, visible: timerVisible } = useCountdown(
    order ? order.expiresAt ?? null : reservation?.expiresAt ?? null,
  );
  const expired =
    !order &&
    reservation !== null &&
    (reservation.status === "EXPIRED" ||
      (reservation.status === "ACTIVE" && Number.isFinite(left) && left <= 0));

  useEffect(() => {
    api
      .getReservation(reservationId)
      .then((r) => {
        // voltou para um checkout já concluído → segue para o pedido
        if (r.status === "CONVERTED") {
          const orderToken = sessionStorage.getItem(`bf.order.${reservationId}`);
          if (orderToken) {
            router.replace(`/pedido/${orderToken}`);
            return;
          }
        }
        setReservation(r);
      })
      .catch(() => setError("Reserva não encontrada"));
  }, [reservationId, router]);

  // catálogo do evento: traz nominal/requiresCpf/feeMode de cada lote
  useEffect(() => {
    if (!reservation) return;
    let active = true;
    const stored = sessionStorage.getItem(`bf.slug.${reservationId}`);
    const resolve = stored ? Promise.resolve(stored) : api.resolveEventSlug(reservation.eventId);
    resolve
      .then((found) => {
        if (!active || !found) return null;
        setSlug(found);
        sessionStorage.setItem(`bf.slug.${reservationId}`, found);
        return api.getPublicEvent(found);
      })
      .then((loaded) => {
        if (active && loaded) setEvent(loaded);
      })
      .catch(() => undefined)
      .finally(() => {
        if (active) setCatalogReady(true);
      });
    return () => {
      active = false;
    };
  }, [reservation, reservationId]);

  useEffect(() => {
    if (otpResendIn <= 0) return;
    const id = setInterval(() => setOtpResendIn((v) => v - 1), 1000);
    return () => clearInterval(id);
  }, [otpResendIn]);

  const lotMeta = useMemo(() => {
    const map = new Map<
      string,
      { label: string; nominal: boolean; requiresCpf: boolean; buyerPaysFee: boolean }
    >();
    for (const type of event?.ticketTypes ?? []) {
      for (const lot of type.lots) {
        map.set(lot.id, {
          label: `${type.name} · ${lot.name}`,
          nominal: Boolean(lot.nominal),
          requiresCpf: Boolean(lot.requiresCpf),
          buyerPaysFee: lot.feeMode !== "PRODUCER",
        });
      }
    }
    return map;
  }, [event]);

  const items = reservation?.items ?? [];

  const lines = items.map((item) => {
    const meta = lotMeta.get(item.ticketLotId);
    return {
      key: item.ticketLotId,
      label: `${meta?.label ?? "Ingresso"}${item.halfPrice ? " · meia" : ""}`,
      quantity: item.quantity,
      priceTotalCents: item.priceCents * item.quantity,
    };
  });

  const subtotalCents = items.reduce((sum, item) => sum + item.priceCents * item.quantity, 0);
  // feeMode PRODUCER: o produtor absorve a taxa — não entra no total do comprador
  const feeTotalCents = items.reduce(
    (sum, item) =>
      lotMeta.get(item.ticketLotId)?.buyerPaysFee === false ? sum : sum + item.feeCents * item.quantity,
    0,
  );
  const validCoupon = couponPreview && couponPreview.code === coupon.trim().toUpperCase() ? couponPreview : null;
  const discountCents = order ? order.discountCents ?? 0 : validCoupon?.discountCents ?? 0;
  const addOnsTotalCents = (event?.addOns ?? []).reduce(
    (sum, addOn) => sum + addOn.priceCents * (addOnQty[addOn.id] ?? 0),
    0,
  );
  const totalCents = order
    ? order.totalCents
    : Math.max(0, subtotalCents + feeTotalCents - discountCents + addOnsTotalCents);

  // um formulário por ingresso nominal
  const nominalSlots = useMemo(() => {
    const slots: Array<{ key: string; ticketLotId: string; label: string; requiresCpf: boolean }> = [];
    for (const item of items) {
      const meta = lotMeta.get(item.ticketLotId);
      if (!meta?.nominal) continue;
      for (let i = 0; i < item.quantity; i += 1) {
        slots.push({
          key: `${item.ticketLotId}:${i}`,
          ticketLotId: item.ticketLotId,
          label: meta.label,
          requiresCpf: meta.requiresCpf,
        });
      }
    }
    return slots;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reservation, lotMeta]);

  const hasNominal = nominalSlots.length > 0;
  const stages: Array<{ key: Step; label: string }> = hasNominal
    ? [
        { key: "ident", label: "Identificação" },
        { key: "participantes", label: "Participantes" },
        { key: "pagamento", label: "Pagamento" },
      ]
    : [
        { key: "ident", label: "Identificação" },
        { key: "pagamento", label: "Pagamento" },
      ];

  function attendeesError(): string | null {
    for (const slot of nominalSlots) {
      const filled = attendees[slot.key];
      if (!filled || filled.name.trim().length < 2) return "Informe o nome de cada participante";
      if (slot.requiresCpf && onlyDigits(filled.cpf ?? "").length !== 11) {
        return "Informe um CPF válido para cada participante";
      }
    }
    return null;
  }

  async function sendOtp() {
    setError(null);
    try {
      await api.requestOtp(email);
      setOtpSent(true);
      setOtpResendIn(30);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Falha ao enviar o código");
    }
  }

  async function confirmOtp() {
    setError(null);
    try {
      const res = await api.verifyOtp(email, otpCode);
      localStorage.setItem("bf.token", res.token);
      localStorage.setItem("bf.email", email);
      if (res.user.name) setName(res.user.name);
      setStep(hasNominal ? "participantes" : "pagamento");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Código inválido");
    }
  }

  async function applyCouponPreview() {
    if (!coupon || !slug) return;
    setCouponInfo(null);
    setCouponPreview(null);
    try {
      const info = await api.checkCoupon(slug, coupon);
      const base = subtotalCents + feeTotalCents;
      const raw =
        info.discountType === "PERCENT"
          ? Math.round((base * info.discountValue) / 100)
          : info.discountValue;
      setCouponPreview({ code: info.code, discountCents: Math.min(raw, base) });
      setCouponInfo(
        info.discountType === "PERCENT"
          ? `Cupom ${info.code}: −${info.discountValue}%`
          : `Cupom ${info.code}: −${formatCents(info.discountValue)}`,
      );
    } catch (e) {
      setCouponInfo(e instanceof ApiError ? `✗ ${e.message}` : "✗ Cupom inválido");
    }
  }

  /** Cria o pedido na primeira tentativa de pagamento — leva participantes e consentimento. */
  async function ensureOrder(): Promise<Order | null> {
    if (order) return order;
    const invalid = attendeesError();
    if (invalid) {
      setError(invalid);
      setStep("participantes");
      return null;
    }
    setCreating(true);
    setError(null);
    try {
      const attendeesPayload: OrderAttendeeInput[] = nominalSlots.map((slot) => ({
        ticketLotId: slot.ticketLotId,
        name: attendees[slot.key].name.trim(),
        cpf: slot.requiresCpf ? onlyDigits(attendees[slot.key].cpf) : undefined,
      }));
      // token de sessão: amarra a compra à conta de quem já entrou
      const token = localStorage.getItem("bf.token") ?? undefined;
      const created = await api.createOrder(
        {
          reservationId,
          contactEmail: email,
          contactName: name || undefined,
          contactPhone: phone || undefined,
          couponCode: validCoupon ? coupon.trim().toUpperCase() : undefined,
          partnerSlug: getAttributedPartnerSlug(),
          addOns: Object.entries(addOnQty).some(([, qty]) => qty > 0)
            ? Object.entries(addOnQty)
                .filter(([, qty]) => qty > 0)
                .map(([addOnId, quantity]) => ({ addOnId, quantity }))
            : undefined,
          attendees: attendeesPayload.length ? attendeesPayload : undefined,
          consent: { version: CONSENT_VERSION, terms: true, privacy: true },
        },
        token,
      );
      setOrder(created);
      sessionStorage.setItem(`bf.order.${reservationId}`, created.publicToken);
      return created;
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Não foi possível criar o pedido");
      return null;
    } finally {
      setCreating(false);
    }
  }

  async function payWithPix() {
    setPixNotice(null);
    const target = await ensureOrder();
    if (!target) return;
    setPaying(true);
    try {
      const pix = await api.createPixPayment(target.id, {
        payerDocument: onlyDigits(buyerCpf),
        payerPhone: onlyDigits(phone) || undefined,
      });
      if (!pix.pixQrCodeText) {
        setError("Não foi possível gerar o Pix agora. Tente de novo em instantes.");
        return;
      }
      setPixCode(pix.pixQrCodeText);
      setError(null); // sucesso apaga erro de tentativa anterior
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Falha ao gerar o Pix");
    } finally {
      setPaying(false);
    }
  }

  /** "Já fiz o pagamento": uma consulta e volta ao normal — nunca trava em "Verificando…". */
  async function checkPaymentNow() {
    if (!order || pixChecking) return;
    setPixChecking(true);
    setPixNotice(null);
    try {
      const status = await api.getOrderStatus(order.publicToken);
      if (["PAID", "FULFILLED"].includes(status.status)) {
        setApproved(true);
        setTimeout(() => router.push(`/pedido/${order.publicToken}`), 1400);
        return;
      }
      setPixNotice("Ainda não identificamos o pagamento. Assim que cair, esta tela avança sozinha.");
    } catch {
      setPixNotice("Não conseguimos verificar agora. Tente de novo em instantes.");
    } finally {
      setPixChecking(false);
    }
  }

  // polling do status até aprovar
  useEffect(() => {
    if (step !== "pagamento" || !order) return;
    const id = setInterval(async () => {
      try {
        const status = await api.getOrderStatus(order.publicToken);
        if (["PAID", "FULFILLED"].includes(status.status)) {
          setApproved(true);
          clearInterval(id);
          setTimeout(() => router.push(`/pedido/${order.publicToken}`), 1400);
        }
      } catch {
        /* mantém polling */
      }
    }, 2500);
    return () => clearInterval(id);
  }, [step, order, router]);

  async function payCard() {
    setCardError(null);
    const target = await ensureOrder();
    if (!target) return;
    setPaying(true);
    const digits = onlyDigits(cardNumber);
    const [expMonth, expYearShort] = cardExp.split("/").map((p) => p.trim());
    try {
      // cartão vai cru por HTTPS direto à nossa API → Asaas (modelo oficial
      // deles); nunca é logado nem persistido. Mock em dev recusa final 0000.
      const res = await api.createCardPayment(target.id, {
        card: {
          number: digits,
          holderName: cardHolder.trim(),
          expiryMonth: (expMonth ?? "").padStart(2, "0"),
          expiryYear: expYearShort && expYearShort.length === 2 ? `20${expYearShort}` : (expYearShort ?? ""),
          ccv: cardCvv,
          holderCpf: onlyDigits(cardCpf),
          postalCode: onlyDigits(cardCep),
          addressNumber: cardAddrNum.trim() || "S/N",
        },
        installments,
        payerDocument: onlyDigits(buyerCpf),
      });
      if (res.status === "FAILED") {
        setCardError(res.failReason ?? "Pagamento recusado — sua reserva continua valendo.");
      }
    } catch (e) {
      setCardError(e instanceof ApiError ? e.message : "Pagamento recusado");
    } finally {
      setPaying(false);
    }
  }

  if (error && !reservation) {
    return (
      <main className="flex min-h-dvh items-center justify-center px-8 text-center text-[14px] font-semibold text-muted">
        {error}
      </main>
    );
  }
  if (!reservation || !catalogReady) {
    return <main className="flex min-h-dvh items-center justify-center text-[13px] text-muted">Carregando…</main>;
  }

  if (!order && reservation.status === "CONVERTED") {
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center px-8 text-center">
        <h1 className="text-[20px] font-extrabold">Este checkout já foi concluído</h1>
        <p className="mt-2 text-[13px] font-medium text-muted">
          Procure o link do pedido no seu e-mail, ou veja em Minhas compras.
        </p>
        <Link
          href="/minhas-compras"
          className="mt-6 flex h-14 w-full max-w-[360px] items-center justify-center rounded-2xl bg-primary text-[15px] font-extrabold text-white shadow-cta"
        >
          Minhas compras
        </Link>
      </main>
    );
  }

  // tempo esgotado
  if (expired) {
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center px-8 text-center">
        <div className="flex h-20 w-20 items-center justify-center rounded-full bg-warning/10 text-warning">
          <Icon d={paths.clock} size={36} />
        </div>
        <h1 className="mt-4 text-[20px] font-extrabold">Tempo de reserva esgotado</h1>
        <p className="mt-2 text-[13px] font-medium text-muted">
          Os ingressos voltaram para o estoque. Escolha novamente para garantir o seu.
        </p>
        <Link
          href={slug ? `/evento/${slug}/ingressos` : "/"}
          className="mt-6 flex h-14 w-full max-w-[360px] items-center justify-center rounded-2xl bg-primary text-[15px] font-extrabold text-white shadow-cta"
        >
          Escolher ingressos novamente
        </Link>
      </main>
    );
  }

  // aprovado (overlay)
  if (approved) {
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center bg-gradient-to-b from-emerald-50 to-bg px-8 text-center">
        <div className="flex h-[92px] w-[92px] animate-pop items-center justify-center rounded-full bg-success text-white">
          <Icon d={paths.check} size={44} stroke={2.5} />
        </div>
        <h1 className="mt-5 text-[22px] font-extrabold">Pagamento aprovado!</h1>
        <p className="mt-1 text-[13px] font-medium text-muted">Levando você para seus ingressos…</p>
      </main>
    );
  }

  const payDisabled = !consent || creating || paying;

  return (
    <main className="pb-10 lg:pb-16">
      <header className="sticky top-0 z-10 border-b border-line bg-bg/85 backdrop-blur">
        <div className="mx-auto max-w-[1160px] px-5 lg:px-7">
          <div className="flex items-center justify-between gap-3 py-3">
            <div className="flex items-center gap-3">
              <button
                onClick={() => {
                  if (step === "ident") router.back();
                  else if (step === "participantes") setStep("ident");
                  else setStep(hasNominal ? "participantes" : "ident");
                }}
                aria-label="Voltar"
                className="flex h-10 w-10 items-center justify-center rounded-full border border-line bg-surface"
              >
                <Icon d={paths.back} />
              </button>
              <h1 className="hidden text-[22px] font-extrabold lg:block">Checkout</h1>
            </div>
            {timerVisible && (
              <span className="flex items-center gap-1.5 rounded-full bg-warning/10 px-3 py-1.5 text-[12px] font-bold text-warning">
                <Icon d={paths.clock} size={14} />
                {order ? "Pague em" : "Reservado por"} {timerLabel}
              </span>
            )}
          </div>
          <ProgressBar step={step} stages={stages} />
          <div className="h-3" />
        </div>
      </header>

      <div className="mx-auto max-w-[1160px] px-5 pt-5 lg:px-7 lg:pt-7">
        {event && (
          <button
            type="button"
            onClick={() => setSummaryOpen((v) => !v)}
            className="mb-4 w-full rounded-[18px] border border-line bg-surface p-4 text-left lg:hidden"
          >
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-[14px] font-extrabold">{event.title}</p>
                <p className="mt-0.5 truncate text-[12px] font-medium text-muted-2">
                  {formatDateTime(event.startsAt, event.timezone)}
                  {event.venue ? ` · ${event.venue.name}` : ""}
                </p>
              </div>
              <div className="shrink-0 text-right">
                <p className="text-[11px] font-semibold text-muted-2">
                  {lines.reduce((s, l) => s + l.quantity, 0)} ingresso
                  {lines.reduce((s, l) => s + l.quantity, 0) === 1 ? "" : "s"}
                </p>
                <p className="text-[16px] font-extrabold">{formatCents(totalCents)}</p>
              </div>
            </div>
            {summaryOpen && (
              <div className="mt-3 space-y-1.5 border-t border-dashed border-line pt-3">
                {lines.map((line) => (
                  <div key={line.key} className="flex justify-between gap-3 text-[12.5px] font-semibold text-ink-soft">
                    <span>{line.quantity}× {line.label}</span>
                    <span className="shrink-0">{formatCents(line.priceTotalCents)}</span>
                  </div>
                ))}
                <div className="flex justify-between gap-3 text-[12.5px] font-medium text-muted-2">
                  <span>Taxa de serviço</span>
                  <span className="shrink-0">
                    {feeTotalCents > 0 ? formatCents(feeTotalCents) : "por conta do produtor"}
                  </span>
                </div>
                {discountCents > 0 && (
                  <div className="flex justify-between gap-3 text-[12.5px] font-bold text-success">
                    <span>Desconto</span>
                    <span className="shrink-0">− {formatCents(discountCents)}</span>
                  </div>
                )}
              </div>
            )}
            <p className="mt-2 text-center text-[11px] font-semibold text-primary">
              {summaryOpen ? "Esconder detalhes" : "Ver detalhes do pedido"}
            </p>
          </button>
        )}
        <div className="lg:flex lg:items-start lg:gap-6">
          <div className="lg:flex-[1.5]">
            {/* ETAPA 1 — identificação */}
            {step === "ident" && (event?.addOns.length ?? 0) > 0 && (
              <section className={`${cardClass} mb-4`}>
                <h2 className="text-[15px] font-extrabold">Quer adicionar algo?</h2>
                <div className="mt-3 space-y-2.5">
                  {event!.addOns.map((addOn) => {
                    const qty = addOnQty[addOn.id] ?? 0;
                    return (
                      <div key={addOn.id} className="flex items-center justify-between gap-3 rounded-2xl border-[1.5px] border-line bg-surface p-3.5">
                        <div>
                          <p className="text-[13px] font-extrabold">{addOn.name}</p>
                          <p className="text-[12px] font-semibold text-muted">{formatCents(addOn.priceCents)}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => setAddOnQty((prev) => ({ ...prev, [addOn.id]: Math.max(0, qty - 1) }))}
                            disabled={qty === 0}
                            aria-label="Remover"
                            className="flex h-9 w-9 items-center justify-center rounded-xl border-[1.5px] border-line-input text-lg font-bold disabled:opacity-40"
                          >
                            −
                          </button>
                          <span className="w-5 text-center text-[15px] font-extrabold">{qty}</span>
                          <button
                            onClick={() => setAddOnQty((prev) => ({ ...prev, [addOn.id]: Math.min(20, qty + 1) }))}
                            aria-label="Adicionar"
                            className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-lg font-bold text-white shadow-cta"
                          >
                            +
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            )}

            {step === "ident" && (
              <section className={cardClass}>
                <h2 className="text-[22px] font-extrabold lg:text-[18px]">Quase lá! Como quer continuar?</h2>
                <p className="mt-1 text-[13px] font-medium text-muted">
                  Sem senha, sem baixar app. Você recebe os ingressos por e-mail e WhatsApp.
                </p>

                <div className="mt-5 flex rounded-2xl bg-line p-1">
                  {(["guest", "otp"] as const).map((m) => (
                    <button
                      key={m}
                      onClick={() => setMode(m)}
                      className={`flex-1 rounded-xl py-2.5 text-[13px] font-bold ${
                        mode === m ? "bg-surface text-ink shadow-sm" : "text-muted"
                      }`}
                    >
                      {m === "guest" ? "Como convidado" : "Entrar com código"}
                    </button>
                  ))}
                </div>

                <div className="mt-5 space-y-4">
                  <div>
                    <label className={labelClass}>Nome completo</label>
                    <input
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="Como no seu documento"
                      className={inputClass}
                    />
                  </div>
                  <div>
                    <label className={labelClass}>E-mail</label>
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="voce@email.com"
                      className={inputClass}
                    />
                  </div>

                  <div>
                    <label className={labelClass}>CPF</label>
                    <input
                      inputMode="numeric"
                      value={buyerCpf}
                      onChange={(e) => setBuyerCpf(maskCpf(e.target.value))}
                      placeholder="000.000.000-00"
                      className={inputClass}
                    />
                    <p className="mt-1 text-[11.5px] font-semibold text-muted-2">
                      Exigido pelo banco para emitir o Pix e a nota do pagamento.
                    </p>
                  </div>

                  {mode === "guest" ? (
                    <div>
                      <label className={labelClass}>Celular / WhatsApp</label>
                      <input
                        value={phone}
                        onChange={(e) => setPhone(e.target.value)}
                        placeholder="(11) 99999-8888"
                        className={inputClass}
                      />
                    </div>
                  ) : otpSent ? (
                    <div>
                      <label className={labelClass}>Código enviado para {email}</label>
                      <input
                        inputMode="numeric"
                        maxLength={6}
                        value={otpCode}
                        onChange={(e) => setOtpCode(onlyDigits(e.target.value))}
                        placeholder="••••••"
                        className="mt-1 h-[60px] w-full rounded-2xl border-[1.5px] border-line-input bg-surface px-4 text-center text-[24px] font-extrabold tracking-[12px] outline-none focus:border-primary"
                      />
                      <div className="mt-2 flex items-center justify-between text-[12px] font-semibold">
                        {otpResendIn > 0 ? (
                          <span className="text-muted">
                            Reenviar código em 0:{String(otpResendIn).padStart(2, "0")}
                          </span>
                        ) : (
                          <button onClick={sendOtp} className="text-primary">
                            Não recebi o código
                          </button>
                        )}
                        <button onClick={() => setMode("guest")} className="text-muted">
                          Continuar como convidado
                        </button>
                      </div>
                    </div>
                  ) : null}
                </div>

                {error && <p className="mt-3 text-[12px] font-semibold text-danger">{error}</p>}

                <button
                  onClick={() => {
                    if (name.trim().length < 2) {
                      setError("Informe seu nome completo");
                      return;
                    }
                    if (!email.includes("@")) {
                      setError("Informe um e-mail válido");
                      return;
                    }
                    if (onlyDigits(buyerCpf).length !== 11) {
                      setError("Informe um CPF válido — o banco exige para emitir o pagamento");
                      return;
                    }
                    setError(null);
                    if (mode === "guest") setStep(hasNominal ? "participantes" : "pagamento");
                    else if (!otpSent) sendOtp();
                    else confirmOtp();
                  }}
                  className="mt-5 h-14 w-full rounded-2xl bg-primary text-[15px] font-extrabold text-white shadow-cta"
                >
                  {mode === "otp" && otpSent ? "Entrar" : mode === "otp" ? "Enviar código" : "Continuar"}
                </button>

              </section>
            )}

            {/* ETAPA 2 — participantes (só com lote nominal) */}
            {step === "participantes" && (
              <section className={cardClass}>
                <h2 className="text-[22px] font-extrabold lg:text-[18px]">Participantes</h2>
                <p className="mt-1 text-[13px] font-medium text-muted">
                  Este evento pede o nome de quem vai usar cada ingresso nominal — confira na portaria.
                </p>

                <div className="mt-5 space-y-3">
                  {nominalSlots.map((slot, index) => {
                    const filled = attendees[slot.key] ?? { name: "", cpf: "" };
                    return (
                      <div key={slot.key} className="rounded-[18px] border border-line bg-surface p-4">
                        <div className="mb-3.5 flex items-center gap-2">
                          <span className="flex h-[22px] w-[22px] items-center justify-center rounded-[7px] bg-primary/10 text-[12px] font-extrabold text-primary">
                            {index + 1}
                          </span>
                          <span className="text-[13px] font-extrabold">Participante · {slot.label}</span>
                        </div>
                        <div className="flex flex-col gap-3 sm:flex-row">
                          <div className="sm:flex-[1.6]">
                            <label className={labelClass}>Nome no ingresso</label>
                            <input
                              value={filled.name}
                              onChange={(e) =>
                                setAttendees((prev) => ({
                                  ...prev,
                                  [slot.key]: { ...filled, name: e.target.value },
                                }))
                              }
                              placeholder="Nome completo"
                              className={inputClass}
                            />
                          </div>
                          {slot.requiresCpf && (
                            <div className="sm:flex-1">
                              <label className={labelClass}>CPF</label>
                              <input
                                inputMode="numeric"
                                value={filled.cpf}
                                onChange={(e) =>
                                  setAttendees((prev) => ({
                                    ...prev,
                                    [slot.key]: { ...filled, cpf: maskCpf(e.target.value) },
                                  }))
                                }
                                placeholder="000.000.000-00"
                                className={inputClass}
                              />
                            </div>
                          )}
                        </div>
                        {index === 0 && (
                          <button
                            onClick={() =>
                              setAttendees((prev) => ({
                                ...prev,
                                [slot.key]: { ...filled, name: name.trim() },
                              }))
                            }
                            className="mt-3 h-[34px] rounded-[9px] border border-dashed border-muted-4 px-3 text-[11.5px] font-bold text-primary"
                          >
                            Usar meus dados
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>

                <p className="mt-3 px-1 text-[11px] font-medium text-muted-2">
                  Um formulário por ingresso nominal ({nominalSlots.length} no total). Os demais ingressos
                  deste pedido não exigem nome — a titularidade pode ser transferida depois, em Meus ingressos.
                </p>

                {error && <p className="mt-3 text-[12px] font-semibold text-danger">{error}</p>}

                <button
                  onClick={() => {
                    const invalid = attendeesError();
                    if (invalid) {
                      setError(invalid);
                      return;
                    }
                    setError(null);
                    setStep("pagamento");
                  }}
                  className="mt-5 h-14 w-full rounded-2xl bg-primary text-[15px] font-extrabold text-white shadow-cta"
                >
                  Ir para pagamento
                </button>
              </section>
            )}

            {/* ETAPA 3 — pagamento */}
            {step === "pagamento" && (
              <section className={cardClass}>
                <div className="flex rounded-2xl bg-line p-1">
                  {([["pix", "Pix"], ["cartao", "Cartão"]] as const).map(
                    ([key, labelTab]) => (
                      <button
                        key={key}
                        onClick={() => setTab(key)}
                        className={`flex-1 rounded-xl py-2.5 text-[13px] font-bold ${
                          tab === key ? "bg-ink text-white" : "text-muted"
                        }`}
                      >
                        {labelTab}
                      </button>
                    ),
                  )}
                </div>

                {/* consentimento LGPD — bloqueia os botões de pagar */}
                <div
                  className={`mt-5 flex items-start gap-2.5 rounded-[13px] border-[1.5px] px-4 py-3.5 ${
                    consent ? "border-primary bg-primary/5" : "border-line-input bg-surface"
                  }`}
                >
                  <input
                    id="consent"
                    type="checkbox"
                    checked={consent}
                    onChange={(e) => setConsent(e.target.checked)}
                    className="mt-0.5 h-[18px] w-[18px] shrink-0 accent-primary"
                  />
                  <p className="text-[12px] font-medium leading-[1.55] text-ink-soft">
                    <label htmlFor="consent" className="cursor-pointer">
                      Li e aceito os{" "}
                    </label>
                    <Link href="/legal?aba=termos" target="_blank" className="font-bold text-primary">
                      Termos de Uso
                    </Link>
                    <label htmlFor="consent" className="cursor-pointer">
                      {" "}
                      e a{" "}
                    </label>
                    <Link href="/legal" target="_blank" className="font-bold text-primary">
                      Política de Privacidade ({CONSENT_VERSION})
                    </Link>
                    <label htmlFor="consent" className="cursor-pointer">
                      , e autorizo o tratamento dos meus dados para emissão e entrega dos ingressos (LGPD).{" "}
                      <b className="text-ink">Obrigatório para pagar.</b>
                    </label>
                  </p>
                </div>

                {error && <p className="mt-3 text-[12px] font-semibold text-danger">{error}</p>}

                {tab === "pix" && (
                  <div className="mt-5 text-center">
                    {!pixCode ? (
                      <div className="text-left">
                        <p className="text-[13px] font-medium leading-[1.6] text-muted">
                          Abra o app do seu banco, escaneie o QR code ou copie o código. A confirmação aparece
                          aqui em tempo real — sem sair desta página.
                        </p>
                        <button
                          onClick={payWithPix}
                          disabled={payDisabled}
                          className={`mt-4 h-14 w-full rounded-2xl text-[15px] font-extrabold text-white ${
                            payDisabled ? "cursor-not-allowed bg-[#ecd6e4]" : "bg-pix"
                          }`}
                        >
                          {creating || paying ? "Gerando Pix…" : `Pagar ${formatCents(totalCents)} com Pix`}
                        </button>
                        {!consent && (
                          <p className="mt-2 text-center text-[11px] font-semibold text-muted-2">
                            Marque o aceite dos Termos e da Política de Privacidade para liberar o pagamento.
                          </p>
                        )}
                      </div>
                    ) : (
                      <>
                        <span className="inline-flex items-center gap-2 rounded-full bg-warning/10 px-3 py-1.5 text-[12px] font-bold text-warning">
                          <span className="h-3 w-3 animate-spin rounded-full border-2 border-warning/30 border-t-warning" />
                          Aguardando pagamento
                        </span>
                        <div className="mx-auto mt-4 w-fit rounded-3xl border border-line bg-white p-5">
                          <QRCode value={pixCode} size={200} />
                        </div>
                        <button
                          onClick={() => {
                            navigator.clipboard.writeText(pixCode);
                            setCopied(true);
                            setTimeout(() => setCopied(false), 2000);
                          }}
                          className={`mt-4 inline-flex h-12 items-center gap-2 rounded-2xl border-[1.5px] px-6 text-[14px] font-bold ${
                            copied ? "border-success text-success" : "border-pix text-pix-text"
                          }`}
                        >
                          <Icon d={copied ? paths.check : paths.copy} size={16} />
                          {copied ? "Código copiado!" : "Copiar código Pix"}
                        </button>
                        <p className="mt-4 text-[13px] font-semibold text-muted">Total</p>
                        <p className="text-[26px] font-extrabold">{formatCents(totalCents)}</p>
                        {discountCents > 0 && (
                          <p className="text-[12px] font-bold text-success">
                            desconto aplicado: −{formatCents(discountCents)}
                          </p>
                        )}
                        <button
                          onClick={checkPaymentNow}
                          disabled={pixChecking}
                          className="mx-auto mt-3 flex h-12 items-center justify-center rounded-2xl bg-pix px-8 text-[14px] font-extrabold text-white disabled:opacity-70"
                        >
                          {pixChecking ? "Verificando pagamento…" : "Já fiz o pagamento"}
                        </button>
                        {pixNotice && (
                          <p className="mx-auto mt-2 max-w-[320px] text-[12px] font-semibold text-warning">
                            {pixNotice}
                          </p>
                        )}
                        <p className="mx-auto mt-3 max-w-[280px] text-[12px] font-medium text-muted">
                          Assim que o pagamento cair, esta página avança sozinha — não feche o app.
                        </p>
                        {SHOW_TEST_HINTS && (
                          <p className="mx-auto mt-2 max-w-[300px] rounded-xl bg-warning/10 px-3 py-2 text-[11px] font-bold text-warning">
                            Ambiente de TESTE: o banco é simulado e aprova o Pix sozinho em ~20s. Em produção,
                            só aprova com pagamento real.
                          </p>
                        )}
                      </>
                    )}
                  </div>
                )}

                {tab === "cartao" && (
                  <div className="mt-5 space-y-4">
                    {cardError && (
                      <div className="rounded-2xl border border-danger/30 bg-danger/5 p-3.5 text-[13px] font-bold text-danger">
                        Pagamento recusado — {cardError}. Sua reserva continua valendo.
                      </div>
                    )}
                    <div>
                      <label className={labelClass}>Nome impresso no cartão</label>
                      <input
                        value={cardHolder}
                        onChange={(e) => setCardHolder(e.target.value)}
                        placeholder="Como está no cartão"
                        className={inputClass}
                      />
                    </div>
                    <div>
                      <label className={labelClass}>Número do cartão</label>
                      <input
                        inputMode="numeric"
                        value={cardNumber}
                        onChange={(e) => setCardNumber(e.target.value.replace(/[^\d ]/g, ""))}
                        placeholder="0000 0000 0000 0000"
                        className={inputClass}
                      />
                    </div>
                    <div className="flex gap-3">
                      <div className="flex-1">
                        <label className={labelClass}>Validade</label>
                        <input
                          value={cardExp}
                          onChange={(e) => setCardExp(e.target.value)}
                          placeholder="MM/AA"
                          className={inputClass}
                        />
                      </div>
                      <div className="flex-1">
                        <label className={labelClass}>CVV</label>
                        <input
                          inputMode="numeric"
                          maxLength={4}
                          value={cardCvv}
                          onChange={(e) => setCardCvv(onlyDigits(e.target.value))}
                          placeholder="123"
                          className={inputClass}
                        />
                      </div>
                    </div>
                    <div className="flex gap-3">
                      <div className="flex-1">
                        <label className={labelClass}>CPF do titular</label>
                        <input
                          inputMode="numeric"
                          value={cardCpf}
                          onChange={(e) => setCardCpf(e.target.value)}
                          placeholder="000.000.000-00"
                          className={inputClass}
                        />
                      </div>
                    </div>
                    <div className="flex gap-3">
                      <div className="flex-1">
                        <label className={labelClass}>CEP da fatura</label>
                        <input
                          inputMode="numeric"
                          value={cardCep}
                          onChange={(e) => setCardCep(e.target.value)}
                          placeholder="00000-000"
                          className={inputClass}
                        />
                      </div>
                      <div className="w-28">
                        <label className={labelClass}>Número</label>
                        <input
                          value={cardAddrNum}
                          onChange={(e) => setCardAddrNum(e.target.value)}
                          placeholder="123"
                          className={inputClass}
                        />
                      </div>
                    </div>
                    <div>
                      <label className={labelClass}>Parcelamento</label>
                      <select
                        value={installments}
                        onChange={(e) => setInstallments(Number(e.target.value))}
                        className={inputClass}
                      >
                        {[1, 2, 3].map((n) => (
                          <option key={n} value={n}>
                            {n}x de {formatCents(Math.round(totalCents / n))} sem juros
                          </option>
                        ))}
                      </select>
                    </div>
                    <button
                      onClick={payCard}
                      disabled={
                        payDisabled ||
                        onlyDigits(cardNumber).length < 13 ||
                        !cardExp ||
                        cardCvv.length < 3 ||
                        cardHolder.trim().length < 2 ||
                        onlyDigits(cardCpf).length < 11 ||
                        onlyDigits(cardCep).length < 8
                      }
                      className={ctaClass(
                        payDisabled ||
                          onlyDigits(cardNumber).length < 13 ||
                          !cardExp ||
                          cardCvv.length < 3 ||
                          cardHolder.trim().length < 2 ||
                          onlyDigits(cardCpf).length < 11 ||
                          onlyDigits(cardCep).length < 8,
                      )}
                    >
                      {creating || paying ? "Processando…" : `Pagar ${formatCents(totalCents)}`}
                    </button>
                    {!consent && (
                      <p className="text-center text-[11px] font-semibold text-muted-2">
                        Marque o aceite dos Termos e da Política de Privacidade para liberar o pagamento.
                      </p>
                    )}
                    {SHOW_TEST_HINTS && (
                      <p className="text-center text-[11px] font-medium text-muted">
                        Dica de teste: cartão terminado em 0000 simula recusa.
                      </p>
                    )}
                  </div>
                )}

              </section>
            )}
          </div>

          {/* Resumo do pedido — sticky no desktop */}
          <aside className="mt-6 lg:sticky lg:top-[92px] lg:mt-0 lg:flex-1">
            <div className="rounded-[20px] border border-line bg-surface p-5">
              <p className="text-[15px] font-extrabold">Resumo do pedido</p>
              {event && (
                <>
                  <p className="mt-3 text-[14px] font-extrabold leading-tight">{event.title}</p>
                  <p className="mt-1 text-[12px] font-medium text-muted-2">
                    {formatDateTime(event.startsAt, event.timezone)}
                    {event.venue ? ` · ${event.venue.name}` : ""}
                  </p>
                </>
              )}

              <div className="mt-4 space-y-2 border-t border-dashed border-line pt-3">
                {lines.map((line) => (
                  <div
                    key={line.key}
                    className="flex justify-between gap-3 text-[13px] font-semibold text-ink-soft"
                  >
                    <span>
                      {line.quantity}× {line.label}
                    </span>
                    <span className="shrink-0">{formatCents(line.priceTotalCents)}</span>
                  </div>
                ))}
                {(event?.addOns ?? [])
                  .filter((addOn) => (addOnQty[addOn.id] ?? 0) > 0)
                  .map((addOn) => (
                    <div key={addOn.id} className="flex justify-between gap-3 text-[13px] font-semibold text-ink-soft">
                      <span>
                        {addOnQty[addOn.id]}× {addOn.name}
                      </span>
                      <span className="shrink-0">{formatCents(addOn.priceCents * addOnQty[addOn.id])}</span>
                    </div>
                  ))}
                <div className="flex justify-between gap-3 text-[13px] font-medium text-muted-2">
                  <span>Taxa de serviço</span>
                  <span className="shrink-0">
                    {feeTotalCents > 0 ? formatCents(feeTotalCents) : "por conta do produtor"}
                  </span>
                </div>
                {discountCents > 0 && (
                  <div className="flex justify-between gap-3 text-[13px] font-bold text-success">
                    <span>Desconto{validCoupon ? ` ${validCoupon.code}` : ""}</span>
                    <span className="shrink-0">− {formatCents(discountCents)}</span>
                  </div>
                )}
                <div className="flex justify-between gap-3 border-t border-line pt-3 text-[17px] font-extrabold">
                  <span>Total</span>
                  <span className="shrink-0">{formatCents(totalCents)}</span>
                </div>
              </div>

              {!order && slug && (
                <div className="mt-4">
                  <label className={labelClass}>Cupom de desconto</label>
                  <div className="mt-1 flex gap-2">
                    <input
                      value={coupon}
                      onChange={(e) => {
                        setCoupon(e.target.value.toUpperCase());
                        setCouponPreview(null);
                        setCouponInfo(null);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          applyCouponPreview();
                        }
                      }}
                      placeholder="EX.: ATLETICA10"
                      className="h-[44px] w-full rounded-xl border-[1.5px] border-dashed border-line-input bg-surface px-3.5 text-[13px] font-bold uppercase outline-none focus:border-primary"
                    />
                    <button
                      onClick={applyCouponPreview}
                      className="h-[44px] shrink-0 rounded-xl bg-[#fbe9f3] px-4 text-[13px] font-bold text-primary"
                    >
                      Aplicar
                    </button>
                  </div>
                  {couponInfo && (
                    <p
                      className={`mt-1.5 text-[12px] font-bold ${
                        couponInfo.startsWith("✗") ? "text-danger" : "text-success"
                      }`}
                    >
                      {couponInfo}
                    </p>
                  )}
                  {!couponInfo && coupon.trim().length > 0 && (
                    <p className="mt-1.5 text-[12px] font-semibold text-muted-2">
                      Clique em Aplicar para validar o cupom.
                    </p>
                  )}
                </div>
              )}

              <p className="mt-4 text-[11px] font-medium leading-[1.5] text-muted-2">
                Taxa exibida de forma transparente. Sem custos escondidos.
              </p>
            </div>
          </aside>
        </div>
      </div>
    </main>
  );
}
