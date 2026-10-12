"use client";

import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import { SESSION_EXPIRED_EVENT } from "./api";

const STORAGE_KEY = "borafest-admin-token";

interface AuthUser {
  id: string;
  email: string | null;
  name: string | null;
  platformRole: string | null;
}

interface AuthContextValue {
  token: string | null;
  user: AuthUser | null;
  loading: boolean;
  /** true quando a sessão caiu por 401 (não pelo Sair): o AuthGuard leva o aviso ao login */
  sessionExpired: boolean;
  login: (token: string, user: AuthUser) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [sessionExpired, setSessionExpired] = useState(false);

  useEffect(() => {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      setToken(parsed.token);
      setUser(parsed.user);
    }
    setLoading(false);
  }, []);

  const login = useCallback((nextToken: string, nextUser: AuthUser) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ token: nextToken, user: nextUser }));
    setToken(nextToken);
    setUser(nextUser);
    setSessionExpired(false);
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    setToken(null);
    setUser(null);
  }, []);

  // SESSÃO VENCIDA (2026-10-12): lib/api.ts avisa quando uma chamada com token
  // toma 401. Faz o mesmo que o Sair e marca o motivo, para o AuthGuard mandar
  // ao login com "Sua sessão expirou". Se já há OUTRO token guardado (a pessoa
  // entrou de novo), um 401 atrasado do token antigo não desloga ninguém.
  useEffect(() => {
    function onExpired(event: Event) {
      const expiredToken = (event as CustomEvent<{ token?: string }>).detail?.token;
      let stored: string | null = null;
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        stored = raw ? (JSON.parse(raw).token ?? null) : null;
      } catch {
        stored = null;
      }
      if (stored && stored !== expiredToken) return;
      setSessionExpired(true);
      logout();
    }
    window.addEventListener(SESSION_EXPIRED_EVENT, onExpired);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, onExpired);
  }, [logout]);

  return (
    <AuthContext.Provider value={{ token, user, loading, sessionExpired, login, logout }}>{children}</AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth precisa estar dentro de AuthProvider");
  return ctx;
}
