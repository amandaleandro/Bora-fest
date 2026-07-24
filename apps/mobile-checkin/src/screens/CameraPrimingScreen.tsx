import React, { useEffect, useState } from "react";
import { View, Text, Pressable, StyleSheet, Linking } from "react-native";
import { useCameraPermissions } from "expo-camera";
import { colors } from "../theme/colors";

interface Props {
  onReady: () => void;
  onCancel: () => void;
}

/**
 * Passo de "priming": pede a permissão da câmera antes de entrar no scanner,
 * com uma explicação amigável se for negada (em vez do app abrir a câmera
 * "no escuro" e o usuário não entender por que não funciona).
 */
export function CameraPrimingScreen({ onReady, onCancel }: Props) {
  const [permission, requestPermission] = useCameraPermissions();
  const [asked, setAsked] = useState(false);

  useEffect(() => {
    if (permission?.granted) {
      onReady();
    }
  }, [permission?.granted, onReady]);

  if (!permission) {
    return <View style={styles.container} />;
  }

  const canAskAgain = permission.canAskAgain;

  async function handleRequest() {
    setAsked(true);
    const result = await requestPermission();
    if (result.granted) onReady();
  }

  return (
    <View style={styles.container}>
      <View style={styles.iconCircle}>
        <Text style={styles.icon}>📷</Text>
      </View>
      <Text style={styles.title}>Precisamos da câmera</Text>
      <Text style={styles.message}>
        Ela é usada apenas para ler o QR code do ingresso na entrada — nenhuma imagem é
        armazenada ou enviada.
      </Text>

      {asked && !permission.granted && !canAskAgain ? (
        <>
          <Text style={styles.denied}>
            A permissão foi negada. Abra as configurações do aparelho para liberar a câmera.
          </Text>
          <Pressable style={styles.button} onPress={() => Linking.openSettings()}>
            <Text style={styles.buttonText}>Abrir configurações</Text>
          </Pressable>
        </>
      ) : (
        <Pressable style={styles.button} onPress={handleRequest}>
          <Text style={styles.buttonText}>Permitir câmera</Text>
        </Pressable>
      )}

      <Pressable style={styles.cancelButton} onPress={onCancel}>
        <Text style={styles.cancelText}>Voltar</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg, alignItems: "center", justifyContent: "center", padding: 32 },
  iconCircle: {
    width: 84,
    height: 84,
    borderRadius: 24,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 24,
  },
  icon: { fontSize: 36 },
  title: { color: colors.text, fontSize: 20, fontWeight: "700", marginBottom: 12 },
  message: { color: colors.textMuted, fontSize: 14, textAlign: "center", lineHeight: 20, marginBottom: 28 },
  denied: { color: colors.warning, fontSize: 13, textAlign: "center", marginBottom: 16 },
  button: { backgroundColor: colors.primary, borderRadius: 12, paddingHorizontal: 28, paddingVertical: 14 },
  buttonText: { color: "#fff", fontWeight: "700", fontSize: 15 },
  cancelButton: { marginTop: 20, padding: 12 },
  cancelText: { color: colors.textDim, fontSize: 14 },
});
