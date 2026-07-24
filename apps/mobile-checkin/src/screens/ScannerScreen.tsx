import React, { useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, Pressable, Animated, Easing } from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import { useSession } from "../context/SessionContext";
import { attemptCheckin, type CheckinAttemptResult } from "../checkin/attemptCheckin";
import { ResultBanner } from "../components/ResultBanner";
import { countPendingCheckins } from "../db/database";
import { colors } from "../theme/colors";

export function ScannerScreen() {
  const { session } = useSession();
  const [permission, requestPermission] = useCameraPermissions();
  const [result, setResult] = useState<CheckinAttemptResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [torch, setTorch] = useState(false);
  const [online, setOnline] = useState(true);
  const [pending, setPending] = useState(0);
  const lastScanRef = useRef<{ value: string; at: number } | null>(null);
  const scanline = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(scanline, { toValue: 1, duration: 1800, easing: Easing.linear, useNativeDriver: true }),
        Animated.timing(scanline, { toValue: 0, duration: 0, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [scanline]);

  useEffect(() => {
    setPending(countPendingCheckins());
    const interval = setInterval(() => setPending(countPendingCheckins()), 2000);
    return () => clearInterval(interval);
  }, []);

  if (!session) return null;

  async function handleScan(value: string) {
    const now = Date.now();
    // debounce simples: mesmo QR na câmera por alguns frames não deve
    // disparar várias tentativas seguidas.
    if (lastScanRef.current && lastScanRef.current.value === value && now - lastScanRef.current.at < 3000) {
      return;
    }
    lastScanRef.current = { value, at: now };

    if (busy) return;
    setBusy(true);
    try {
      const device = { deviceId: session!.deviceId, deviceToken: session!.deviceToken };
      const outcome = await attemptCheckin(device, { qrToken: value }, session!.checkinPointId);
      setOnline(!outcome.offline);
      setPending(countPendingCheckins());
      setResult(outcome);
    } finally {
      setBusy(false);
    }
  }

  if (!permission) {
    return <View style={styles.container} />;
  }

  if (!permission.granted) {
    return (
      <View style={[styles.container, styles.center]}>
        <Text style={styles.message}>Precisamos da câmera para ler o QR do ingresso.</Text>
        <Pressable style={styles.button} onPress={requestPermission}>
          <Text style={styles.buttonText}>Permitir câmera</Text>
        </Pressable>
      </View>
    );
  }

  const translateY = scanline.interpolate({ inputRange: [0, 1], outputRange: [0, 220] });

  return (
    <View style={styles.container}>
      <CameraView
        style={StyleSheet.absoluteFillObject}
        facing="back"
        enableTorch={torch}
        barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
        onBarcodeScanned={({ data }) => handleScan(data)}
      />

      <View style={styles.topBar}>
        <View style={[styles.statusChip, { backgroundColor: online ? colors.successBg : colors.warningBg }]}>
          <View style={[styles.statusDot, { backgroundColor: online ? colors.online : colors.offline }]} />
          <Text style={[styles.statusText, { color: online ? colors.online : colors.offline }]}>
            {online ? "Online" : "Offline"}
            {pending > 0 ? ` · ${pending} na fila` : ""}
          </Text>
        </View>

        <Pressable style={styles.torchButton} onPress={() => setTorch((t) => !t)}>
          <Text style={styles.torchIcon}>{torch ? "🔦" : "💡"}</Text>
        </Pressable>
      </View>

      <View style={styles.frame} pointerEvents="none">
        <Animated.View style={[styles.scanline, { transform: [{ translateY }] }]} />
        <View style={[styles.corner, styles.cornerTL]} />
        <View style={[styles.corner, styles.cornerTR]} />
        <View style={[styles.corner, styles.cornerBL]} />
        <View style={[styles.corner, styles.cornerBR]} />
      </View>

      {result ? (
        <ResultBanner result={result} onDismiss={() => setResult(null)} />
      ) : (
        <View style={styles.hint}>
          <Text style={styles.hintText}>Aponte para o QR do ingresso</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#000" },
  center: { justifyContent: "center", alignItems: "center", padding: 24 },
  message: { color: "#fff", textAlign: "center", marginBottom: 16, fontSize: 15 },
  button: { backgroundColor: colors.primary, paddingHorizontal: 20, paddingVertical: 12, borderRadius: 8 },
  buttonText: { color: "#fff", fontWeight: "700" },
  topBar: {
    position: "absolute",
    top: 54,
    left: 16,
    right: 16,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  statusChip: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 20,
    gap: 6,
  },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  statusText: { fontSize: 12, fontWeight: "700" },
  torchButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#00000080",
    alignItems: "center",
    justifyContent: "center",
  },
  torchIcon: { fontSize: 18 },
  frame: {
    position: "absolute",
    top: "28%",
    left: "12%",
    right: "12%",
    height: 240,
    overflow: "hidden",
  },
  scanline: {
    position: "absolute",
    left: 0,
    right: 0,
    height: 2,
    backgroundColor: colors.primary,
  },
  corner: { position: "absolute", width: 28, height: 28, borderColor: colors.primary },
  cornerTL: { top: 0, left: 0, borderTopWidth: 4, borderLeftWidth: 4, borderTopLeftRadius: 12 },
  cornerTR: { top: 0, right: 0, borderTopWidth: 4, borderRightWidth: 4, borderTopRightRadius: 12 },
  cornerBL: { bottom: 0, left: 0, borderBottomWidth: 4, borderLeftWidth: 4, borderBottomLeftRadius: 12 },
  cornerBR: { bottom: 0, right: 0, borderBottomWidth: 4, borderRightWidth: 4, borderBottomRightRadius: 12 },
  hint: { position: "absolute", bottom: 40, alignSelf: "center" },
  hintText: { color: "#fff", backgroundColor: "#00000080", padding: 8, borderRadius: 8 },
});
