import React, { useState } from "react";
import { View, Text, TextInput, Pressable, StyleSheet, ActivityIndicator, Platform } from "react-native";
import * as Device from "expo-device";
import { api } from "../api/client";
import { ApiError } from "../api/types";
import { useSession } from "../context/SessionContext";
import { initDatabase, upsertManifest } from "../db/database";
import { syncManifest } from "../sync/manifestSync";

export function PinLoginScreen() {
  const { saveSession } = useSession();
  const [eventId, setEventId] = useState("");
  const [pin, setPin] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = eventId.trim().length > 0 && pin.trim().length === 6 && !loading;

  async function handleSubmit() {
    setError(null);
    setLoading(true);
    try {
      const deviceName = `${Device.modelName ?? Platform.OS} — portaria`;
      const response = await api.createValidatorSession(eventId.trim(), pin.trim(), deviceName);

      initDatabase();
      const device = { deviceId: response.deviceId, deviceToken: response.deviceToken };
      await syncManifest(response.event.id, device).catch(() => {
        // primeira sincronização pode falhar por rede; o app segue e tenta
        // de novo na Home. O login em si não depende do manifesto.
      });

      await saveSession({
        deviceId: response.deviceId,
        deviceToken: response.deviceToken,
        event: response.event,
        checkinPoints: response.checkinPoints,
        checkinPointId: response.checkinPoints[0]?.id,
      });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Não foi possível entrar — verifique a conexão");
    } finally {
      setLoading(false);
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>BoraFest Check-in</Text>
      <Text style={styles.subtitle}>Entre com o PIN fornecido pelo produtor do evento</Text>

      <Text style={styles.label}>ID do evento</Text>
      <TextInput
        style={styles.input}
        value={eventId}
        onChangeText={setEventId}
        placeholder="cole o ID do evento"
        autoCapitalize="none"
        autoCorrect={false}
      />

      <Text style={styles.label}>PIN (6 dígitos)</Text>
      <TextInput
        style={styles.input}
        value={pin}
        onChangeText={(v) => setPin(v.replace(/\D/g, "").slice(0, 6))}
        placeholder="000000"
        keyboardType="number-pad"
        maxLength={6}
      />

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <Pressable
        style={[styles.button, !canSubmit && styles.buttonDisabled]}
        onPress={handleSubmit}
        disabled={!canSubmit}
      >
        {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Entrar</Text>}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: "center", padding: 24, backgroundColor: "#111827" },
  title: { fontSize: 28, fontWeight: "700", color: "#fff", marginBottom: 4 },
  subtitle: { fontSize: 14, color: "#9ca3af", marginBottom: 32 },
  label: { fontSize: 13, color: "#d1d5db", marginBottom: 6, marginTop: 12 },
  input: {
    backgroundColor: "#1f2937",
    color: "#fff",
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
  },
  error: { color: "#f87171", marginTop: 16 },
  button: {
    marginTop: 32,
    backgroundColor: "#22c55e",
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: "center",
  },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: "#052e16", fontWeight: "700", fontSize: 16 },
});
