import React, { useState } from "react";
import { View, Text, TextInput, Pressable, StyleSheet, ActivityIndicator } from "react-native";
import { api } from "../api/client";
import { ApiError } from "../api/types";
import { useAuth } from "../context/AuthContext";

interface Props {
  onLoggedIn: () => void;
  onBack: () => void;
}

export function LoginScreen({ onLoggedIn, onBack }: Props) {
  const { login } = useAuth();
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleRequestCode() {
    setError(null);
    setSubmitting(true);
    try {
      await api.requestOtp(email);
      setStep("code");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível enviar o código");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleVerifyCode() {
    setError(null);
    setSubmitting(true);
    try {
      const response = await api.verifyOtp(email, code);
      await login(response.token, response.user);
      onLoggedIn();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Código inválido");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <View style={styles.container}>
      <Pressable onPress={onBack}>
        <Text style={styles.backLink}>‹ Voltar</Text>
      </Pressable>

      <Text style={styles.title}>Entrar</Text>
      <Text style={styles.subtitle}>Só precisa disso pra ver seus ingressos de compras anteriores.</Text>

      <TextInput
        style={styles.input}
        placeholder="E-mail"
        placeholderTextColor="#6b7280"
        keyboardType="email-address"
        autoCapitalize="none"
        value={email}
        onChangeText={setEmail}
        editable={step === "email"}
      />

      {step === "code" ? (
        <TextInput
          style={styles.input}
          placeholder="Código recebido por e-mail"
          placeholderTextColor="#6b7280"
          keyboardType="number-pad"
          maxLength={6}
          value={code}
          onChangeText={(v) => setCode(v.replace(/\D/g, "").slice(0, 6))}
        />
      ) : null}

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <Pressable
        style={styles.button}
        onPress={step === "email" ? handleRequestCode : handleVerifyCode}
        disabled={submitting}
      >
        {submitting ? (
          <ActivityIndicator color="#052e16" />
        ) : (
          <Text style={styles.buttonText}>{step === "email" ? "Enviar código" : "Entrar"}</Text>
        )}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#111827", padding: 20, paddingTop: 60 },
  backLink: { color: "#9ca3af", fontSize: 14 },
  title: { fontSize: 22, fontWeight: "700", color: "#fff", marginTop: 20 },
  subtitle: { fontSize: 14, color: "#9ca3af", marginTop: 6 },
  input: {
    backgroundColor: "#1f2937",
    color: "#fff",
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 14,
    marginTop: 16,
  },
  error: { color: "#f87171", marginTop: 12, fontSize: 13 },
  button: { marginTop: 24, backgroundColor: "#22c55e", borderRadius: 10, paddingVertical: 14, alignItems: "center" },
  buttonText: { color: "#052e16", fontWeight: "700" },
});
