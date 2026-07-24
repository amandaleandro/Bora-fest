import React, { useCallback, useEffect, useState } from "react";
import { View, Text, FlatList, Pressable, StyleSheet, Alert } from "react-native";
import { countPendingCheckins, getMeta, listRecentCheckins, type RecentCheckin } from "../db/database";
import { colors } from "../theme/colors";

function formatDateTime(iso: string | null): string {
  if (!iso) return "nunca";
  try {
    return new Date(iso).toLocaleString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

/**
 * Resumo (D5): estado da fila offline, hora da última sincronização e os
 * check-ins recentes deste aparelho. A reversão de um check-in confirmado
 * (`POST /v1/checkins/:id/reverse`) exige sessão de usuário do produtor —
 * o aparelho de portaria só tem token de dispositivo — então aqui a ação
 * apenas explica que a reversão é feita no painel do produtor (portaria).
 */
export function SyncSummaryScreen() {
  const [pending, setPending] = useState(0);
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);
  const [recent, setRecent] = useState<RecentCheckin[]>([]);

  const refresh = useCallback(() => {
    setPending(countPendingCheckins());
    setLastSyncAt(getMeta("lastSyncAt"));
    setRecent(listRecentCheckins(30));
  }, []);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 3000);
    return () => clearInterval(interval);
  }, [refresh]);

  function handleRevert(item: RecentCheckin) {
    Alert.alert(
      "Reverter check-in",
      "A reversão exige login do produtor e fica registrada na auditoria — não é feita por este aparelho. Peça ao produtor para reverter pelo painel, na tela de portaria do evento.",
      [{ text: "Entendi" }],
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Resumo</Text>

      <View style={styles.statsRow}>
        <View style={styles.statBox}>
          <Text style={[styles.statValue, pending > 0 && styles.statValuePending]}>{pending}</Text>
          <Text style={styles.statLabel}>pendentes na fila</Text>
        </View>
        <View style={styles.statBox}>
          <Text style={styles.statValueSmall}>{formatDateTime(lastSyncAt)}</Text>
          <Text style={styles.statLabel}>última sincronização</Text>
        </View>
      </View>

      <Text style={styles.sectionTitle}>Check-ins recentes deste aparelho</Text>
      <FlatList
        data={recent}
        keyExtractor={(item) => item.ticket_id}
        renderItem={({ item }) => (
          <View style={styles.row}>
            <View>
              <Text style={styles.rowCode}>{item.code ?? item.ticket_id}</Text>
              <Text style={styles.rowTime}>{formatDateTime(item.confirmed_at)}</Text>
            </View>
            <Pressable style={styles.revertButton} onPress={() => handleRevert(item)}>
              <Text style={styles.revertText}>Reverter</Text>
            </Pressable>
          </View>
        )}
        ListEmptyComponent={<Text style={styles.empty}>Nenhum check-in confirmado ainda</Text>}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg, padding: 20, paddingTop: 60 },
  title: { fontSize: 20, fontWeight: "700", color: colors.text, marginBottom: 20 },
  statsRow: { flexDirection: "row", gap: 12, marginBottom: 24 },
  statBox: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: 16,
    alignItems: "center",
    borderWidth: 1,
    borderColor: colors.border,
  },
  statValue: { fontSize: 28, fontWeight: "800", color: colors.online },
  statValuePending: { color: colors.offline },
  statValueSmall: { fontSize: 15, fontWeight: "700", color: colors.text },
  statLabel: { fontSize: 11, color: colors.textMuted, marginTop: 6, textAlign: "center" },
  sectionTitle: { fontSize: 13, color: colors.textMuted, marginBottom: 8 },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  rowCode: { color: colors.text, fontSize: 14, fontWeight: "600" },
  rowTime: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
  revertButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
  },
  revertText: { color: colors.textMuted, fontSize: 12 },
  empty: { color: colors.textDim, textAlign: "center", marginTop: 24 },
});
