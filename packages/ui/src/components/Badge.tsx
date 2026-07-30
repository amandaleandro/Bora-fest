import React from "react";
import { cn } from "../cn";

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: "success" | "warning" | "error" | "info" | "neutral" | "brand";
}

export function Badge({ className, variant = "neutral", children, ...props }: BadgeProps) {
  const variants = {
    neutral: "bg-slate-800 text-slate-300 border-slate-700/50",
    brand: "bg-brand/15 text-brand-light border-brand/30 shadow-sm",
    success: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
    warning: "bg-amber-500/15 text-amber-400 border-amber-500/30",
    error: "bg-rose-500/15 text-rose-400 border-rose-500/30",
    info: "bg-cyan-500/15 text-cyan-400 border-cyan-500/30",
  };

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold border tracking-wide",
        variants[variant],
        className
      )}
      {...props}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current opacity-80" />
      {children}
    </span>
  );
}
