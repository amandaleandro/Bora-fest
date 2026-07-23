import React, { useEffect, useState } from "react";
import { View, Text, Pressable, StyleSheet, ScrollView, ActivityIndicator } from "react-native";
import QRCode from "react-native-qrcode-svg";
import { api } from "../api/client";
import type { Order, OrderTicket } from "../api/types";
import { formatCents } from "../format";

interface Props {
  publicToken: string;
  onBackHome: () => void;
}

export function WalletScreen({ publicToken, onBackHome }: Props) {
  const [order, setOrder] = useState<Order | null>(null);
  const [tickets, setTickets] = useState<OrderTicket[]>([]);
  const [loading, setLoading] = useState(true);
  const [resendMessage, setResendMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let interval: ReturnType<typeof setInterval> | undefined;

    async function load() {
      try {
        const current = await api.getOrderStatus(publicToken);
        if (cancelled) return;
        setOrder(current);
        if (current.status === "FULFILLED") {
          const ticketsResponse = await api.getOrderTickets(publicToken);
          if (!cancelled) setTickets(ticketsResponse.tickets);
          if (interval) clearInterval(interval);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    interval = setInterval(load, 4000);
    return () => {
      cancelled = true;
      if (interval) clearInterval(interval);
    };
  }, [publicToken]);

  async function handleResend() {
    setResendMessage(null);
    try {
      const result = await api.resendTickets(publicToken);
      setResendMessage(`Reenviado por ${result.channels.join(" e ")}`);
    } catch (err) {
      setResendMessage(err instanceof Error ? err.message : "Não foi possível reenviar");
    }
  }

  if (loading && !order) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color="#22c55e" />
      </View>
    );
  }

  if (!order) {
    return (
      <View style={styles.center}>
        <Text style={styles.title}>Pedido não encontrado</Text>
      </View>
    );
  }

  if (order.status !== "FULFILLED") {
    return (
      <View style={styles.center}>
        <Text style={styles.title}>Aguardando confirmação do pagamento</Text>
        <Text style={styles.subtitle}>Status: {order.status}</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: 20, paddingTop: 60 }}>
      <Text style={styles.title}>Seus ingressos</Text>
      <Text style={styles.subtitle}>
        {order.contactName ? `${order.contactName} · ` : ""}
        {order.contactEmail}
      </Text>
      <Text style={styles.subtitleMuted}>Total pago: {formatCents(order.totalCents)}</Text>

      {tickets.map((ticket) => (
        <View key={ticket.id} style={styles.ticketCard}>
          <View style={styles.qrBox}>
            <QRCode value={ticket.qrToken} size={180} />
          </View>
          <Text style={styles.ticketCode}>{ticket.code}</Text>
          <Text style={styles.ticketMeta}>
            {ticket.typeName} — {ticket.lotName}
          </Text>
          {ticket.attendeeName ? <Text style={styles.ticketMeta}>{ticket.attendeeName}</Text> : null}
          <Text style={styles.ticketStatus}>{ticket.status}</Text>
        </View>
      ))}

      <Pressable style={styles.resendButton} onPress={handleResend}>
        <Text style={styles.resendButtonText}>Reenviar por e-mail/WhatsApp</Text>
      </Pressable>
      {resendMessage ? <Text style={styles.resendMessage}>{resendMessage}</Text> : null}

      <Pressable style={styles.homeButton} onPress={onBackHome}>
        <Text style={styles.homeButtonText}>Voltar para eventos</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#111827" },
  center: { flex: 1, backgroundColor: "#111827", justifyContent: "center", alignItems: "center", padding: 24 },
  title: { fontSize: 20, fontWeight: "700", color: "#fff" },
  subtitle: { fontSize: 14, color: "#9ca3af", marginTop: 4 },
  subtitleMuted: { fontSize: 13, color: "#6b7280", marginTop: 2 },
  ticketCard: { backgroundColor: "#1f2937", borderRadius: 14, padding: 20, marginTop: 20, alignItems: "center" },
  qrBox: { backgroundColor: "#fff", padding: 16, borderRadius: 12 },
  ticketCode: { color: "#fff", fontSize: 18, fontWeight: "700", marginTop: 14 },
  ticketMeta: { color: "#9ca3af", fontSize: 13, marginTop: 2 },
  ticketStatus: { color: "#6b7280", fontSize: 11, marginTop: 6 },
  resendButton: { marginTop: 28, backgroundColor: "#1f2937", borderRadius: 10, paddingVertical: 14, alignItems: "center" },
  resendButtonText: { color: "#d1d5db", fontSize: 14, fontWeight: "600" },
  resendMessage: { color: "#9ca3af", fontSize: 13, textAlign: "center", marginTop: 8 },
  homeButton: { marginTop: 12, paddingVertical: 14, alignItems: "center" },
  homeButtonText: { color: "#6b7280", fontSize: 13 },
});
