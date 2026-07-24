import React, { useCallback, useEffect, useState } from "react";
import { View, Text, Pressable, StyleSheet, ActivityIndicator, Alert } from "react-native";
import { useSession } from "../context/SessionContext";
import { countConfirmedCheckins, countPendingCheckins, setMeta } from "../db/database";
import { syncManifest } from "../sync/manifestSync";
import { flushPendingCheckins } from "../sync/syncQueue";
import { colors } from "../theme/colors";

interface Props {
  onOpenScanner: () => void;
  onOpenManualSearch: () => void;
  onOpenSummary: () => void;
  onOpenPrivacy: () => void;
}

export function HomeScreen({ onOpenScanner, onOpenManualSearch, onOpenSummary, onOpenPrivacy }: Props) {
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
      else setMeta("lastSyncAt", new Date().toISOString());
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
              <Text
                style={[styles.gateChipText, session.checkinPointId === point.id && styles.gateChipTextActive]}
              >
                {point.name}
              </Text>
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

      <Pressable style={styles.secondaryButton} onPress={onOpenSummary}>
        <Text style={styles.secondaryButtonText}>Resumo & fila offline</Text>
      </Pressable>

      <Pressable style={styles.syncButton} onPress={handleSync} disabled={syncing}>
        {syncing ? (
          <ActivityIndicator color={colors.bg} />
        ) : (
          <Text style={styles.syncButtonText}>
            Sincronizar manifesto {pending > 0 ? `(${pending} pendentes)` : ""}
          </Text>
        )}
      </Pressable>
      {lastSyncError ? <Text style={styles.error}>{lastSyncError}</Text> : null}

      <View style={styles.footerRow}>
        <Pressable onPress={onOpenPrivacy}>
          <Text style={styles.footerLink}>Privacidade</Text>
        </Pressable>
        <Pressable onPress={handleLogout}>
          <Text style={styles.footerLink}>Sair deste aparelho</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg, padding: 20, paddingTop: 60 },
  eventTitle: { fontSize: 22, fontWeight: "700", color: colors.text, marginBottom: 16 },
  gateRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 16 },
  gateChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  gateChipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  gateChipText: { color: colors.textMuted, fontSize: 13 },
  gateChipTextActive: { color: "#fff", fontWeight: "600" },
  counters: { flexDirection: "row", gap: 12, marginVertical: 24 },
  counterBox: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: 18,
    alignItems: "center",
    borderWidth: 1,
    borderColor: colors.border,
  },
  counterValue: { fontSize: 32, fontWeight: "800", color: colors.online },
  counterValuePending: { color: colors.offline },
  counterLabel: { fontSize: 12, color: colors.textMuted, marginTop: 4 },
  primaryButton: { backgroundColor: colors.primary, borderRadius: 14, paddingVertical: 16, alignItems: "center" },
  primaryButtonText: { color: "#fff", fontWeight: "700", fontSize: 17 },
  secondaryButton: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: "center",
    marginTop: 12,
    borderWidth: 1,
    borderColor: colors.border,
  },
  secondaryButtonText: { color: colors.text, fontWeight: "600", fontSize: 15 },
  syncButton: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: "center",
    marginTop: 24,
  },
  syncButtonText: { color: colors.text, fontWeight: "600" },
  error: { color: colors.danger, marginTop: 8, textAlign: "center" },
  footerRow: {
    marginTop: "auto",
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 16,
  },
  footerLink: { color: colors.textDim, fontSize: 13 },
});
