import React, { useEffect, useState } from "react";
import { View, ActivityIndicator, Linking, StyleSheet } from "react-native";
import { StatusBar } from "expo-status-bar";
import { AuthProvider, useAuth } from "./src/context/AuthContext";
import { HomeScreen } from "./src/screens/HomeScreen";
import { EventScreen } from "./src/screens/EventScreen";
import { CheckoutScreen } from "./src/screens/CheckoutScreen";
import { WalletScreen } from "./src/screens/WalletScreen";
import { LoginScreen } from "./src/screens/LoginScreen";
import { MyTicketsScreen } from "./src/screens/MyTicketsScreen";
import "./src/push"; // registra o handler de notificação em foreground assim que o app abre

type Screen =
  | { name: "home" }
  | { name: "event"; slug: string; promoterSlug?: string; sellerSlug?: string }
  | { name: "checkout"; reservationId: string; promoterSlug?: string; sellerSlug?: string }
  | { name: "wallet"; publicToken: string }
  | { name: "login" }
  | { name: "my-tickets" };

function Root() {
  const { user, loading } = useAuth();
  const [screen, setScreen] = useState<Screen>({ name: "home" });

  useEffect(() => {
    function openUrl(url: string | null) {
      if (!url) return;
      try {
        const parsed = new URL(url);
        const slug = parsed.pathname.replace(/^\/+|\/+$/g, "");
        if (!slug) return;
        setScreen({
          name: "event",
          slug,
          promoterSlug: parsed.searchParams.get("pr") || undefined,
          sellerSlug: parsed.searchParams.get("vd") || undefined,
        });
      } catch {
        // URL inválida não deve derrubar o app.
      }
    }

    Linking.getInitialURL().then(openUrl).catch(() => undefined);
    const subscription = Linking.addEventListener("url", ({ url }) => openUrl(url));
    return () => subscription.remove();
  }, []);

  if (loading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color="#fff" />
      </View>
    );
  }

  switch (screen.name) {
    case "event":
      return (
        <EventScreen
          slug={screen.slug}
          promoterSlug={screen.promoterSlug}
          sellerSlug={screen.sellerSlug}
          onBack={() => setScreen({ name: "home" })}
          onReserved={(reservationId) =>
            setScreen({
              name: "checkout",
              reservationId,
              promoterSlug: screen.promoterSlug,
              sellerSlug: screen.sellerSlug,
            })
          }
        />
      );
    case "checkout":
      return (
        <CheckoutScreen
          reservationId={screen.reservationId}
          promoterSlug={screen.promoterSlug}
          sellerSlug={screen.sellerSlug}
          onFulfilled={(publicToken) => setScreen({ name: "wallet", publicToken })}
        />
      );
    case "wallet":
      return <WalletScreen publicToken={screen.publicToken} onBackHome={() => setScreen({ name: "home" })} />;
    case "login":
      return (
        <LoginScreen
          onBack={() => setScreen({ name: "home" })}
          onLoggedIn={() => setScreen({ name: "my-tickets" })}
        />
      );
    case "my-tickets":
      return <MyTicketsScreen onBack={() => setScreen({ name: "home" })} />;
    default:
      return (
        <HomeScreen
          onOpenEvent={(slug) => setScreen({ name: "event", slug })}
          onOpenMyTickets={() => setScreen(user ? { name: "my-tickets" } : { name: "login" })}
        />
      );
  }
}

export default function App() {
  return (
    <AuthProvider>
      <StatusBar style="light" />
      <Root />
    </AuthProvider>
  );
}

const styles = StyleSheet.create({
  loading: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: "#111827" },
});
