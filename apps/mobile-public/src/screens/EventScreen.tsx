import React, { useEffect, useMemo, useState } from "react";
import { View, Text, Pressable, StyleSheet, ScrollView, ActivityIndicator } from "react-native";
import { api } from "../api/client";
import type { AvailabilityItem, PublicEvent } from "../api/types";
import { formatCents, formatDateTime } from "../format";

interface Props {
  slug: string;
  onBack: () => void;
  onReserved: (reservationId: string) => void;
}

export function EventScreen({ slug, onBack, onReserved }: Props) {
  const [event, setEvent] = useState<PublicEvent | null>(null);
  const [availability, setAvailability] = useState<Record<string, AvailabilityItem>>({});
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([api.getEvent(slug), api.getAvailability(slug)])
      .then(([eventData, availabilityData]) => {
        setEvent(eventData);
        setAvailability(Object.fromEntries(availabilityData.map((item) => [item.lotId, item])));
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Não foi possível carregar o evento"))
      .finally(() => setLoading(false));
  }, [slug]);

  const totalCents = useMemo(() => {
    if (!event) return 0;
    return event.ticketTypes.reduce(
      (sum, type) =>
        sum +
        type.lots.reduce((lotSum, lot) => lotSum + (quantities[lot.id] ?? 0) * (lot.priceCents + lot.feeCents), 0),
      0,
    );
  }, [event, quantities]);

  const totalQuantity = Object.values(quantities).reduce((sum, qty) => sum + qty, 0);

  function setQuantity(lotId: string, value: number, max: number) {
    setQuantities((prev) => ({ ...prev, [lotId]: Math.max(0, Math.min(value, max)) }));
  }

  async function handleReserve() {
    if (!event) return;
    setError(null);
    const items = Object.entries(quantities)
      .filter(([, qty]) => qty > 0)
      .map(([ticketLotId, quantity]) => ({ ticketLotId, quantity }));
    if (items.length === 0) {
      setError("Selecione ao menos um ingresso");
      return;
    }
    setSubmitting(true);
    try {
      const reservation = await api.createReservation(event.id, items);
      onReserved(reservation.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível reservar — tente novamente");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color="#22c55e" />
      </View>
    );
  }

  if (!event) {
    return (
      <View style={styles.center}>
        <Text style={styles.error}>{error ?? "Evento não encontrado"}</Text>
        <Pressable onPress={onBack}>
          <Text style={styles.backLink}>‹ Voltar</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: 120 }}>
      <Pressable onPress={onBack} style={styles.backButton}>
        <Text style={styles.backLink}>‹ Eventos</Text>
      </Pressable>

      <Text style={styles.title}>{event.title}</Text>
      <Text style={styles.subtitle}>{formatDateTime(event.startsAt, event.timezone)}</Text>
      {event.venue ? (
        <Text style={styles.subtitle}>
          {event.venue.name} — {event.venue.city}/{event.venue.state}
        </Text>
      ) : null}
      {event.description ? <Text style={styles.description}>{event.description}</Text> : null}

      <Text style={styles.sectionTitle}>Ingressos</Text>
      {event.ticketTypes.map((type) => (
        <View key={type.id} style={{ marginTop: 12 }}>
          <Text style={styles.typeName}>{type.name}</Text>
          {type.lots.map((lot) => {
            const available = availability[lot.id]?.available ?? 0;
            const quantity = quantities[lot.id] ?? 0;
            const soldOut = available === 0;
            return (
              <View key={lot.id} style={styles.lotRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.lotName}>{lot.name}</Text>
                  <Text style={styles.lotPrice}>{formatCents(lot.priceCents + lot.feeCents)}</Text>
                  {soldOut ? <Text style={styles.soldOut}>esgotado</Text> : null}
                </View>
                <View style={styles.stepper}>
                  <Pressable
                    style={styles.stepperButton}
                    onPress={() => setQuantity(lot.id, quantity - 1, available)}
                    disabled={quantity === 0}
                  >
                    <Text style={styles.stepperText}>−</Text>
                  </Pressable>
                  <Text style={styles.stepperValue}>{quantity}</Text>
                  <Pressable
                    style={styles.stepperButton}
                    onPress={() => setQuantity(lot.id, quantity + 1, available)}
                    disabled={soldOut || quantity >= available}
                  >
                    <Text style={styles.stepperText}>+</Text>
                  </Pressable>
                </View>
              </View>
            );
          })}
        </View>
      ))}

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <View style={styles.footer}>
        <Text style={styles.totalValue}>{formatCents(totalCents)}</Text>
        <Pressable
          style={[styles.continueButton, totalQuantity === 0 && styles.continueButtonDisabled]}
          onPress={handleReserve}
          disabled={submitting || totalQuantity === 0}
        >
          <Text style={styles.continueButtonText}>{submitting ? "Reservando..." : "Continuar"}</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#111827" },
  center: { flex: 1, backgroundColor: "#111827", justifyContent: "center", alignItems: "center", padding: 24 },
  backButton: { paddingTop: 56, paddingHorizontal: 20 },
  backLink: { color: "#9ca3af", fontSize: 14 },
  title: { fontSize: 24, fontWeight: "800", color: "#fff", paddingHorizontal: 20, marginTop: 12 },
  subtitle: { fontSize: 14, color: "#9ca3af", paddingHorizontal: 20, marginTop: 4 },
  description: { fontSize: 14, color: "#d1d5db", paddingHorizontal: 20, marginTop: 12 },
  sectionTitle: { fontSize: 16, fontWeight: "700", color: "#fff", paddingHorizontal: 20, marginTop: 24 },
  typeName: { fontSize: 13, color: "#9ca3af", paddingHorizontal: 20, marginBottom: 6 },
  lotRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#1f2937",
    marginHorizontal: 20,
    marginBottom: 8,
    borderRadius: 10,
    padding: 14,
  },
  lotName: { color: "#fff", fontWeight: "600" },
  lotPrice: { color: "#9ca3af", fontSize: 13, marginTop: 2 },
  soldOut: { color: "#f87171", fontSize: 12, marginTop: 2 },
  stepper: { flexDirection: "row", alignItems: "center", gap: 10 },
  stepperButton: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: "#374151",
    alignItems: "center",
    justifyContent: "center",
  },
  stepperText: { color: "#fff", fontSize: 16 },
  stepperValue: { color: "#fff", width: 20, textAlign: "center" },
  error: { color: "#f87171", paddingHorizontal: 20, marginTop: 12 },
  footer: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
    marginTop: 24,
  },
  totalValue: { color: "#fff", fontSize: 18, fontWeight: "700" },
  continueButton: { backgroundColor: "#22c55e", borderRadius: 10, paddingVertical: 14, paddingHorizontal: 28 },
  continueButtonDisabled: { opacity: 0.4 },
  continueButtonText: { color: "#052e16", fontWeight: "700" },
});
