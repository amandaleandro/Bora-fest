"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import QRCode from "react-qr-code";
import { api, type Order, type Reservation } from "@/lib/api";
import { formatCents } from "@/lib/format";

type Step = "loading" | "contact" | "waiting-payment" | "expired" | "error";

export default function CheckoutPage({ params }: { params: { reservationId: string } }) {
  const router = useRouter();
  const [step, setStep] = useState<Step>("loading");
  const [reservation, setReservation] = useState<Reservation | null>(null);
  const [order, setOrder] = useState<Order | null>(null);
  const [pixCode, setPixCode] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const totalCents = reservation?.items.reduce(
    (sum, item) => sum + item.quantity * (item.priceCents + item.feeCents),
    0,
  );

  useEffect(() => {
    api
      .getReservation(params.reservationId)
      .then((res) => {
        if (res.status !== "ACTIVE" || new Date(res.expiresAt).getTime() <= Date.now()) {
          setStep("expired");
          return;
        }
        setReservation(res);
        setStep("contact");
      })
      .catch(() => setStep("error"));
  }, [params.reservationId]);

  useEffect(() => () => {
    if (pollRef.current) clearInterval(pollRef.current);
  }, []);

  async function handleSubmitContact() {
    setError(null);
    if (!email.includes("@")) {
      setError("Informe um e-mail válido");
      return;
    }

    setSubmitting(true);
    try {
      const createdOrder = await api.createOrder({
        reservationId: params.reservationId,
        contactEmail: email,
        contactName: name || undefined,
        contactPhone: phone || undefined,
      });
      setOrder(createdOrder);

      const payment = await api.createPixPayment(createdOrder.id, { payerPhone: phone || undefined });
      setPixCode(payment.pixQrCodeText);
      setStep("waiting-payment");

      pollRef.current = setInterval(async () => {
        const status = await api.getOrderStatus(createdOrder.publicToken);
        if (status.status === "FULFILLED") {
          if (pollRef.current) clearInterval(pollRef.current);
          router.push(`/pedido/${createdOrder.publicToken}`);
        } else if (["EXPIRED", "CANCELED", "REFUNDED", "CHARGEBACK"].includes(status.status)) {
          if (pollRef.current) clearInterval(pollRef.current);
          setStep("expired");
        }
      }, 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível continuar — tente novamente");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCopyPix() {
    if (pixCode) await navigator.clipboard.writeText(pixCode);
  }

  if (step === "loading") {
    return <main className="px-4 py-10 text-gray-400">Carregando...</main>;
  }

  if (step === "expired") {
    return (
      <main className="px-4 py-10">
        <h1 className="text-xl font-semibold text-amber-400">Reserva expirada</h1>
        <p className="mt-2 text-gray-400">
          O tempo para concluir esta compra acabou. Volte à página do evento e refaça a reserva.
        </p>
      </main>
    );
  }

  if (step === "error") {
    return (
      <main className="px-4 py-10">
        <h1 className="text-xl font-semibold text-red-400">Não encontramos essa reserva</h1>
      </main>
    );
  }

  if (step === "waiting-payment") {
    return (
      <main className="px-4 py-10 text-center">
        <h1 className="text-xl font-semibold">Pague com Pix para confirmar</h1>
        <p className="mt-1 text-2xl font-bold">{totalCents ? formatCents(totalCents) : ""}</p>

        {pixCode ? (
          <div className="mt-6 flex flex-col items-center gap-4">
            <div className="rounded-xl bg-white p-4">
              <QRCode value={pixCode} size={200} />
            </div>
            <button
              type="button"
              onClick={handleCopyPix}
              className="rounded-lg bg-gray-800 px-4 py-2 text-sm text-gray-200"
            >
              Copiar código Pix
            </button>
          </div>
        ) : null}

        <p className="mt-6 text-sm text-gray-400">
          Assim que o pagamento for aprovado, esta página avança sozinha — não feche o app.
        </p>
      </main>
    );
  }

  return (
    <main className="px-4 py-10">
      <h1 className="text-xl font-semibold">Seus dados</h1>
      <p className="mt-1 text-gray-400">
        Não precisa criar conta — o ingresso vai para o seu e-mail (e WhatsApp, se informar o número).
      </p>

      {totalCents ? (
        <p className="mt-4 text-lg font-semibold">Total: {formatCents(totalCents)}</p>
      ) : null}

      <div className="mt-6 space-y-4">
        <div>
          <label className="mb-1 block text-sm text-gray-300">E-mail *</label>
          <input
            type="email"
            className="w-full rounded-lg bg-gray-800 px-4 py-3"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div>
          <label className="mb-1 block text-sm text-gray-300">Nome</label>
          <input
            className="w-full rounded-lg bg-gray-800 px-4 py-3"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div>
          <label className="mb-1 block text-sm text-gray-300">WhatsApp (opcional)</label>
          <input
            className="w-full rounded-lg bg-gray-800 px-4 py-3"
            placeholder="11999998888"
            value={phone}
            onChange={(e) => setPhone(e.target.value.replace(/\D/g, ""))}
          />
        </div>
      </div>

      {error ? <p className="mt-4 text-sm text-red-400">{error}</p> : null}

      <button
        type="button"
        className="mt-8 w-full rounded-lg bg-brand px-6 py-3 font-semibold text-brand-dark disabled:opacity-40"
        onClick={handleSubmitContact}
        disabled={submitting}
      >
        {submitting ? "Gerando pagamento..." : "Pagar com Pix"}
      </button>
    </main>
  );
}
