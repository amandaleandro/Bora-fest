"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { API_BASE_URL } from "../lib/config";

/**
 * Relação permanente com o produtor: o perfil público aparece para qualquer
 * visitante; seguir continua disponível só para quem já tem sessão.
 */
export function FollowButton({ organizationId, organizationName }: { organizationId: string; organizationName: string }) {
  const [token, setToken] = useState<string | null>(null);
  const [following, setFollowing] = useState(false);
  const [loading, setLoading] = useState(false);
  const [profileSlug, setProfileSlug] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const stored = localStorage.getItem("bf.token");
    setToken(stored);

    fetch(`${API_BASE_URL}/v1/public/casas/by-id/${organizationId}`, { cache: "force-cache" })
      .then(async (response) => {
        if (!response.ok) return null;
        return (await response.json()) as { slug?: string };
      })
      .then((house) => {
        if (active && house?.slug) setProfileSlug(house.slug);
      })
      .catch(() => undefined);

    if (stored) {
      api
        .isFollowing(organizationId, stored)
        .then((r) => {
          if (active) setFollowing(r.following);
        })
        .catch(() => {});
    }

    return () => {
      active = false;
    };
  }, [organizationId]);

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

  if (!profileSlug && !token) return null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {profileSlug ? (
        <Link
          href={`/casa/${profileSlug}`}
          className="rounded-full border border-line-input px-3.5 py-1.5 text-[12px] font-bold text-ink-soft transition hover:border-primary/40 hover:text-primary"
        >
          Ver perfil
        </Link>
      ) : null}
      {token ? (
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
      ) : null}
    </div>
  );
}
