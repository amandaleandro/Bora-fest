import React, { useEffect } from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import type { CheckinAttemptResult } from "../checkin/attemptCheckin";
import { colors } from "../theme/colors";

const STATE: Record<
  CheckinAttemptResult["outcome"],
  { bg: string; accent: string; icon: string; label: string }
> = {
  VALID: { bg: colors.successBg, accent: colors.success, icon: "✓", label: "VÁLIDO" },
  ALREADY_USED: { bg: colors.warningBg, accent: colors.warning, icon: "⏱", label: "JÁ UTILIZADO" },
  CANCELED: { bg: colors.dangerBg, accent: colors.danger, icon: "✕", label: "CANCELADO" },
  INVALID: { bg: colors.dangerBg, accent: colors.danger, icon: "✕", label: "INVÁLIDO" },
};

function formatTime(iso?: string | null): string | null {
  if (!iso) return null;
  try {
    return new Date(iso).toLocaleString("pt-BR", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" });
  } catch {
    return null;
  }
}

/** Resultado em tela cheia (D4) — o antigo banner sobreposto virou o estado principal da tela. */
export function ResultBanner({
  result,
  onDismiss,
}: {
  result: CheckinAttemptResult;
  onDismiss: () => void;
}) {
  useEffect(() => {
    const timer = setTimeout(onDismiss, 4000);
    return () => clearTimeout(timer);
  }, [result, onDismiss]);

  const state = STATE[result.outcome];
  const previousAt = formatTime(result.previousCheckinAt);

  return (
    <Pressable style={[styles.container, { backgroundColor: state.bg }]} onPress={onDismiss}>
      <View style={[styles.iconCircle, { borderColor: state.accent }]}>
        <Text style={[styles.icon, { color: state.accent }]}>{state.icon}</Text>
      </View>
      <Text style={[styles.label, { color: state.accent }]}>{state.label}</Text>

      {result.attendeeName ? <Text style={styles.name}>{result.attendeeName}</Text> : null}
      {result.ticketType ? <Text style={styles.ticketType}>{result.ticketType}</Text> : null}
      {result.ticketCode ? <Text style={styles.code}>{result.ticketCode}</Text> : null}

      <Text style={styles.message}>{result.message}</Text>
      {result.outcome === "ALREADY_USED" && previousAt ? (
        <Text style={styles.detail}>Check-in original: {previousAt}</Text>
      ) : null}
      {result.offline ? <Text style={styles.offline}>modo offline</Text> : null}

      <Pressable style={[styles.continueButton, { borderColor: state.accent }]} onPress={onDismiss}>
        <Text style={[styles.continueText, { color: state.accent }]}>Continuar escaneando</Text>
      </Pressable>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: "center",
    alignItems: "center",
    padding: 32,
  },
  iconCircle: {
    width: 88,
    height: 88,
    borderRadius: 44,
    borderWidth: 3,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 20,
  },
  icon: { fontSize: 44, fontWeight: "800" },
  label: { fontSize: 32, fontWeight: "800", marginBottom: 16, letterSpacing: 1 },
  name: { fontSize: 22, color: "#fff", fontWeight: "700", textAlign: "center" },
  ticketType: { fontSize: 15, color: "#ffffffb0", marginTop: 4 },
  code: { fontSize: 16, color: "#ffffffcc", fontWeight: "600", marginTop: 8 },
  message: { fontSize: 15, color: "#ffffffcc", marginTop: 16, textAlign: "center" },
  detail: { fontSize: 13, color: "#ffffffaa", marginTop: 8, textAlign: "center" },
  offline: { fontSize: 12, color: "#fff", marginTop: 16, fontStyle: "italic" },
  continueButton: {
    marginTop: 32,
    borderWidth: 1.5,
    borderRadius: 12,
    paddingHorizontal: 24,
    paddingVertical: 12,
  },
  continueText: { fontWeight: "700", fontSize: 14 },
});
