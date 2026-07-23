"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const { token, user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    if (!token) {
      router.replace("/login");
      return;
    }
    if (!user?.platformRole) {
      router.replace("/login?erro=sem-acesso");
    }
  }, [loading, token, user, router]);

  if (loading || !token || !user?.platformRole) return null;
  return <>{children}</>;
}
