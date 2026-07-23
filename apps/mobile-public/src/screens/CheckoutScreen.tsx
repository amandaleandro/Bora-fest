import React, { useEffect, useRef, useState } from "react";
import { View, Text, TextInput, Pressable, StyleSheet, ActivityIndicator } from "react-native";
import QRCode from "react-native-qrcode-svg";
import * as Clipboard from "expo-clipboard";
import { api } from "../api/client";
import type { Order, Reservation } from "../api/types";
import { formatCents } from "../format";
import { tokenizeCard, CardTokenizationError } from "../payments/tokenizeCard";
import { registerForPushNotificationsAsync } from "../push";

type Step =
  | "loading"
  | "contact"
  | "payment-method"
  | "card-form"
  | "paying-card"
  | "waiting-payment"
  | "expired"
  | "error";

interface Props {
  reservationId: string;
  onFulfilled: (publicToken: string) => void;
}

export function CheckoutScreen({ reservationId, onFulfilled }: Props) {
  const [step, setStep] = useState<Step>("loading");
  const [reservation, setReservation] = useState<Reservation | null>(null);
  const [order, setOrder] = useState<Order | null>(null);
  const [pixCode, setPixCode] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [cardNumber, setCardNumber] = useState("");
  const [cardHolder, setCardHolder] = useState("");
  const [cardExpMonth, setCardExpMonth] = useState("");
  const [cardExpYear, setCardExpYear] = useState("");
  const [cardCvv, setCardCvv] = useState("");
  const [installments, setInstallments] = useState(1);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const totalCents = reservation?.items.reduce(
    (sum, item) => sum + item.quantity * (item.priceCents + item.feeCents),
    0,
  );

  useEffect(() => {
    api
      .getReservation(reservationId)
      .then((res) => {
        if (res.status !== "ACTIVE" || new Date(res.expiresAt).getTime() <= Date.now()) {
          setStep("expired");
          return;
        }
        setReservation(res);
        setStep("contact");
      })
      .catch(() => setStep("error"));

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [reservationId]);

  function startPolling(publicToken: string) {
    pollRef.current = setInterval(async () => {
      const status = await api.getOrderStatus(publicToken);
      if (status.status === "FULFILLED") {
        if (pollRef.current) clearInterval(pollRef.current);
        onFulfilled(publicToken);
      } else if (["EXPIRED", "CANCELED", "REFUNDED", "CHARGEBACK"].includes(status.status)) {
        if (pollRef.current) clearInterval(pollRef.current);
        setStep("expired");
      }
    }, 3000);
  }

  // Registro de push é best-effort: se o aparelho não suportar ou negar
  // permissão, a compra segue normal (a carteira sempre pode ser vista por
  // polling/e-mail, o push é só uma conveniência a mais).
  function registerPushSilently(publicToken: string) {
    registerForPushNotificationsAsync()
      .then((result) => {
        if (result) return api.registerPushToken(publicToken, result.token, result.platform);
      })
      .catch(() => undefined);
  }

  async function handleContactSubmit() {
    setError(null);
    if (!email.includes("@")) {
      setError("Informe um e-mail válido");
      return;
    }
    setSubmitting(true);
    try {
      const created = await api.createOrder({
        reservationId,
        contactEmail: email,
        contactName: name || undefined,
        contactPhone: phone || undefined,
      });
      setOrder(created);
      registerPushSilently(created.publicToken);
      setStep("payment-method");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível continuar");
    } finally {
      setSubmitting(false);
    }
  }

  async function handlePix() {
    if (!order) return;
    setError(null);
    setSubmitting(true);
    try {
      const payment = await api.createPixPayment(order.id, { payerPhone: phone || undefined });
      setPixCode(payment.pixQrCodeText);
      setStep("waiting-payment");
      startPolling(order.publicToken);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível gerar o Pix");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCardSubmit() {
    if (!order) return;
    setError(null);
    if (cardNumber.replace(/\D/g, "").length < 13) {
      setError("Número de cartão inválido");
      return;
    }
    if (!cardHolder.trim()) {
      setError("Informe o nome como está no cartão");
      return;
    }
    if (cardExpMonth.length !== 2 || cardExpYear.length !== 4) {
      setError("Validade inválida (MM/AAAA)");
      return;
    }
    if (cardCvv.length < 3) {
      setError("CVV inválido");
      return;
    }

    setStep("paying-card");
    setSubmitting(true);
    try {
      const cardToken = await tokenizeCard({
        number: cardNumber.replace(/\D/g, ""),
        holderName: cardHolder.trim(),
        expMonth: cardExpMonth,
        expYear: cardExpYear,
        cvv: cardCvv,
      });

      const idempotencyKey = `mobile-card-${order.id}-${Date.now()}`;
      const payment = await api.createCardPayment(
        order.id,
        { cardToken, installments },
        idempotencyKey,
      );

      if (payment.status === "FAILED") {
        setError(payment.failReason ?? "Cartão recusado");
        setStep("card-form");
        return;
      }

      setStep("waiting-payment");
      startPolling(order.publicToken);
    } catch (err) {
      setError(
        err instanceof CardTokenizationError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Não foi possível processar o cartão",
      );
      setStep("card-form");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCopy() {
    if (!pixCode) return;
    await Clipboard.setStringAsync(pixCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (step === "loading") {
    return (
      <View style={styles.center}>
        <ActivityIndicator color="#22c55e" />
      </View>
    );
  }

  if (step === "expired") {
    return (
      <View style={styles.center}>
        <Text style={styles.title}>Reserva expirada</Text>
        <Text style={styles.subtitle}>Volte e refaça a reserva.</Text>
      </View>
    );
  }

  if (step === "error") {
    return (
      <View style={styles.center}>
        <Text style={styles.title}>Não encontramos essa reserva</Text>
      </View>
    );
  }

  if (step === "paying-card") {
    return (
      <View style={styles.center}>
        <ActivityIndicator color="#22c55e" />
        <Text style={styles.hint}>Processando pagamento...</Text>
      </View>
    );
  }

  if (step === "waiting-payment") {
    return (
      <View style={styles.center}>
        <Text style={styles.title}>{pixCode ? "Pague com Pix para confirmar" : "Confirmando pagamento..."}</Text>
        <Text style={styles.totalValue}>{totalCents ? formatCents(totalCents) : ""}</Text>
        {pixCode ? (
          <>
            <View style={styles.qrBox}>
              <QRCode value={pixCode} size={200} />
            </View>
            <Pressable style={styles.copyButton} onPress={handleCopy}>
              <Text style={styles.copyButtonText}>{copied ? "Copiado!" : "Copiar código Pix"}</Text>
            </Pressable>
          </>
        ) : null}
        <Text style={styles.hint}>Assim que o pagamento for aprovado, esta tela avança sozinha.</Text>
      </View>
    );
  }

  if (step === "payment-method") {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>Como você quer pagar?</Text>
        {totalCents ? <Text style={styles.totalValue}>{formatCents(totalCents)}</Text> : null}

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <Pressable style={styles.continueButton} onPress={handlePix} disabled={submitting}>
          <Text style={styles.continueButtonText}>{submitting ? "Gerando..." : "Pagar com Pix"}</Text>
        </Pressable>
        <Pressable
          style={[styles.continueButton, styles.cardButton]}
          onPress={() => setStep("card-form")}
          disabled={submitting}
        >
          <Text style={styles.cardButtonText}>Pagar com cartão de crédito</Text>
        </Pressable>
      </View>
    );
  }

  if (step === "card-form") {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>Dados do cartão</Text>
        {totalCents ? <Text style={styles.totalValue}>{formatCents(totalCents)}</Text> : null}

        <TextInput
          style={styles.input}
          placeholder="Número do cartão"
          placeholderTextColor="#6b7280"
          keyboardType="number-pad"
          maxLength={19}
          value={cardNumber}
          onChangeText={(v) => setCardNumber(v.replace(/\D/g, ""))}
        />
        <TextInput
          style={styles.input}
          placeholder="Nome impresso no cartão"
          placeholderTextColor="#6b7280"
          autoCapitalize="characters"
          value={cardHolder}
          onChangeText={setCardHolder}
        />
        <View style={styles.row}>
          <TextInput
            style={[styles.input, styles.rowInput]}
            placeholder="MM"
            placeholderTextColor="#6b7280"
            keyboardType="number-pad"
            maxLength={2}
            value={cardExpMonth}
            onChangeText={(v) => setCardExpMonth(v.replace(/\D/g, ""))}
          />
          <TextInput
            style={[styles.input, styles.rowInput]}
            placeholder="AAAA"
            placeholderTextColor="#6b7280"
            keyboardType="number-pad"
            maxLength={4}
            value={cardExpYear}
            onChangeText={(v) => setCardExpYear(v.replace(/\D/g, ""))}
          />
          <TextInput
            style={[styles.input, styles.rowInput]}
            placeholder="CVV"
            placeholderTextColor="#6b7280"
            keyboardType="number-pad"
            maxLength={4}
            secureTextEntry
            value={cardCvv}
            onChangeText={(v) => setCardCvv(v.replace(/\D/g, ""))}
          />
        </View>

        <View style={styles.installmentsRow}>
          <Text style={styles.installmentsLabel}>Parcelas:</Text>
          <Pressable
            style={styles.stepperButton}
            onPress={() => setInstallments((n) => Math.max(1, n - 1))}
          >
            <Text style={styles.stepperButtonText}>-</Text>
          </Pressable>
          <Text style={styles.installmentsValue}>{installments}x</Text>
          <Pressable
            style={styles.stepperButton}
            onPress={() => setInstallments((n) => Math.min(12, n + 1))}
          >
            <Text style={styles.stepperButtonText}>+</Text>
          </Pressable>
        </View>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <Pressable style={styles.continueButton} onPress={handleCardSubmit} disabled={submitting}>
          <Text style={styles.continueButtonText}>{submitting ? "Processando..." : "Confirmar pagamento"}</Text>
        </Pressable>
        <Pressable style={styles.backLinkButton} onPress={() => setStep("payment-method")}>
          <Text style={styles.backLinkText}>‹ Trocar forma de pagamento</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Seus dados</Text>
      <Text style={styles.subtitle}>Não precisa criar conta — o ingresso vai para o seu e-mail/WhatsApp.</Text>
      {totalCents ? <Text style={styles.totalValue}>{formatCents(totalCents)}</Text> : null}

      <TextInput
        style={styles.input}
        placeholder="E-mail *"
        placeholderTextColor="#6b7280"
        keyboardType="email-address"
        autoCapitalize="none"
        value={email}
        onChangeText={setEmail}
      />
      <TextInput
        style={styles.input}
        placeholder="Nome"
        placeholderTextColor="#6b7280"
        value={name}
        onChangeText={setName}
      />
      <TextInput
        style={styles.input}
        placeholder="WhatsApp (opcional)"
        placeholderTextColor="#6b7280"
        keyboardType="number-pad"
        value={phone}
        onChangeText={(v) => setPhone(v.replace(/\D/g, ""))}
      />

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <Pressable style={styles.continueButton} onPress={handleContactSubmit} disabled={submitting}>
        <Text style={styles.continueButtonText}>{submitting ? "Continuando..." : "Continuar"}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#111827", padding: 20, paddingTop: 60 },
  center: { flex: 1, backgroundColor: "#111827", justifyContent: "center", alignItems: "center", padding: 24 },
  title: { fontSize: 20, fontWeight: "700", color: "#fff" },
  subtitle: { fontSize: 14, color: "#9ca3af", marginTop: 6, textAlign: "center" },
  totalValue: { fontSize: 22, fontWeight: "800", color: "#fff", marginTop: 12 },
  input: {
    backgroundColor: "#1f2937",
    color: "#fff",
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 14,
    marginTop: 16,
  },
  row: { flexDirection: "row", gap: 10 },
  rowInput: { flex: 1 },
  installmentsRow: { flexDirection: "row", alignItems: "center", marginTop: 20, gap: 12 },
  installmentsLabel: { color: "#9ca3af", fontSize: 14 },
  stepperButton: {
    backgroundColor: "#1f2937",
    borderRadius: 8,
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
  },
  stepperButtonText: { color: "#fff", fontSize: 18, fontWeight: "700" },
  installmentsValue: { color: "#fff", fontSize: 16, fontWeight: "600", minWidth: 32, textAlign: "center" },
  error: { color: "#f87171", marginTop: 12, fontSize: 13 },
  continueButton: {
    marginTop: 28,
    backgroundColor: "#22c55e",
    borderRadius: 10,
    paddingVertical: 16,
    alignItems: "center",
  },
  cardButton: { marginTop: 12, backgroundColor: "#1f2937" },
  continueButtonText: { color: "#052e16", fontWeight: "700", fontSize: 16 },
  cardButtonText: { color: "#fff", fontWeight: "700", fontSize: 16 },
  backLinkButton: { marginTop: 16, alignItems: "center" },
  backLinkText: { color: "#6b7280", fontSize: 13 },
  qrBox: { backgroundColor: "#fff", padding: 16, borderRadius: 16, marginTop: 24 },
  copyButton: { marginTop: 16, backgroundColor: "#1f2937", borderRadius: 10, paddingHorizontal: 20, paddingVertical: 10 },
  copyButtonText: { color: "#fff", fontSize: 14 },
  hint: { color: "#6b7280", fontSize: 12, marginTop: 24, textAlign: "center", paddingHorizontal: 24 },
});
