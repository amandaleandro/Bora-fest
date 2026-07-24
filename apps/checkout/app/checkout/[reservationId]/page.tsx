"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import QRCode from "react-qr-code";
import { api, ApiError, type Order, type Reservation } from "../../../lib/api";
import { formatCents } from "../../../lib/format";
import { Icon, paths } from "../../../components/icons";

type Step = "ident" | "dados" | "pagamento";
type PayTab = "pix" | "cartao" | "carteira";

function useCountdown(target: string | null) {
  const [left, setLeft] = useState<number>(() =>
    target ? Math.max(0, new Date(target).getTime() - Date.now()) : 0,
  );
  useEffect(() => {
    if (!target) return;
    const id = setInterval(
      () => setLeft(Math.max(0, new Date(target).getTime() - Date.now())),
      1000,
    );
    return () => clearInterval(id);
  }, [target]);
  const mm = String(Math.floor(left / 60000)).padStart(2, "0");
  const ss = String(Math.floor((left % 60000) / 1000)).padStart(2, "0");
  return { left, label: `${mm}:${ss}` };
}

function ProgressBar({ step }: { step: Step }) {
  const stages: Array<{ key: Step; label: string }> = [
    { key: "ident", label: "Identificação" },
    { key: "dados", label: "Dados" },
    { key: "pagamento", label: "Pagamento" },
  ];
  const idx = stages.findIndex((s) => s.key === step);
  return (
    <div className="flex items-center gap-2 px-5 pt-4">
      {stages.map((s, i) => (
        <div key={s.key} className="flex-1">
          <div className={`h-1.5 rounded-full ${i <= idx ? "bg-primary" : "bg-line"}`} />
          <p className={`mt-1 text-[10px] font-bold ${i <= idx ? "text-primary" : "text-muted-3"}`}>
            {i < idx ? "✓ " : ""}{s.label}
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
  const [order, setOrder] = useState<Order | null>(null);
  const [step, setStep] = useState<Step>("ident");
  const [error, setError] = useState<string | null>(null);

  // identificação
  const [mode, setMode] = useState<"guest" | "otp">("guest");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [otpCode, setOtpCode] = useState("");
  const [otpResendIn, setOtpResendIn] = useState(0);

  // dados
  const [name, setName] = useState("");
  const [coupon, setCoupon] = useState("");
  const [couponInfo, setCouponInfo] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  // pagamento
  const [tab, setTab] = useState<PayTab>("pix");
  const [pixCode, setPixCode] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [approved, setApproved] = useState(false);
  const [cardNumber, setCardNumber] = useState("");
  const [cardExp, setCardExp] = useState("");
  const [cardCvv, setCardCvv] = useState("");
  const [installments, setInstallments] = useState(1);
  const [cardError, setCardError] = useState<string | null>(null);
  const [paying, setPaying] = useState(false);

  const slug = typeof window !== "undefined" ? sessionStorage.getItem(`bf.slug.${reservationId}`) : null;
  const deadline = order?.status === "PAYMENT_PENDING" ? null : reservation?.expiresAt ?? null;
  const { left, label } = useCountdown(order ? null : reservation?.expiresAt ?? null);
  const expired = !order && reservation !== null && left <= 0;

  useEffect(() => {
    api.getReservation(reservationId).then(setReservation).catch(() => setError("Reserva não encontrada"));
  }, [reservationId]);

  useEffect(() => {
    if (otpResendIn <= 0) return;
    const id = setInterval(() => setOtpResendIn((v) => v - 1), 1000);
    return () => clearInterval(id);
  }, [otpResendIn]);

  const totalCents = (reservation?.items ?? []).reduce(
    (sum, item) => sum + (item.priceCents + item.feeCents) * item.quantity,
    0,
  );

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
      setStep("dados");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Código inválido");
    }
  }

  async function applyCouponPreview() {
    if (!coupon || !slug) return;
    setCouponInfo(null);
    try {
      const info = await api.checkCoupon(slug, coupon);
      setCouponInfo(
        info.discountType === "PERCENT"
          ? `Cupom ${info.code}: −${info.discountValue}%`
          : `Cupom ${info.code}: −${formatCents(info.discountValue)}`,
      );
    } catch (e) {
      setCouponInfo(e instanceof ApiError ? `✗ ${e.message}` : "✗ Cupom inválido");
    }
  }

  async function createOrder() {
    setCreating(true);
    setError(null);
    try {
      const created = await api.createOrder({
        reservationId,
        contactEmail: email,
        contactName: name || undefined,
        contactPhone: phone || undefined,
        couponCode: coupon || undefined,
      });
      setOrder(created);
      setStep("pagamento");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Não foi possível criar o pedido");
    } finally {
      setCreating(false);
    }
  }

  const startPix = useCallback(async (o: Order) => {
    try {
      const pix = await api.createPixPayment(o.id, {});
      setPixCode(pix.pixQrCodeText);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Falha ao gerar o Pix");
    }
  }, []);

  useEffect(() => {
    if (step === "pagamento" && order && tab === "pix" && !pixCode) startPix(order);
  }, [step, order, tab, pixCode, startPix]);

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
    if (!order) return;
    setPaying(true);
    setCardError(null);
    const digits = cardNumber.replace(/\D/g, "");
    try {
      // produção: tokenizecard.js do Pagar.me gera o token no navegador;
      // o mock aprova qualquer token que não termine em _fail
      const token = digits.endsWith("0000") ? "tok_mock_fail" : `tok_${digits.slice(-4)}`;
      const res = await api.createCardPayment(order.id, { cardToken: token, installments });
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
    return <main className="flex min-h-dvh items-center justify-center px-8 text-center text-[14px] font-semibold text-muted">{error}</main>;
  }
  if (!reservation) {
    return <main className="flex min-h-dvh items-center justify-center text-[13px] text-muted">Carregando…</main>;
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
          className="mt-6 flex h-14 w-full items-center justify-center rounded-2xl bg-primary text-[15px] font-extrabold text-white shadow-cta"
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

  return (
    <main className="pb-10">
      <header className="sticky top-0 z-10 border-b border-line bg-bg/85 backdrop-blur">
        <div className="flex items-center justify-between px-5 py-3">
          <button onClick={() => (step === "ident" ? router.back() : setStep(step === "pagamento" ? "dados" : "ident"))} aria-label="Voltar" className="flex h-10 w-10 items-center justify-center rounded-full border border-line bg-surface">
            <Icon d={paths.back} />
          </button>
          {!order && (
            <span className="flex items-center gap-1.5 rounded-full bg-warning/10 px-3 py-1.5 text-[12px] font-bold text-warning">
              <Icon d={paths.clock} size={14} /> {label}
            </span>
          )}
        </div>
        <ProgressBar step={step} />
        <div className="h-3" />
      </header>

      {/* ETAPA 1 — identificação */}
      {step === "ident" && (
        <section className="px-5 pt-5">
          <h1 className="text-[22px] font-extrabold">Quase lá! Como quer continuar?</h1>
          <p className="mt-1 text-[13px] font-medium text-muted">
            Sem senha, sem baixar app. Você recebe os ingressos por e-mail e WhatsApp.
          </p>

          <div className="mt-5 flex rounded-2xl bg-line p-1">
            {(["guest", "otp"] as const).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`flex-1 rounded-xl py-2.5 text-[13px] font-bold ${mode === m ? "bg-surface text-ink shadow-sm" : "text-muted"}`}
              >
                {m === "guest" ? "Como convidado" : "Entrar com código"}
              </button>
            ))}
          </div>

          <div className="mt-5 space-y-4">
            <div>
              <label className="text-[12px] font-bold text-ink-soft">E-mail</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="voce@email.com"
                className="mt-1 h-[50px] w-full rounded-2xl border-[1.5px] border-line-input bg-surface px-4 text-[14px] font-medium outline-none focus:border-primary"
              />
            </div>

            {mode === "guest" ? (
              <div>
                <label className="text-[12px] font-bold text-ink-soft">Celular / WhatsApp</label>
                <input
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="(11) 99999-8888"
                  className="mt-1 h-[50px] w-full rounded-2xl border-[1.5px] border-line-input bg-surface px-4 text-[14px] font-medium outline-none focus:border-primary"
                />
              </div>
            ) : otpSent ? (
              <div>
                <label className="text-[12px] font-bold text-ink-soft">Código enviado para {email}</label>
                <input
                  inputMode="numeric"
                  maxLength={6}
                  value={otpCode}
                  onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, ""))}
                  placeholder="••••••"
                  className="mt-1 h-[60px] w-full rounded-2xl border-[1.5px] border-line-input bg-surface px-4 text-center text-[24px] font-extrabold tracking-[12px] outline-none focus:border-primary"
                />
                <div className="mt-2 flex items-center justify-between text-[12px] font-semibold">
                  {otpResendIn > 0 ? (
                    <span className="text-muted">Reenviar código em 0:{String(otpResendIn).padStart(2, "0")}</span>
                  ) : (
                    <button onClick={sendOtp} className="text-primary">Não recebi o código</button>
                  )}
                  <button onClick={() => setMode("guest")} className="text-muted">Continuar como convidado</button>
                </div>
              </div>
            ) : null}
          </div>

          {error && <p className="mt-3 text-[12px] font-semibold text-danger">{error}</p>}

          <button
            onClick={() => {
              if (!email.includes("@")) { setError("Informe um e-mail válido"); return; }
              if (mode === "guest") { setStep("dados"); setError(null); }
              else if (!otpSent) sendOtp();
              else confirmOtp();
            }}
            className="mt-5 h-14 w-full rounded-2xl bg-primary text-[15px] font-extrabold text-white shadow-cta"
          >
            {mode === "otp" && otpSent ? "Entrar" : mode === "otp" ? "Enviar código" : "Continuar"}
          </button>

          <p className="mt-3 text-center text-[11px] font-medium text-muted">
            Ao continuar, você concorda com os <Link href="/legal" className="font-bold text-primary">Termos de Uso</Link> e a{" "}
            <Link href="/legal" className="font-bold text-primary">Política de Privacidade</Link>
          </p>

          <div className="mt-5 space-y-2">
            <button disabled className="h-12 w-full rounded-2xl border-[1.5px] border-line-input text-[13px] font-bold text-muted-3">
              Continuar com Google · em breve
            </button>
            <button disabled className="h-12 w-full rounded-2xl border-[1.5px] border-line-input text-[13px] font-bold text-muted-3">
              Continuar com Apple · em breve
            </button>
          </div>
        </section>
      )}

      {/* ETAPA 2 — dados */}
      {step === "dados" && (
        <section className="px-5 pt-5">
          <h1 className="text-[22px] font-extrabold">Seus dados</h1>
          <div className="mt-5 space-y-4">
            <div>
              <label className="text-[12px] font-bold text-ink-soft">Nome completo</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Como no seu documento"
                className="mt-1 h-[50px] w-full rounded-2xl border-[1.5px] border-line-input bg-surface px-4 text-[14px] font-medium outline-none focus:border-primary"
              />
            </div>
            <div>
              <label className="text-[12px] font-bold text-ink-soft">E-mail</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="mt-1 h-[50px] w-full rounded-2xl border-[1.5px] border-line-input bg-surface px-4 text-[14px] font-medium outline-none focus:border-primary"
              />
            </div>
            <div>
              <label className="text-[12px] font-bold text-ink-soft">Celular / WhatsApp (opcional)</label>
              <input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="(11) 99999-8888"
                className="mt-1 h-[50px] w-full rounded-2xl border-[1.5px] border-line-input bg-surface px-4 text-[14px] font-medium outline-none focus:border-primary"
              />
            </div>

            {/* cupom */}
            <div>
              <label className="text-[12px] font-bold text-ink-soft">Cupom de desconto</label>
              <div className="mt-1 flex gap-2">
                <input
                  value={coupon}
                  onChange={(e) => setCoupon(e.target.value.toUpperCase())}
                  placeholder="EX.: ATLETICA10"
                  className="h-[50px] w-full rounded-2xl border-[1.5px] border-dashed border-line-input bg-surface px-4 text-[14px] font-bold uppercase outline-none focus:border-primary"
                />
                <button onClick={applyCouponPreview} className="shrink-0 rounded-2xl border-[1.5px] border-primary px-4 text-[13px] font-bold text-primary">
                  Aplicar
                </button>
              </div>
              {couponInfo && (
                <p className={`mt-1 text-[12px] font-bold ${couponInfo.startsWith("✗") ? "text-danger" : "text-success"}`}>{couponInfo}</p>
              )}
            </div>
          </div>

          <div className="mt-5 rounded-2xl border border-line bg-surface p-4">
            <p className="flex items-center justify-between text-[13px] font-semibold text-muted">
              <span>Total (inclui taxas)</span>
              <span className="text-[18px] font-extrabold text-ink">{formatCents(totalCents)}</span>
            </p>
          </div>

          {error && <p className="mt-3 text-[12px] font-semibold text-danger">{error}</p>}

          <button
            onClick={createOrder}
            disabled={creating || !email.includes("@")}
            className={`mt-5 h-14 w-full rounded-2xl text-[15px] font-extrabold text-white ${creating ? "bg-[#d9d2e8]" : "bg-primary shadow-cta"}`}
          >
            {creating ? "Criando pedido…" : "Ir para pagamento"}
          </button>
        </section>
      )}

      {/* ETAPA 3 — pagamento */}
      {step === "pagamento" && order && (
        <section className="px-5 pt-5">
          <div className="flex rounded-2xl bg-line p-1">
            {([["pix", "Pix"], ["cartao", "Cartão"], ["carteira", "Carteira"]] as const).map(([key, labelTab]) => (
              <button
                key={key}
                onClick={() => setTab(key)}
                className={`flex-1 rounded-xl py-2.5 text-[13px] font-bold ${tab === key ? "bg-ink text-white" : "text-muted"}`}
              >
                {labelTab}
              </button>
            ))}
          </div>

          {tab === "pix" && (
            <div className="mt-5 text-center">
              <span className="inline-flex items-center gap-2 rounded-full bg-warning/10 px-3 py-1.5 text-[12px] font-bold text-warning">
                <span className="h-3 w-3 animate-spin rounded-full border-2 border-warning/30 border-t-warning" />
                Aguardando pagamento
              </span>
              <div className="mx-auto mt-4 w-fit rounded-3xl border border-line bg-white p-5">
                {pixCode ? <QRCode value={pixCode} size={200} /> : <div className="h-[200px] w-[200px] animate-pulse rounded-xl bg-line" />}
              </div>
              <button
                onClick={() => {
                  if (!pixCode) return;
                  navigator.clipboard.writeText(pixCode);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                }}
                className={`mt-4 inline-flex h-12 items-center gap-2 rounded-2xl border-[1.5px] px-6 text-[14px] font-bold ${copied ? "border-success text-success" : "border-pix text-pix-text"}`}
              >
                <Icon d={copied ? paths.check : paths.copy} size={16} />
                {copied ? "Código copiado!" : "Copiar código Pix"}
              </button>
              <p className="mt-4 text-[13px] font-semibold text-muted">Total</p>
              <p className="text-[26px] font-extrabold">{formatCents(order.totalCents)}</p>
              {(order.discountCents ?? 0) > 0 && (
                <p className="text-[12px] font-bold text-success">desconto aplicado: −{formatCents(order.discountCents!)}</p>
              )}
              <p className="mx-auto mt-3 max-w-[280px] text-[12px] font-medium text-muted">
                Assim que o pagamento cair, esta página avança sozinha — não feche o app.
              </p>
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
                <label className="text-[12px] font-bold text-ink-soft">Número do cartão</label>
                <input
                  inputMode="numeric"
                  value={cardNumber}
                  onChange={(e) => setCardNumber(e.target.value.replace(/[^\d ]/g, ""))}
                  placeholder="0000 0000 0000 0000"
                  className="mt-1 h-[50px] w-full rounded-2xl border-[1.5px] border-line-input bg-surface px-4 text-[14px] font-medium outline-none focus:border-primary"
                />
              </div>
              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="text-[12px] font-bold text-ink-soft">Validade</label>
                  <input
                    value={cardExp}
                    onChange={(e) => setCardExp(e.target.value)}
                    placeholder="MM/AA"
                    className="mt-1 h-[50px] w-full rounded-2xl border-[1.5px] border-line-input bg-surface px-4 text-[14px] font-medium outline-none focus:border-primary"
                  />
                </div>
                <div className="flex-1">
                  <label className="text-[12px] font-bold text-ink-soft">CVV</label>
                  <input
                    inputMode="numeric"
                    maxLength={4}
                    value={cardCvv}
                    onChange={(e) => setCardCvv(e.target.value.replace(/\D/g, ""))}
                    placeholder="123"
                    className="mt-1 h-[50px] w-full rounded-2xl border-[1.5px] border-line-input bg-surface px-4 text-[14px] font-medium outline-none focus:border-primary"
                  />
                </div>
              </div>
              <div>
                <label className="text-[12px] font-bold text-ink-soft">Parcelamento</label>
                <select
                  value={installments}
                  onChange={(e) => setInstallments(Number(e.target.value))}
                  className="mt-1 h-[50px] w-full rounded-2xl border-[1.5px] border-line-input bg-surface px-4 text-[14px] font-medium outline-none focus:border-primary"
                >
                  {[1, 2, 3].map((n) => (
                    <option key={n} value={n}>
                      {n}x de {formatCents(Math.round(order.totalCents / n))} sem juros
                    </option>
                  ))}
                </select>
              </div>
              <button
                onClick={payCard}
                disabled={paying || cardNumber.replace(/\D/g, "").length < 13 || !cardExp || cardCvv.length < 3}
                className={`h-14 w-full rounded-2xl text-[15px] font-extrabold text-white ${paying ? "bg-[#d9d2e8]" : "bg-primary shadow-cta"}`}
              >
                {paying ? "Processando…" : `Pagar ${formatCents(order.totalCents)}`}
              </button>
              <p className="text-center text-[11px] font-medium text-muted">
                Dica de teste: cartão terminado em 0000 simula recusa.
              </p>
            </div>
          )}

          {tab === "carteira" && (
            <div className="mt-5 space-y-2.5">
              <button disabled className="h-14 w-full rounded-2xl bg-black text-[15px] font-bold text-white opacity-50"> Pay · em breve</button>
              <button disabled className="h-14 w-full rounded-2xl border-[1.5px] border-line-input bg-white text-[15px] font-bold text-ink opacity-50">Google Pay · em breve</button>
              <button disabled className="h-14 w-full rounded-2xl bg-[#009ee3] text-[15px] font-bold text-white opacity-50">Mercado Pago · em breve</button>
            </div>
          )}
        </section>
      )}
    </main>
  );
}
