import React, { useEffect, useState } from "react";
import { View, ActivityIndicator, StyleSheet, Pressable, Text } from "react-native";
import { StatusBar } from "expo-status-bar";
import { SessionProvider, useSession } from "./src/context/SessionContext";
import { initDatabase } from "./src/db/database";
import { PinLoginScreen } from "./src/screens/PinLoginScreen";
import { HomeScreen } from "./src/screens/HomeScreen";
import { ScannerScreen } from "./src/screens/ScannerScreen";
import { ManualSearchScreen } from "./src/screens/ManualSearchScreen";

type Screen = "home" | "scanner" | "manual";

function Root() {
  const { session, loading } = useSession();
  const [screen, setScreen] = useState<Screen>("home");

  useEffect(() => {
    initDatabase();
  }, []);

  if (loading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color="#fff" />
      </View>
    );
  }

  if (!session) {
    return <PinLoginScreen />;
  }

  if (screen === "scanner") {
    return (
      <View style={styles.flex}>
        <ScannerScreen />
        <BackButton onPress={() => setScreen("home")} />
      </View>
    );
  }

  if (screen === "manual") {
    return (
      <View style={styles.flex}>
        <ManualSearchScreen />
        <BackButton onPress={() => setScreen("home")} />
      </View>
    );
  }

  return (
    <HomeScreen onOpenScanner={() => setScreen("scanner")} onOpenManualSearch={() => setScreen("manual")} />
  );
}

function BackButton({ onPress }: { onPress: () => void }) {
  return (
    <Pressable style={styles.back} onPress={onPress}>
      <Text style={styles.backText}>‹ Voltar</Text>
    </Pressable>
  );
}

export default function App() {
  return (
    <SessionProvider>
      <StatusBar style="light" />
      <Root />
    </SessionProvider>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  loading: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: "#111827" },
  back: {
    position: "absolute",
    top: 50,
    left: 16,
    backgroundColor: "#00000080",
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
  },
  backText: { color: "#fff", fontSize: 15 },
});
