"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const { token, loading, sessionExpired } = useAuth();
  const router = useRouter();

  useEffect(() => {
    // sessão vencida (401) leva o aviso ao login; o Sair normal vai sem (2026-10-12)
    if (!loading && !token) router.replace(sessionExpired ? "/login?sessao=expirada" : "/login");
  }, [loading, token, sessionExpired, router]);

  if (loading || !token) return null;
  return <>{children}</>;
}
