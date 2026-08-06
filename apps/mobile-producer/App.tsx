import { StatusBar } from "expo-status-bar";
import { useEffect, useRef, useState, type ComponentType } from "react";
import { ActivityIndicator, BackHandler, SafeAreaView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { WebView } from "react-native-webview";

const producerUrl = (globalThis as typeof globalThis & { process?: { env?: Record<string, string | undefined> } })
  .process?.env?.EXPO_PUBLIC_PRODUCER_URL ?? "http://localhost:3001";
const NativeWebView = WebView as unknown as ComponentType<any>;

export default function App() {
  const webView = useRef<any>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      if (webView.current) {
        webView.current.goBack();
        return true;
      }
      return false;
    });
    return () => subscription.remove();
  }, []);

  if (failed) {
    return (
      <SafeAreaView style={styles.screen}>
        <StatusBar style="light" />
        <View style={styles.errorBox}>
          <Text style={styles.title}>Não foi possível abrir o painel</Text>
          <Text style={styles.message}>Verifique a conexão e tente novamente.</Text>
          <TouchableOpacity style={styles.button} onPress={() => setFailed(false)}>
            <Text style={styles.buttonText}>Tentar novamente</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screen}>
      <StatusBar style="light" />
      <NativeWebView
        ref={webView}
        source={{ uri: producerUrl }}
        startInLoadingState
        renderLoading={() => <ActivityIndicator style={styles.loader} size="large" color="#ffffff" />}
        onError={() => setFailed(true)}
        sharedCookiesEnabled
        thirdPartyCookiesEnabled
        javaScriptEnabled
        domStorageEnabled
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#111827" },
  loader: { flex: 1 },
  errorBox: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  title: { color: "#ffffff", fontSize: 22, fontWeight: "700", textAlign: "center" },
  message: { color: "#d1d5db", fontSize: 16, marginTop: 12, textAlign: "center" },
  button: { backgroundColor: "#16a34a", borderRadius: 8, marginTop: 24, paddingHorizontal: 20, paddingVertical: 12 },
  buttonText: { color: "#ffffff", fontWeight: "700" },
});
