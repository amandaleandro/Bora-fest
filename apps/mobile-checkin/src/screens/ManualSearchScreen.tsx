import React, { useMemo, useState } from "react";
import { View, Text, TextInput, FlatList, Pressable, StyleSheet } from "react-native";
import { useSession } from "../context/SessionContext";
import { searchTicketsByCode, type LocalTicket } from "../db/database";
import { attemptCheckin, type CheckinAttemptResult } from "../checkin/attemptCheckin";
import { ResultBanner } from "../components/ResultBanner";
import { colors } from "../theme/colors";

/**
 * Busca manual por código curto do ingresso. O manifesto local não traz
 * nome/CPF do participante (ver docs/projeto/API-REFERENCE.md) — só o
 * caminho online (`POST /v1/checkins`) devolve o nome do comprador, então
 * a busca aqui é só por código.
 */
export function ManualSearchScreen() {
  const { session } = useSession();
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<CheckinAttemptResult | null>(null);
  const [busy, setBusy] = useState(false);

  const matches = useMemo(() => (query.trim().length >= 2 ? searchTicketsByCode(query.trim()) : []), [query]);

  if (!session) return null;

  async function handleSelect(ticket: LocalTicket) {
    if (busy) return;
    setBusy(true);
    try {
      const device = { deviceId: session!.deviceId, deviceToken: session!.deviceToken };
      const outcome = await attemptCheckin(device, { code: ticket.code }, session!.checkinPointId);
      setResult(outcome);
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Busca manual</Text>
      <TextInput
        style={styles.input}
        value={query}
        onChangeText={setQuery}
        placeholder="código do ingresso (ex.: BF-XXXX-XXXX)"
        placeholderTextColor={colors.textDim}
        autoCapitalize="characters"
        autoCorrect={false}
      />

      <FlatList
        data={matches}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <Pressable style={styles.row} onPress={() => handleSelect(item)}>
            <Text style={styles.rowCode}>{item.code}</Text>
            <Text style={styles.rowStatus}>{item.status}</Text>
          </Pressable>
        )}
        ListEmptyComponent={
          query.trim().length >= 2 ? <Text style={styles.empty}>Nenhum ingresso encontrado</Text> : null
        }
      />

      {result ? <ResultBanner result={result} onDismiss={() => setResult(null)} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg, padding: 20, paddingTop: 60 },
  title: { fontSize: 20, fontWeight: "700", color: colors.text, marginBottom: 16 },
  input: {
    backgroundColor: colors.surface,
    color: colors.text,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    marginBottom: 16,
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 14,
    paddingHorizontal: 4,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  rowCode: { color: colors.text, fontSize: 15, fontWeight: "600" },
  rowStatus: { color: colors.textMuted, fontSize: 13 },
  empty: { color: colors.textDim, textAlign: "center", marginTop: 24 },
});
