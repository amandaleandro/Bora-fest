import React, { useMemo, useState } from "react";
import { View, Text, TextInput, FlatList, Pressable, StyleSheet, ActivityIndicator } from "react-native";
import { api } from "../api/client";
import type { CheckinResponse, FaceCapabilities } from "../api/types";
import { ResultBanner } from "../components/ResultBanner";
import { useSession } from "../context/SessionContext";
import { recordConfirmedCheckin, searchTicketsByCode, type LocalTicket } from "../db/database";
import { captureFaceProbe } from "../face/provider";
import { colors } from "../theme/colors";

interface Props {
  capabilities: FaceCapabilities;
}

export function FaceCheckinScreen({ capabilities }: Props) {
  const { session } = useSession();
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{
    outcome: CheckinResponse["result"];
    offline: false;
    ticketCode?: string;
    attendeeName?: string | null;
    ticketType?: string | null;
    previousCheckinAt?: string | null;
    message: string;
  } | null>(null);

  const matches = useMemo(
    () => (query.trim().length >= 2 ? searchTicketsByCode(query.trim()) : []),
    [query],
  );

  if (!session || !capabilities.provider) return null;

  async function handleSelect(ticket: LocalTicket) {
    if (busy) return;
    setBusy(true);
    setResult(null);
    try {
      const probeReference = await captureFaceProbe(capabilities.provider!, ticket.id);
      const response = await api.faceCheckin(
        { deviceId: session!.deviceId, deviceToken: session!.deviceToken },
        {
          ticketId: ticket.id,
          probeReference,
          checkinPointId: session!.checkinPointId,
          scannedAt: new Date().toISOString(),
        },
      );

      if (response.result === "VALID") {
        recordConfirmedCheckin(ticket.id, response.checkinId);
      }

      const reason = response.reason;
      const message =
        response.result === "VALID"
          ? "Rosto confirmado · entrada liberada"
          : response.result === "ALREADY_USED"
            ? "Ingresso já utilizado"
            : reason === "FACE_NOT_ENROLLED"
              ? "Este ingresso não cadastrou check-in facial"
              : reason === "FACE_NO_MATCH"
                ? "O rosto não corresponde ao cadastro deste ingresso"
                : reason === "FACE_LIVENESS_FAILED"
                  ? "Não foi possível confirmar presença real. Use QR ou busca manual."
                  : "Não foi possível liberar por facial. Use QR ou busca manual.";

      setResult({
        outcome: response.result,
        offline: false,
        ticketCode: response.ticket?.code ?? ticket.code,
        attendeeName: response.ticket?.attendeeName,
        ticketType: response.ticket?.typeName ?? response.ticket?.lotName,
        previousCheckinAt: response.firstCheckin?.at ?? null,
        message,
      });
    } catch (error) {
      setResult({
        outcome: "INVALID",
        offline: false,
        ticketCode: ticket.code,
        message: error instanceof Error ? error.message : "Falha no check-in facial",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Check-in facial</Text>
      <Text style={styles.help}>
        Identifique primeiro o ingresso e depois confirme o rosto. O facial é opcional; QR e busca manual continuam disponíveis.
      </Text>

      <TextInput
        style={styles.input}
        value={query}
        onChangeText={setQuery}
        placeholder="código do ingresso"
        placeholderTextColor={colors.textDim}
        autoCapitalize="characters"
        autoCorrect={false}
      />

      {busy ? <ActivityIndicator color={colors.primary} style={styles.busy} /> : null}

      <FlatList
        data={matches}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <Pressable style={styles.row} disabled={busy} onPress={() => handleSelect(item)}>
            <View>
              <Text style={styles.rowCode}>{item.code}</Text>
              <Text style={styles.rowHint}>Toque para abrir a câmera facial</Text>
            </View>
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
  title: { fontSize: 20, fontWeight: "700", color: colors.text },
  help: { color: colors.textMuted, fontSize: 13, lineHeight: 19, marginTop: 8, marginBottom: 16 },
  input: {
    backgroundColor: colors.surface,
    color: colors.text,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    marginBottom: 12,
  },
  busy: { marginVertical: 8 },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  rowCode: { color: colors.text, fontSize: 15, fontWeight: "600" },
  rowHint: { color: colors.textDim, fontSize: 11, marginTop: 3 },
  rowStatus: { color: colors.textMuted, fontSize: 13 },
  empty: { color: colors.textDim, textAlign: "center", marginTop: 24 },
});
