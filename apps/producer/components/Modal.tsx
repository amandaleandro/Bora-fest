"use client";

import { useEffect } from "react";

/** Modal centrado do protótipo: overlay escuro com blur, card branco r=20. */
export function Modal({
  title,
  subtitle,
  width = 460,
  onClose,
  children,
  footer,
}: {
  title: string;
  subtitle?: React.ReactNode;
  width?: number;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      role="presentation"
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(20,16,28,.5)] p-4 backdrop-blur-[3px]"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: width }}
        className="max-h-[90dvh] w-full overflow-y-auto rounded-[20px] bg-surface p-6 shadow-card"
      >
        <h2 className="text-[19px] font-extrabold leading-tight text-ink">{title}</h2>
        {subtitle ? <p className="mt-1.5 text-[13px] font-medium leading-relaxed text-muted">{subtitle}</p> : null}
        <div className="mt-4">{children}</div>
        {footer ? <div className="mt-5 flex justify-end gap-2.5">{footer}</div> : null}
      </div>
    </div>
  );
}

export const modalInput =
  "h-[50px] w-full rounded-[13px] border-[1.5px] border-line-input bg-surface px-4 text-[14px] font-medium text-ink outline-none focus:border-primary";
export const modalLabel = "mb-1.5 block text-[12px] font-bold text-ink-soft";
export const ghostBtn =
  "h-[46px] rounded-xl border-[1.5px] border-line-input px-5 text-[14px] font-bold text-ink-soft";
export const solidBtn =
  "h-[46px] rounded-xl bg-primary px-5 text-[14px] font-extrabold text-white disabled:bg-[#ecd6e4] disabled:text-muted";
