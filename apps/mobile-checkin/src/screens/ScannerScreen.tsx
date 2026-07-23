import React, { useRef, useState } from "react";
import { View, Text, StyleSheet, Pressable } from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import { useSession } from "../context/SessionContext";
import { attemptCheckin, type CheckinAttemptResult } from "../checkin/attemptCheckin";
import { ResultBanner } from "../components/ResultBanner";

export function ScannerScreen() {
  const { session } = useSession();
  const [permission, requestPermission] = useCameraPermissions();
  const [result, setResult] = useState<CheckinAttemptResult | null>(null);
  const [busy, setBusy] = useState(false);
  const lastScanRef = useRef<{ value: string; at: number } | null>(null);

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

  return (
    <View style={styles.container}>
      <CameraView
        style={StyleSheet.absoluteFillObject}
        facing="back"
        barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
        onBarcodeScanned={({ data }) => handleScan(data)}
      />
      <View style={styles.frame} pointerEvents="none" />
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
  button: { backgroundColor: "#22c55e", paddingHorizontal: 20, paddingVertical: 12, borderRadius: 8 },
  buttonText: { color: "#052e16", fontWeight: "700" },
  frame: {
    position: "absolute",
    top: "30%",
    left: "15%",
    right: "15%",
    bottom: "40%",
    borderWidth: 3,
    borderColor: "#22c55e",
    borderRadius: 16,
  },
  hint: { position: "absolute", bottom: 40, alignSelf: "center" },
  hintText: { color: "#fff", backgroundColor: "#00000080", padding: 8, borderRadius: 8 },
});
