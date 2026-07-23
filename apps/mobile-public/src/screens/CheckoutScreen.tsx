import React, { useEffect, useRef, useState } from "react";
import { View, Text, TextInput, Pressable, StyleSheet, ActivityIndicator } from "react-native";
import QRCode from "react-native-qrcode-svg";
import * as Clipboard from "expo-clipboard";
import { api } from "../api/client";
import type { Reservation } from "../api/types";
import { formatCents } from "../format";

type Step = "loading" | "contact" | "waiting-payment" | "expired" | "error";

interface Props {
  reservationId: string;
  onFulfilled: (publicToken: string) => void;
}

export function CheckoutScreen({ reservationId, onFulfilled }: Props) {
  const [step, setStep] = useState<Step>("loading");
  const [reservation, setReservation] = useState<Reservation | null>(null);
  const [pixCode, setPixCode] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
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

  async function handleSubmit() {
    setError(null);
    if (!email.includes("@")) {
      setError("Informe um e-mail válido");
      return;
    }
    setSubmitting(true);
    try {
      const order = await api.createOrder({
        reservationId,
        contactEmail: email,
        contactName: name || undefined,
        contactPhone: phone || undefined,
      });
      const payment = await api.createPixPayment(order.id, { payerPhone: phone || undefined });
      setPixCode(payment.pixQrCodeText);
      setStep("waiting-payment");

      pollRef.current = setInterval(async () => {
        const status = await api.getOrderStatus(order.publicToken);
        if (status.status === "FULFILLED") {
          if (pollRef.current) clearInterval(pollRef.current);
          onFulfilled(order.publicToken);
        } else if (["EXPIRED", "CANCELED", "REFUNDED", "CHARGEBACK"].includes(status.status)) {
          if (pollRef.current) clearInterval(pollRef.current);
          setStep("expired");
        }
      }, 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível continuar");
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

  if (step === "waiting-payment") {
    return (
      <View style={styles.center}>
        <Text style={styles.title}>Pague com Pix para confirmar</Text>
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

      <Pressable style={styles.continueButton} onPress={handleSubmit} disabled={submitting}>
        <Text style={styles.continueButtonText}>{submitting ? "Gerando pagamento..." : "Pagar com Pix"}</Text>
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
  error: { color: "#f87171", marginTop: 12, fontSize: 13 },
  continueButton: {
    marginTop: 28,
    backgroundColor: "#22c55e",
    borderRadius: 10,
    paddingVertical: 16,
    alignItems: "center",
  },
  continueButtonText: { color: "#052e16", fontWeight: "700", fontSize: 16 },
  qrBox: { backgroundColor: "#fff", padding: 16, borderRadius: 16, marginTop: 24 },
  copyButton: { marginTop: 16, backgroundColor: "#1f2937", borderRadius: 10, paddingHorizontal: 20, paddingVertical: 10 },
  copyButtonText: { color: "#fff", fontSize: 14 },
  hint: { color: "#6b7280", fontSize: 12, marginTop: 24, textAlign: "center", paddingHorizontal: 24 },
});
