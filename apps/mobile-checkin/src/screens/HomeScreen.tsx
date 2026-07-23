import React, { useCallback, useEffect, useState } from "react";
import { View, Text, Pressable, StyleSheet, ActivityIndicator, Alert } from "react-native";
import { useSession } from "../context/SessionContext";
import { countConfirmedCheckins, countPendingCheckins } from "../db/database";
import { syncManifest } from "../sync/manifestSync";
import { flushPendingCheckins } from "../sync/syncQueue";

interface Props {
  onOpenScanner: () => void;
  onOpenManualSearch: () => void;
}

export function HomeScreen({ onOpenScanner, onOpenManualSearch }: Props) {
  const { session, clearSession, setCheckinPoint } = useSession();
  const [confirmed, setConfirmed] = useState(0);
  const [pending, setPending] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [lastSyncError, setLastSyncError] = useState<string | null>(null);

  const refreshCounters = useCallback(() => {
    setConfirmed(countConfirmedCheckins());
    setPending(countPendingCheckins());
  }, []);

  useEffect(() => {
    refreshCounters();
    const interval = setInterval(refreshCounters, 2000);
    return () => clearInterval(interval);
  }, [refreshCounters]);

  if (!session) return null;

  async function handleSync() {
    setSyncing(true);
    setLastSyncError(null);
    try {
      await syncManifest(session!.event.id, {
        deviceId: session!.deviceId,
        deviceToken: session!.deviceToken,
      });
      const result = await flushPendingCheckins({
        deviceId: session!.deviceId,
        deviceToken: session!.deviceToken,
      });
      if (result.error) setLastSyncError(result.error);
      refreshCounters();
    } catch (err) {
      setLastSyncError(err instanceof Error ? err.message : "Falha ao sincronizar");
    } finally {
      setSyncing(false);
    }
  }

  function handleLogout() {
    Alert.alert("Sair", "Encerrar a sessão deste aparelho?", [
      { text: "Cancelar", style: "cancel" },
      { text: "Sair", style: "destructive", onPress: () => clearSession() },
    ]);
  }

  return (
    <View style={styles.container}>
      <Text style={styles.eventTitle}>{session.event.title}</Text>

      {session.checkinPoints.length > 1 ? (
        <View style={styles.gateRow}>
          {session.checkinPoints.map((point) => (
            <Pressable
              key={point.id}
              style={[styles.gateChip, session.checkinPointId === point.id && styles.gateChipActive]}
              onPress={() => setCheckinPoint(point.id)}
            >
              <Text style={styles.gateChipText}>{point.name}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      <View style={styles.counters}>
        <View style={styles.counterBox}>
          <Text style={styles.counterValue}>{confirmed}</Text>
          <Text style={styles.counterLabel}>confirmados</Text>
        </View>
        <View style={styles.counterBox}>
          <Text style={[styles.counterValue, pending > 0 && styles.counterValuePending]}>{pending}</Text>
          <Text style={styles.counterLabel}>na fila offline</Text>
        </View>
      </View>

      <Pressable style={styles.primaryButton} onPress={onOpenScanner}>
        <Text style={styles.primaryButtonText}>Escanear QR</Text>
      </Pressable>

      <Pressable style={styles.secondaryButton} onPress={onOpenManualSearch}>
        <Text style={styles.secondaryButtonText}>Busca manual</Text>
      </Pressable>

      <Pressable style={styles.syncButton} onPress={handleSync} disabled={syncing}>
        {syncing ? (
          <ActivityIndicator color="#111827" />
        ) : (
          <Text style={styles.syncButtonText}>
            Sincronizar manifesto {pending > 0 ? `(${pending} pendentes)` : ""}
          </Text>
        )}
      </Pressable>
      {lastSyncError ? <Text style={styles.error}>{lastSyncError}</Text> : null}

      <Pressable style={styles.logoutButton} onPress={handleLogout}>
        <Text style={styles.logoutText}>Sair deste aparelho</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#111827", padding: 20, paddingTop: 60 },
  eventTitle: { fontSize: 22, fontWeight: "700", color: "#fff", marginBottom: 16 },
  gateRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 16 },
  gateChip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20, backgroundColor: "#1f2937" },
  gateChipActive: { backgroundColor: "#22c55e" },
  gateChipText: { color: "#fff", fontSize: 13 },
  counters: { flexDirection: "row", gap: 12, marginVertical: 24 },
  counterBox: { flex: 1, backgroundColor: "#1f2937", borderRadius: 12, padding: 16, alignItems: "center" },
  counterValue: { fontSize: 32, fontWeight: "800", color: "#22c55e" },
  counterValuePending: { color: "#f59e0b" },
  counterLabel: { fontSize: 12, color: "#9ca3af", marginTop: 4 },
  primaryButton: { backgroundColor: "#22c55e", borderRadius: 10, paddingVertical: 16, alignItems: "center" },
  primaryButtonText: { color: "#052e16", fontWeight: "700", fontSize: 17 },
  secondaryButton: {
    backgroundColor: "#1f2937",
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: "center",
    marginTop: 12,
  },
  secondaryButtonText: { color: "#fff", fontWeight: "600", fontSize: 15 },
  syncButton: {
    backgroundColor: "#e5e7eb",
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: "center",
    marginTop: 24,
  },
  syncButtonText: { color: "#111827", fontWeight: "600" },
  error: { color: "#f87171", marginTop: 8, textAlign: "center" },
  logoutButton: { marginTop: "auto", alignItems: "center", paddingVertical: 16 },
  logoutText: { color: "#6b7280", fontSize: 13 },
});
