"use client";

import { useState } from "react";
import QRCode from "react-qr-code";

/**
 * QR do ingresso protegido (feedback de cliente dev, 2026-08-17): o código só
 * aparece após um toque. Check-in é "primeiro scan ganha" — um print vazado num
 * grupo entregava a entrada de graça. Tocar de novo esconde.
 */
export function RevealQr({ value, size, className }: { value: string; size: number; className?: string }) {
  const [shown, setShown] = useState(false);

  if (!shown) {
    return (
      <button
        type="button"
        onClick={() => setShown(true)}
        aria-label="Mostrar QR Code do ingresso"
        className={`flex aspect-square flex-col items-center justify-center gap-1.5 rounded-xl bg-brand-gradient p-2 text-white ${className ?? ""}`}
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <rect x="3" y="3" width="7" height="7" rx="1.5" />
          <rect x="14" y="3" width="7" height="7" rx="1.5" />
          <rect x="3" y="14" width="7" height="7" rx="1.5" />
          <path d="M14 14h3v3h-3zM21 14v.01M14 21h.01M18 18h3v3" />
        </svg>
        <span className="px-1 text-center text-[11px] font-extrabold leading-tight">Toque para mostrar o QR</span>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setShown(false)}
      aria-label="Ocultar QR Code do ingresso"
      style={{ maxWidth: "100%" }}
      className={className}
    >
      <QRCode value={value} size={size} className="h-auto w-full" />
    </button>
  );
}
