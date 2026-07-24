import React from "react";
import { View, Text, ScrollView, StyleSheet } from "react-native";
import { colors } from "../theme/colors";

/** Tela estática de privacidade/LGPD (D5) — o app não coleta dados fora do necessário para validar entrada. */
export function PrivacyScreen() {
  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Privacidade</Text>

      <Text style={styles.paragraph}>
        Este aplicativo é usado pela equipe de portaria para validar ingressos e armazena
        localmente, apenas neste aparelho, o mínimo necessário para funcionar offline: o código,
        o status e o lote de cada ingresso do evento (manifesto), além da fila de check-ins ainda
        não sincronizados.
      </Text>

      <Text style={styles.sectionTitle}>O que fica no aparelho</Text>
      <Text style={styles.paragraph}>
        • Código e status dos ingressos do evento atual (sem nome, CPF ou dados de pagamento).{"\n"}
        • Fila de check-ins feitos offline, até sincronizar com o servidor.{"\n"}
        • Credenciais do dispositivo (token), usadas para autenticar chamadas à API.
      </Text>

      <Text style={styles.sectionTitle}>O que não fica no aparelho</Text>
      <Text style={styles.paragraph}>
        • Dados pessoais do comprador/participante — nome e tipo de ingresso só aparecem na tela
        durante a validação online e não são gravados no banco local.{"\n"}
        • Imagens da câmera — usadas só para ler o QR em tempo real, nunca armazenadas ou enviadas.
      </Text>

      <Text style={styles.sectionTitle}>Reversão de check-in</Text>
      <Text style={styles.paragraph}>
        Reverter um check-in confirmado exige login do produtor no painel web e fica registrado em
        auditoria — não pode ser feito por este aparelho de portaria.
      </Text>

      <Text style={styles.sectionTitle}>Saindo deste aparelho</Text>
      <Text style={styles.paragraph}>
        Ao encerrar a sessão ("Sair deste aparelho"), o token local é apagado. Os dados do
        manifesto e da fila continuam no app até uma nova sincronização ou reinstalação.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 20, paddingTop: 60, paddingBottom: 60 },
  title: { fontSize: 22, fontWeight: "700", color: colors.text, marginBottom: 20 },
  sectionTitle: { fontSize: 14, fontWeight: "700", color: colors.text, marginTop: 20, marginBottom: 8 },
  paragraph: { fontSize: 14, color: colors.textMuted, lineHeight: 21 },
});
