"use client";

import { useEffect, useState } from "react";
import { api } from "../lib/api";

/** Só aparece pra quem já tem sessão (login OTP feito numa compra/carteira anterior). */
export function FollowButton({ organizationId, organizationName }: { organizationId: string; organizationName: string }) {
  const [token, setToken] = useState<string | null>(null);
  const [following, setFollowing] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem("bf.token");
    setToken(stored);
    if (!stored) return;
    api
      .isFollowing(organizationId, stored)
      .then((r) => setFollowing(r.following))
      .catch(() => {});
  }, [organizationId]);

  if (!token) return null;

  async function toggle() {
    if (!token || loading) return;
    setLoading(true);
    try {
      if (following) {
        await api.unfollow(organizationId, token);
        setFollowing(false);
      } else {
        await api.follow(organizationId, token);
        setFollowing(true);
      }
    } catch {
      // silencioso — não é uma ação crítica pro fluxo de compra
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={loading}
      className={`rounded-full px-3.5 py-1.5 text-[12px] font-bold transition ${
        following ? "bg-primary/10 text-primary" : "border border-line-input text-ink-soft"
      }`}
    >
      {following ? "Seguindo ✓" : `Seguir ${organizationName}`}
    </button>
  );
}
