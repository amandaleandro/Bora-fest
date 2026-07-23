import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import * as SecureStore from "expo-secure-store";
import type { SessionUser } from "../api/types";

const STORAGE_KEY = "borafest-app-session";

interface AuthContextValue {
  token: string | null;
  user: SessionUser | null;
  loading: boolean;
  login: (token: string, user: SessionUser) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/**
 * Login é OPCIONAL neste app — só serve pra "meus ingressos"
 * (`GET /v1/me/tickets`, quando o comprador quis criar conta). A compra
 * em si (`/v1/reservations`, `/v1/orders`) nunca exige login.
 */
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    SecureStore.getItemAsync(STORAGE_KEY)
      .then((raw) => {
        if (raw) {
          const parsed = JSON.parse(raw);
          setToken(parsed.token);
          setUser(parsed.user);
        }
      })
      .finally(() => setLoading(false));
  }, []);

  const login = useCallback(async (nextToken: string, nextUser: SessionUser) => {
    await SecureStore.setItemAsync(STORAGE_KEY, JSON.stringify({ token: nextToken, user: nextUser }));
    setToken(nextToken);
    setUser(nextUser);
  }, []);

  const logout = useCallback(async () => {
    await SecureStore.deleteItemAsync(STORAGE_KEY);
    setToken(null);
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ token, user, loading, login, logout }}>{children}</AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth precisa estar dentro de AuthProvider");
  return ctx;
}
