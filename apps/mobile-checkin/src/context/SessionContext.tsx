import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import * as SecureStore from "expo-secure-store";
import type { ValidatorSessionResponse } from "../api/types";

const STORAGE_KEY = "borafest-validator-session";

export interface StoredSession {
  deviceId: string;
  deviceToken: string;
  event: ValidatorSessionResponse["event"];
  checkinPoints: ValidatorSessionResponse["checkinPoints"];
  checkinPointId?: string;
}

interface SessionContextValue {
  session: StoredSession | null;
  loading: boolean;
  saveSession: (session: StoredSession) => Promise<void>;
  setCheckinPoint: (checkinPointId: string) => Promise<void>;
  clearSession: () => Promise<void>;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<StoredSession | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    SecureStore.getItemAsync(STORAGE_KEY)
      .then((raw) => {
        if (raw) setSession(JSON.parse(raw));
      })
      .finally(() => setLoading(false));
  }, []);

  const saveSession = useCallback(async (next: StoredSession) => {
    await SecureStore.setItemAsync(STORAGE_KEY, JSON.stringify(next));
    setSession(next);
  }, []);

  const setCheckinPoint = useCallback(
    async (checkinPointId: string) => {
      if (!session) return;
      const next = { ...session, checkinPointId };
      await SecureStore.setItemAsync(STORAGE_KEY, JSON.stringify(next));
      setSession(next);
    },
    [session],
  );

  const clearSession = useCallback(async () => {
    await SecureStore.deleteItemAsync(STORAGE_KEY);
    setSession(null);
  }, []);

  return (
    <SessionContext.Provider value={{ session, loading, saveSession, setCheckinPoint, clearSession }}>
      {children}
    </SessionContext.Provider>
  );
}

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession precisa estar dentro de SessionProvider");
  return ctx;
}
