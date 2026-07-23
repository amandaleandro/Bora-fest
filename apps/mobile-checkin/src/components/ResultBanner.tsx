import React, { useEffect } from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import type { CheckinAttemptResult } from "../checkin/attemptCheckin";

const COLORS: Record<CheckinAttemptResult["outcome"], string> = {
  VALID: "#16a34a",
  ALREADY_USED: "#d97706",
  CANCELED: "#dc2626",
  INVALID: "#dc2626",
};

const LABELS: Record<CheckinAttemptResult["outcome"], string> = {
  VALID: "VÁLIDO",
  ALREADY_USED: "JÁ UTILIZADO",
  CANCELED: "CANCELADO",
  INVALID: "INVÁLIDO",
};

export function ResultBanner({
  result,
  onDismiss,
}: {
  result: CheckinAttemptResult;
  onDismiss: () => void;
}) {
  useEffect(() => {
    const timer = setTimeout(onDismiss, 3500);
    return () => clearTimeout(timer);
  }, [result, onDismiss]);

  return (
    <Pressable
      style={[styles.container, { backgroundColor: COLORS[result.outcome] }]}
      onPress={onDismiss}
    >
      <Text style={styles.label}>{LABELS[result.outcome]}</Text>
      {result.ticketCode ? <Text style={styles.code}>{result.ticketCode}</Text> : null}
      {result.attendeeName ? <Text style={styles.name}>{result.attendeeName}</Text> : null}
      <Text style={styles.message}>{result.message}</Text>
      {result.offline ? <Text style={styles.offline}>modo offline</Text> : null}
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
    padding: 24,
  },
  label: { fontSize: 40, fontWeight: "800", color: "#fff", marginBottom: 12 },
  code: { fontSize: 20, color: "#fff", fontWeight: "600" },
  name: { fontSize: 18, color: "#fff", marginTop: 4 },
  message: { fontSize: 15, color: "#ffffffcc", marginTop: 12, textAlign: "center" },
  offline: { fontSize: 12, color: "#fff", marginTop: 16, fontStyle: "italic" },
});
