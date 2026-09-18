"use client";

import { useState } from "react";
import { Icon, paths } from "./icons";

export function ShareButton({
  title,
  compact = false,
  dark = false,
}: {
  title: string;
  compact?: boolean;
  dark?: boolean;
}) {
  const [copied, setCopied] = useState(false);

  async function share() {
    const url = window.location.href;
    try {
      if (navigator.share) {
        await navigator.share({ title, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      // cancelamento do share não precisa virar erro para o comprador
    }
  }

  return (
    <button
      type="button"
      aria-label={copied ? "Link copiado" : "Compartilhar evento"}
      title={copied ? "Link copiado" : "Compartilhar"}
      onClick={share}
      className={
        compact
          ? `flex h-10 w-10 items-center justify-center rounded-full backdrop-blur ${
              dark ? "bg-white/20 text-white" : "border border-line bg-surface text-ink"
            }`
          : "inline-flex items-center gap-2 rounded-xl border border-line bg-surface px-3 py-2 text-[12px] font-extrabold text-ink"
      }
    >
      <Icon d={paths.share} size={18} />
      {!compact ? <span>{copied ? "Link copiado" : "Compartilhar"}</span> : null}
    </button>
  );
}
