import React from "react";
import { cn } from "../cn";

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, label, error, type = "text", ...props }, ref) => {
    return (
      <div className="w-full space-y-1.5">
        {label && <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400">{label}</label>}
        <input
          type={type}
          ref={ref}
          className={cn(
            "w-full rounded-xl bg-slate-900/80 border border-slate-700/60 px-4 py-2.5 text-sm text-slate-100 placeholder-slate-500 backdrop-blur-md transition-all duration-200 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30 hover:border-slate-600 disabled:opacity-50",
            error && "border-rose-500 focus:border-rose-500 focus:ring-rose-500/30",
            className
          )}
          {...props}
        />
        {error && <p className="text-xs text-rose-400 font-medium">{error}</p>}
      </div>
    );
  }
);
Input.displayName = "Input";
