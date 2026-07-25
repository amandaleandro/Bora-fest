"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { resolveHomePath } from "@/lib/eventContext";

export default function RootPage() {
  const { token, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    if (!token) {
      router.replace("/login");
      return;
    }
    // v1 é single-organização: cai direto em "Meus eventos" (decisão v2 #6).
    resolveHomePath(token).then((path) => router.replace(path));
  }, [token, loading, router]);

  return null;
}
