"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const { token, user, loading, sessionExpired } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    if (!token) {
      // sessão vencida (401) leva o aviso ao login; o Sair normal vai sem (2026-10-12)
      router.replace(sessionExpired ? "/login?sessao=expirada" : "/login");
      return;
    }
    if (!user?.platformRole) {
      router.replace("/login?erro=sem-acesso");
    }
  }, [loading, token, user, sessionExpired, router]);

  if (loading || !token || !user?.platformRole) return null;
  return <>{children}</>;
}
