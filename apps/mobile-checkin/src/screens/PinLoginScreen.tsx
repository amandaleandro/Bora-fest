import React, { useRef, useState } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  Platform,
  Animated,
  ScrollView,
  KeyboardAvoidingView,
} from "react-native";
import * as Device from "expo-device";
import { api } from "../api/client";
import { ApiError } from "../api/types";
import { useSession } from "../context/SessionContext";
import { initDatabase, upsertManifest } from "../db/database";
import { syncManifest } from "../sync/manifestSync";
import { colors } from "../theme/colors";

const PIN_LENGTH = 6;
const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "back"];

export function PinLoginScreen() {
  const { saveSession } = useSession();
  const [eventId, setEventId] = useState("");
  const [pin, setPin] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const shake = useRef(new Animated.Value(0)).current;

  const canSubmit = eventId.trim().length > 0 && pin.length === PIN_LENGTH && !loading;

  function runShake() {
    shake.setValue(0);
    Animated.sequence([
      Animated.timing(shake, { toValue: 1, duration: 60, useNativeDriver: true }),
      Animated.timing(shake, { toValue: -1, duration: 60, useNativeDriver: true }),
      Animated.timing(shake, { toValue: 1, duration: 60, useNativeDriver: true }),
      Animated.timing(shake, { toValue: 0, duration: 60, useNativeDriver: true }),
    ]).start();
  }

  async function handleSubmit(fullPin: string) {
    setError(null);
    setLoading(true);
    try {
      const deviceName = `${Device.modelName ?? Platform.OS} — portaria`;
      const response = await api.createValidatorSession(eventId.trim(), fullPin, deviceName);

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
      setPin("");
      runShake();
    } finally {
      setLoading(false);
    }
  }

  function handleKeyPress(key: string) {
    if (loading) return;
    if (key === "" ) return;
    if (key === "back") {
      setPin((p) => p.slice(0, -1));
      return;
    }
    if (pin.length >= PIN_LENGTH) return;
    const next = pin + key;
    setPin(next);
    if (next.length === PIN_LENGTH) {
      if (eventId.trim().length === 0) {
        setError("Informe o ID do evento antes do PIN");
        setPin("");
        runShake();
        return;
      }
      handleSubmit(next);
    }
  }

  const translateX = shake.interpolate({ inputRange: [-1, 1], outputRange: [-10, 10] });

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
        <View style={styles.logoCircle}>
          <Text style={styles.logoLetter}>B</Text>
        </View>
        <Text style={styles.title}>BoraFest Check-in</Text>
        <Text style={styles.subtitle}>Entre com o PIN fornecido pelo produtor do evento</Text>

        <Text style={styles.label}>ID do evento</Text>
        <TextInput
          style={styles.input}
          value={eventId}
          onChangeText={setEventId}
          placeholder="cole o ID do evento"
          placeholderTextColor={colors.textDim}
          autoCapitalize="none"
          autoCorrect={false}
          editable={!loading}
        />

        <Animated.View style={[styles.dotsRow, { transform: [{ translateX }] }]}>
          {Array.from({ length: PIN_LENGTH }).map((_, i) => (
            <View key={i} style={[styles.dot, i < pin.length && styles.dotFilled]} />
          ))}
        </Animated.View>

        {error ? <Text style={styles.error}>{error}</Text> : null}
        {loading ? <ActivityIndicator color={colors.primary} style={styles.loadingIndicator} /> : null}

        <View style={styles.keypad}>
          {KEYS.map((key, i) => (
            <Pressable
              key={i}
              style={[styles.key, key === "" && styles.keyGhost]}
              onPress={() => handleKeyPress(key)}
              disabled={key === "" || loading}
            >
              <Text style={styles.keyText}>{key === "back" ? "⌫" : key}</Text>
            </Pressable>
          ))}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  scrollContent: { flexGrow: 1, alignItems: "center", padding: 24, paddingTop: 56, paddingBottom: 32 },
  logoCircle: {
    width: 64,
    height: 64,
    borderRadius: 20,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
  },
  logoLetter: { color: "#fff", fontSize: 30, fontWeight: "800" },
  title: { fontSize: 24, fontWeight: "700", color: colors.text, marginBottom: 4 },
  subtitle: { fontSize: 13, color: colors.textMuted, marginBottom: 28, textAlign: "center" },
  label: { fontSize: 12, color: colors.textMuted, marginBottom: 6, alignSelf: "flex-start" },
  input: {
    width: "100%",
    backgroundColor: colors.surface,
    color: colors.text,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    marginBottom: 28,
  },
  dotsRow: { flexDirection: "row", gap: 14, marginBottom: 12 },
  dot: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: colors.border,
    backgroundColor: "transparent",
  },
  dotFilled: { backgroundColor: colors.primary, borderColor: colors.primary },
  error: { color: colors.danger, marginTop: 12, textAlign: "center" },
  loadingIndicator: { marginTop: 16 },
  keypad: {
    marginTop: 32,
    width: "100%",
    maxWidth: 320,
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
  },
  key: {
    width: "30%",
    aspectRatio: 1.6,
    marginBottom: 12,
    borderRadius: 14,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  keyGhost: { backgroundColor: "transparent" },
  keyText: { color: colors.text, fontSize: 22, fontWeight: "600" },
});
