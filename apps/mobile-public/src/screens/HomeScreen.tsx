import React, { useEffect, useState } from "react";
import { View, Text, FlatList, Pressable, StyleSheet, ActivityIndicator, RefreshControl } from "react-native";
import { api } from "../api/client";
import type { EventSummary } from "../api/types";
import { formatCents, formatDateTime } from "../format";
import { useAuth } from "../context/AuthContext";

interface Props {
  onOpenEvent: (slug: string) => void;
  onOpenMyTickets: () => void;
}

export function HomeScreen({ onOpenEvent, onOpenMyTickets }: Props) {
  const { user } = useAuth();
  const [events, setEvents] = useState<EventSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setError(null);
    try {
      const response = await api.listEvents();
      setEvents(response.events);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível carregar os eventos");
    }
  }

  useEffect(() => {
    load().finally(() => setLoading(false));
  }, []);

  async function handleRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>BoraFest</Text>
        <Pressable onPress={onOpenMyTickets}>
          <Text style={styles.myTickets}>{user ? "Meus ingressos" : "Entrar"}</Text>
        </Pressable>
      </View>

      {loading ? (
        <ActivityIndicator style={{ marginTop: 40 }} color="#22c55e" />
      ) : error ? (
        <Text style={styles.error}>{error}</Text>
      ) : (
        <FlatList
          data={events}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
          ListEmptyComponent={<Text style={styles.empty}>Nenhum evento publicado no momento.</Text>}
          renderItem={({ item }) => (
            <Pressable style={styles.card} onPress={() => onOpenEvent(item.slug)}>
              <Text style={styles.cardTitle}>{item.title}</Text>
              <Text style={styles.cardDate}>{formatDateTime(item.startsAt, item.timezone)}</Text>
              {item.venue ? (
                <Text style={styles.cardVenue}>
                  {item.venue.name} — {item.venue.city}/{item.venue.state}
                </Text>
              ) : null}
              {item.fromPriceCents != null ? (
                <Text style={styles.cardPrice}>a partir de {formatCents(item.fromPriceCents)}</Text>
              ) : null}
            </Pressable>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#111827", paddingTop: 56 },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 20 },
  title: { fontSize: 26, fontWeight: "800", color: "#fff" },
  myTickets: { color: "#22c55e", fontSize: 14, fontWeight: "600" },
  list: { padding: 20, gap: 12 },
  card: { backgroundColor: "#1f2937", borderRadius: 14, padding: 16 },
  cardTitle: { fontSize: 18, fontWeight: "700", color: "#fff" },
  cardDate: { fontSize: 13, color: "#9ca3af", marginTop: 4 },
  cardVenue: { fontSize: 13, color: "#9ca3af", marginTop: 2 },
  cardPrice: { fontSize: 14, color: "#22c55e", marginTop: 8, fontWeight: "600" },
  empty: { color: "#6b7280", textAlign: "center", marginTop: 60 },
  error: { color: "#f87171", textAlign: "center", marginTop: 40 },
});
