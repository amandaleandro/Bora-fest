import React, { useEffect, useState } from "react";
import { View, Text, Pressable, StyleSheet, ScrollView, ActivityIndicator } from "react-native";
import QRCode from "react-native-qrcode-svg";
import { api } from "../api/client";
import type { MyTicket } from "../api/types";
import { formatDateTime } from "../format";
import { useAuth } from "../context/AuthContext";

interface Props {
  onBack: () => void;
}

export function MyTicketsScreen({ onBack }: Props) {
  const { token, logout } = useAuth();
  const [tickets, setTickets] = useState<MyTicket[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    api
      .getMyTickets(token)
      .then(setTickets)
      .catch((err) => setError(err instanceof Error ? err.message : "Não foi possível carregar"))
      .finally(() => setLoading(false));
  }, [token]);

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: 20, paddingTop: 60 }}>
      <View style={styles.header}>
        <Pressable onPress={onBack}>
          <Text style={styles.backLink}>‹ Eventos</Text>
        </Pressable>
        <Pressable onPress={() => logout().then(onBack)}>
          <Text style={styles.logoutLink}>Sair</Text>
        </Pressable>
      </View>

      <Text style={styles.title}>Meus ingressos</Text>

      {loading ? (
        <ActivityIndicator style={{ marginTop: 40 }} color="#22c55e" />
      ) : error ? (
        <Text style={styles.error}>{error}</Text>
      ) : tickets.length === 0 ? (
        <Text style={styles.empty}>Nenhum ingresso encontrado nesta conta.</Text>
      ) : (
        tickets.map((ticket) => (
          <View key={ticket.id} style={styles.ticketCard}>
            <View style={styles.qrBox}>
              <QRCode value={ticket.qrToken} size={160} />
            </View>
            <Text style={styles.eventTitle}>{ticket.event.title}</Text>
            <Text style={styles.meta}>{formatDateTime(ticket.event.startsAt)}</Text>
            <Text style={styles.code}>{ticket.code}</Text>
            <Text style={styles.meta}>
              {ticket.typeName} — {ticket.lotName}
            </Text>
            <Text style={styles.status}>{ticket.status}</Text>
          </View>
        ))
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#111827" },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  backLink: { color: "#9ca3af", fontSize: 14 },
  logoutLink: { color: "#6b7280", fontSize: 13 },
  title: { fontSize: 22, fontWeight: "700", color: "#fff", marginTop: 16 },
  error: { color: "#f87171", marginTop: 24 },
  empty: { color: "#6b7280", marginTop: 40, textAlign: "center" },
  ticketCard: { backgroundColor: "#1f2937", borderRadius: 14, padding: 20, marginTop: 20, alignItems: "center" },
  qrBox: { backgroundColor: "#fff", padding: 14, borderRadius: 12 },
  eventTitle: { color: "#fff", fontSize: 16, fontWeight: "700", marginTop: 14 },
  meta: { color: "#9ca3af", fontSize: 13, marginTop: 2 },
  code: { color: "#fff", fontSize: 15, fontWeight: "600", marginTop: 8 },
  status: { color: "#6b7280", fontSize: 11, marginTop: 4 },
});
