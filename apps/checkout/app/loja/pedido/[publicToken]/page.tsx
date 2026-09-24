"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import QRCode from "react-qr-code";
import { storeApi, type StoreOrderPublic } from "../../../../lib/store-api";

function money(cents: number) {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export default function StoreOrderPage({ params }: { params: { publicToken: string } }) {
  const { publicToken } = params;
  const [order, setOrder] = useState<StoreOrderPublic | null>(null);
  const [cpf, setCpf] = useState("");
  const [phone, setPhone] = useState("");
  const [payTab, setPayTab] = useState<"PIX" | "CARD">("PIX");
  const [cardNumber, setCardNumber] = useState("");
  const [cardHolder, setCardHolder] = useState("");
  const [cardExp, setCardExp] = useState("");
  const [cardCvv, setCardCvv] = useState("");
  const [cardCpf, setCardCpf] = useState("");
  const [cardCep, setCardCep] = useState("");
  const [cardAddressNumber, setCardAddressNumber] = useState("");
  const [installments, setInstallments] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [now, setNow] = useState(Date.now());

  const load = useCallback(async () => {
    const fresh = await storeApi.getOrder(publicToken);
    setOrder(fresh);
  }, [publicToken]);

  useEffect(() => {
    load().catch(() => setError("Não foi possível carregar o pedido."));
  }, [load]);

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if (!order || !["CREATED", "PAYMENT_PENDING"].includes(order.status)) return;
    const id = window.setInterval(() => {
      if (document.visibilityState === "hidden") return;
      void storeApi
        .syncPayment(publicToken)
        .then(() => load())
        .catch(() => undefined);
    }, 3000);
    const visible = () => {
      if (document.visibilityState === "visible") {
        void storeApi.syncPayment(publicToken).then(() => load()).catch(() => undefined);
      }
    };
    document.addEventListener("visibilitychange", visible);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [order?.status, publicToken, load]);

  const payment = order?.payments?.find(
    (item) => item.method === "PIX" && item.status === "PENDING" && item.pixQrCodeText,
  );
  const remaining = order
    ? Math.max(0, Math.ceil((new Date(order.expiresAt).getTime() - now) / 1000))
    : 0;
  const timer = useMemo(
    () => `${String(Math.floor(remaining / 60)).padStart(2, "0")}:${String(remaining % 60).padStart(2, "0")}`,
    [remaining],
  );

  async function generatePix() {
    if (!order || busy) return;
    const digits = cpf.replace(/\D/g, "");
    if (digits.length !== 11 && digits.length !== 14) {
      setError("Informe CPF ou CNPJ do pagador para gerar o Pix.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await storeApi.createPix(publicToken, {
        payerDocument: digits,
        payerPhone: phone.replace(/\D/g, "") || undefined,
      });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível gerar o Pix.");
    } finally {
      setBusy(false);
    }
  }

  async function payCard() {
    if (!order || busy) return;
    const digits = cardNumber.replace(/\D/g, "");
    const [month, yearRaw] = cardExp.split("/").map((part) => part.trim());
    const year = yearRaw?.length === 2 ? "20" + yearRaw : yearRaw;
    if (digits.length < 13 || !cardHolder.trim() || !month || !year || cardCvv.length < 3) {
      setError("Confira os dados do cartão.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const storageKey = `bf.storeCardIdem.${publicToken}`;
      let idem = sessionStorage.getItem(storageKey);
      if (!idem) {
        idem = crypto.randomUUID();
        sessionStorage.setItem(storageKey, idem);
      }
      const result = await storeApi.createCard(publicToken, {
        card: {
          number: digits,
          holderName: cardHolder.trim(),
          expiryMonth: month.padStart(2, "0"),
          expiryYear: year,
          ccv: cardCvv.trim(),
          holderCpf: cardCpf.replace(/\D/g, ""),
          postalCode: cardCep.replace(/\D/g, ""),
          addressNumber: cardAddressNumber.trim() || "S/N",
        },
        installments,
        payerDocument: cardCpf.replace(/\D/g, "") || undefined,
      }, idem);
      if (result.status === "FAILED") {
        sessionStorage.removeItem(storageKey);
        setError("Pagamento recusado. Revise os dados e tente novamente.");
        return;
      }
      if (result.status === "PAID") {
        sessionStorage.removeItem(storageKey);
      }
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível processar o cartão.");
    } finally {
      setBusy(false);
    }
  }

  async function copyPix() {
    if (!payment?.pixQrCodeText) return;
    await navigator.clipboard.writeText(payment.pixQrCodeText);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  if (!order) {
    return <main className="flex min-h-dvh items-center justify-center text-[13px] font-semibold text-muted">Carregando pedido da Loja…</main>;
  }

  const paid = ["PAID", "READY", "FULFILLED"].includes(order.status);
  const terminalFailure = ["CANCELED", "REFUNDED", "CHARGEBACK"].includes(order.status);

  if (paid) {
    return (
      <main className="min-h-dvh bg-bg px-5 py-10">
        <div className="mx-auto max-w-[560px] rounded-3xl border border-line bg-surface p-6 shadow-card">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-success/10 text-[30px]">✓</div>
          <h1 className="mt-4 text-center text-[24px] font-black text-ink">
            {order.status === "READY"
              ? order.fulfillmentMethod === "DELIVERY"
                ? "Pedido pronto para entrega"
                : "Pedido pronto para retirada"
              : order.status === "FULFILLED"
                ? order.fulfillmentMethod === "DELIVERY"
                  ? "Pedido entregue"
                  : "Pedido retirado"
                : "Pagamento confirmado"}
          </h1>
          <p className="mt-2 text-center text-[13px] font-semibold text-muted">
            {order.status === "READY"
              ? order.fulfillmentMethod === "DELIVERY"
                ? `Seu pedido na Loja de ${order.house.name} já está pronto para entrega.`
                : `Seu pedido na Loja de ${order.house.name} já está pronto. Mostre o código abaixo na retirada.`
              : order.status === "FULFILLED"
                ? order.fulfillmentMethod === "DELIVERY"
                  ? `A entrega da Loja de ${order.house.name} já foi confirmada.`
                  : `A retirada na Loja de ${order.house.name} já foi confirmada.`
                : `Seu pedido na Loja de ${order.house.name} está pago e agora está sendo preparado.`}
          </p>

          {order.fulfillmentMethod === "PICKUP" ? (
            <div className="mt-6 rounded-2xl border border-primary/20 bg-primary/5 p-5 text-center">
              <p className="text-[11px] font-extrabold uppercase tracking-[.12em] text-primary">Código de retirada</p>
              <p className="mt-2 font-mono text-[32px] font-black tracking-[.12em] text-ink">{order.pickupCode}</p>
              <p className="mt-2 text-[11.5px] font-semibold text-muted">
                Mostre este código na retirada. A Casa confirma a entrega no painel BoraFest.
              </p>
            </div>
          ) : (
            <div className="mt-6 rounded-2xl border border-primary/20 bg-primary/5 p-5 text-center">
              <p className="text-[11px] font-extrabold uppercase tracking-[.12em] text-primary">Entrega</p>
              <p className="mt-2 text-[12px] font-semibold text-muted">
                A Casa vai preparar o pedido e atualizar o status para envio/entrega.
              </p>
            </div>
          )}

          <div className="mt-5 space-y-2">
            {order.items.map((item) => (
              <div key={item.id} className="flex items-center justify-between gap-4 rounded-xl bg-bg px-3 py-2.5">
                <div>
                  <p className="text-[12px] font-extrabold text-ink">{item.productName}</p>
                  <p className="text-[10.5px] font-semibold text-muted">{item.variantName} · {item.quantity}×</p>
                </div>
                <p className="text-[12px] font-black text-ink">{money(item.priceCents * item.quantity)}</p>
              </div>
            ))}
          </div>

          <div className="mt-4 flex items-center justify-between border-t border-line pt-4">
            <span className="text-[13px] font-bold text-muted">Total pago</span>
            <span className="text-[20px] font-black text-ink">{money(order.totalCents)}</span>
          </div>

          {order.status === "FULFILLED" ? (
            <p className="mt-4 rounded-xl bg-success/10 p-3 text-center text-[12px] font-extrabold text-success">
              {order.fulfillmentMethod === "DELIVERY" ? "Pedido entregue." : "Pedido já retirado."}
            </p>
          ) : null}

          <Link
            href={`/casa/${order.house.slug}`}
            className="mt-6 flex h-12 items-center justify-center rounded-xl border border-line-input text-[13px] font-extrabold text-primary"
          >
            Voltar para a Casa
          </Link>
        </div>
      </main>
    );
  }

  if (terminalFailure) {
    return (
      <main className="flex min-h-dvh items-center justify-center bg-bg px-5">
        <div className="w-full max-w-[520px] rounded-3xl border border-line bg-surface p-6 text-center shadow-card">
          <h1 className="text-[22px] font-black text-ink">Este pedido não está mais ativo</h1>
          <p className="mt-2 text-[13px] font-semibold text-muted">
            O estoque reservado foi liberado. Volte à Loja para montar um novo pedido.
          </p>
          <Link href={`/casa/${order.house.slug}`} className="mt-5 inline-flex rounded-xl bg-primary px-5 py-3 text-[13px] font-extrabold text-white">
            Voltar para a Loja
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-dvh bg-bg px-5 py-8">
      <div className="mx-auto grid max-w-[900px] gap-5 md:grid-cols-[1fr_360px]">
        <section className="rounded-3xl border border-line bg-surface p-5 shadow-card">
          <p className="text-[11px] font-extrabold uppercase tracking-[.1em] text-primary">Loja da Casa</p>
          <h1 className="mt-1 text-[22px] font-black text-ink">{order.house.name}</h1>
          <p className="mt-1 text-[12px] font-semibold text-muted">Pedido reservado por mais {timer}</p>

          <div className="mt-5 space-y-2">
            {order.items.map((item) => (
              <div key={item.id} className="flex items-center justify-between gap-4 rounded-xl bg-bg px-3 py-3">
                <div>
                  <p className="text-[12.5px] font-extrabold text-ink">{item.productName}</p>
                  <p className="text-[10.5px] font-semibold text-muted">{item.variantName} · {item.quantity}×</p>
                </div>
                <p className="text-[12.5px] font-black text-ink">{money(item.priceCents * item.quantity)}</p>
              </div>
            ))}
          </div>

          <div className="mt-4 space-y-1.5 border-t border-line pt-4">
            <div className="flex items-center justify-between text-[12px]">
              <span className="font-semibold text-muted">Produtos</span>
              <span className="font-bold text-ink">{money(order.subtotalCents)}</span>
            </div>
            <div className="flex items-center justify-between text-[12px]">
              <span className="font-semibold text-muted">Frete</span>
              <span className="font-bold text-ink">
                {order.shippingCents > 0 ? money(order.shippingCents) : "Grátis"}
              </span>
            </div>
            <div className="flex items-center justify-between pt-1">
              <span className="text-[13px] font-bold text-muted">Total</span>
              <span className="text-[21px] font-black text-ink">{money(order.totalCents)}</span>
            </div>
          </div>
          <p className="mt-3 rounded-xl bg-primary/5 p-3 text-[11px] font-semibold leading-relaxed text-muted">
            {order.fulfillmentMethod === "PICKUP"
              ? `Retirada diretamente com ${order.house.name}. O código aparece após o pagamento.`
              : "Entrega no endereço informado. A Casa atualiza o pedido quando ele estiver pronto para envio."}
          </p>
          {order.fulfillmentMethod === "DELIVERY" && order.shippingAddress ? (
            <div className="mt-3 rounded-xl border border-line bg-bg p-3 text-[11px] font-semibold text-muted">
              {order.shippingAddress.street}, {order.shippingAddress.number}
              {order.shippingAddress.complement ? ` · ${order.shippingAddress.complement}` : ""}
              <br />
              {order.shippingAddress.neighborhood} · {order.shippingAddress.city}/{order.shippingAddress.state}
              <br />
              CEP {order.shippingAddress.postalCode}
            </div>
          ) : null}
        </section>

        <section className="rounded-3xl border border-line bg-surface p-5 shadow-card">
          <h2 className="text-[17px] font-black text-ink">Pagamento</h2>
          <div className="mt-3 grid grid-cols-2 gap-2 rounded-xl bg-bg p-1">
            <button
              type="button"
              onClick={() => setPayTab("PIX")}
              className={`rounded-lg px-3 py-2 text-[12px] font-extrabold ${
                payTab === "PIX" ? "bg-surface text-primary shadow-sm" : "text-muted"
              }`}
            >
              Pix
            </button>
            <button
              type="button"
              onClick={() => setPayTab("CARD")}
              className={`rounded-lg px-3 py-2 text-[12px] font-extrabold ${
                payTab === "CARD" ? "bg-surface text-primary shadow-sm" : "text-muted"
              }`}
            >
              Cartão
            </button>
          </div>

          {payTab === "PIX" ? (
            payment?.pixQrCodeText ? (
            <>
              <div className="mx-auto mt-4 w-[220px] rounded-2xl border border-line bg-white p-3">
                <QRCode value={payment.pixQrCodeText} size={196} className="h-auto w-full" />
              </div>
              <button
                type="button"
                onClick={copyPix}
                className="mt-4 h-12 w-full rounded-xl bg-primary text-[13px] font-extrabold text-white"
              >
                {copied ? "Pix copiado ✓" : "Copiar Pix copia e cola"}
              </button>
              <p className="mt-3 text-center text-[11px] font-semibold text-muted">
                Assim que o banco confirmar, esta página libera automaticamente o código de retirada.
              </p>
            </>
          ) : (
            <>
              <p className="mt-2 text-[11.5px] font-semibold leading-relaxed text-muted">
                O documento é enviado ao provedor de pagamento para emissão do Pix e não é salvo neste pedido da Loja.
              </p>
              <input
                value={cpf}
                onChange={(e) => setCpf(e.target.value)}
                placeholder="CPF/CNPJ do pagador"
                inputMode="numeric"
                autoComplete="off"
                className="mt-4 h-12 w-full rounded-xl border border-line-input bg-surface px-3.5 text-[13px] font-semibold outline-none focus:border-primary"
              />
              <input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="Celular do pagador (opcional)"
                inputMode="tel"
                autoComplete="tel"
                className="mt-3 h-12 w-full rounded-xl border border-line-input bg-surface px-3.5 text-[13px] font-semibold outline-none focus:border-primary"
              />
              <button
                type="button"
                onClick={generatePix}
                disabled={busy || remaining <= 0}
                className="mt-4 h-12 w-full rounded-xl bg-primary text-[13px] font-extrabold text-white disabled:opacity-50"
              >
                {busy ? "Gerando Pix…" : "Gerar Pix"}
              </button>
            </>
          )
          ) : (
            <div className="mt-4 space-y-3">
              <input
                value={cardNumber}
                onChange={(e) => setCardNumber(e.target.value)}
                placeholder="Número do cartão"
                inputMode="numeric"
                autoComplete="cc-number"
                className="h-11 w-full rounded-xl border border-line-input bg-surface px-3 text-[12px] font-semibold"
              />
              <input
                value={cardHolder}
                onChange={(e) => setCardHolder(e.target.value)}
                placeholder="Nome impresso no cartão"
                autoComplete="cc-name"
                className="h-11 w-full rounded-xl border border-line-input bg-surface px-3 text-[12px] font-semibold"
              />
              <div className="grid grid-cols-2 gap-2">
                <input
                  value={cardExp}
                  onChange={(e) => setCardExp(e.target.value)}
                  placeholder="MM/AA"
                  autoComplete="cc-exp"
                  className="h-11 rounded-xl border border-line-input bg-surface px-3 text-[12px] font-semibold"
                />
                <input
                  value={cardCvv}
                  onChange={(e) => setCardCvv(e.target.value)}
                  placeholder="CVV"
                  inputMode="numeric"
                  autoComplete="cc-csc"
                  className="h-11 rounded-xl border border-line-input bg-surface px-3 text-[12px] font-semibold"
                />
              </div>
              <input
                value={cardCpf}
                onChange={(e) => setCardCpf(e.target.value)}
                placeholder="CPF/CNPJ do titular"
                inputMode="numeric"
                className="h-11 w-full rounded-xl border border-line-input bg-surface px-3 text-[12px] font-semibold"
              />
              <div className="grid grid-cols-2 gap-2">
                <input
                  value={cardCep}
                  onChange={(e) => setCardCep(e.target.value)}
                  placeholder="CEP do titular"
                  inputMode="numeric"
                  className="h-11 rounded-xl border border-line-input bg-surface px-3 text-[12px] font-semibold"
                />
                <input
                  value={cardAddressNumber}
                  onChange={(e) => setCardAddressNumber(e.target.value)}
                  placeholder="Nº do endereço"
                  className="h-11 rounded-xl border border-line-input bg-surface px-3 text-[12px] font-semibold"
                />
              </div>
              <select
                value={installments}
                onChange={(e) => setInstallments(Number(e.target.value))}
                className="h-11 w-full rounded-xl border border-line-input bg-surface px-3 text-[12px] font-semibold"
              >
                {Array.from({ length: 12 }, (_, index) => index + 1).map((n) => (
                  <option key={n} value={n}>
                    {n}x
                  </option>
                ))}
              </select>
              <p className="text-[10.5px] font-semibold leading-relaxed text-muted">
                Os dados do cartão são enviados ao provedor de pagamento por HTTPS e não são armazenados pelo BoraFest.
              </p>
              <button
                type="button"
                onClick={payCard}
                disabled={busy || remaining <= 0}
                className="h-12 w-full rounded-xl bg-primary text-[13px] font-extrabold text-white disabled:opacity-50"
              >
                {busy ? "Processando…" : `Pagar ${money(order.totalCents)}`}
              </button>
            </div>
          )}

          {error ? <p className="mt-3 text-[11.5px] font-bold text-danger">{error}</p> : null}
        </section>
      </div>
    </main>
  );
}
