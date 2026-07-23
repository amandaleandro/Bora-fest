import React, { useState } from "react";
import { View, ActivityIndicator, StyleSheet } from "react-native";
import { StatusBar } from "expo-status-bar";
import { AuthProvider, useAuth } from "./src/context/AuthContext";
import { HomeScreen } from "./src/screens/HomeScreen";
import { EventScreen } from "./src/screens/EventScreen";
import { CheckoutScreen } from "./src/screens/CheckoutScreen";
import { WalletScreen } from "./src/screens/WalletScreen";
import { LoginScreen } from "./src/screens/LoginScreen";
import { MyTicketsScreen } from "./src/screens/MyTicketsScreen";

type Screen =
  | { name: "home" }
  | { name: "event"; slug: string }
  | { name: "checkout"; reservationId: string }
  | { name: "wallet"; publicToken: string }
  | { name: "login" }
  | { name: "my-tickets" };

function Root() {
  const { user, loading } = useAuth();
  const [screen, setScreen] = useState<Screen>({ name: "home" });

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
          onBack={() => setScreen({ name: "home" })}
          onReserved={(reservationId) => setScreen({ name: "checkout", reservationId })}
        />
      );
    case "checkout":
      return (
        <CheckoutScreen
          reservationId={screen.reservationId}
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
