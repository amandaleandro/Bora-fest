import React from "react";
import { cn } from "../cn";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "outline" | "ghost" | "danger";
  size?: "sm" | "md" | "lg";
  isLoading?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "primary", size = "md", isLoading, children, disabled, ...props }, ref) => {
    const baseStyles =
      "inline-flex items-center justify-center font-semibold transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-brand-light focus:ring-offset-2 focus:ring-offset-background disabled:opacity-50 disabled:cursor-not-allowed rounded-xl cursor-pointer";

    const variants = {
      primary:
        "bg-gradient-to-r from-brand to-brand-hover text-white shadow-glow-brand hover:brightness-110 active:scale-[0.98]",
      secondary:
        "bg-background-elevated hover:bg-background-hover text-slate-100 border border-slate-700/50 shadow-sm",
      outline:
        "border border-slate-700 hover:border-brand hover:bg-brand/10 text-slate-200",
      ghost: "hover:bg-slate-800/60 text-slate-300 hover:text-white",
      danger:
        "bg-rose-600/90 hover:bg-rose-600 text-white shadow-lg shadow-rose-600/20 active:scale-[0.98]",
    };

    const sizes = {
      sm: "px-3 py-1.5 text-xs font-medium gap-1.5",
      md: "px-4 py-2.5 text-sm gap-2",
      lg: "px-6 py-3.5 text-base gap-2.5",
    };

    return (
      <button
        ref={ref}
        disabled={disabled || isLoading}
        className={cn(baseStyles, variants[variant], sizes[size], className)}
        {...props}
      >
        {isLoading ? (
          <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-current" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            />
          </svg>
        ) : null}
        {children}
      </button>
    );
  }
);
Button.displayName = "Button";
