"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { resolveHomePath } from "@/lib/eventContext";

export default function RootPage() {
  const { token, loading, sessionExpired } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    if (!token) {
      // aberto pelo atalho/PWA com a sessão vencida: o aviso não pode sumir (2026-10-12)
      router.replace(sessionExpired ? "/login?sessao=expirada" : "/login");
      return;
    }
    // v1 é single-organização: cai direto em "Meus eventos" (decisão v2 #6).
    let cancelado = false;
    resolveHomePath(token).then((path) => {
      if (!cancelado) router.replace(path);
    });
    return () => {
      cancelado = true;
    };
  }, [token, loading, sessionExpired, router]);

  return null;
}
