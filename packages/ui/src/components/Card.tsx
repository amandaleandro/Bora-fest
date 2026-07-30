import React from "react";
import { cn } from "../cn";

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  glass?: boolean;
  hoverable?: boolean;
}

export function Card({ className, glass = true, hoverable = false, children, ...props }: CardProps) {
  return (
    <div
      className={cn(
        "rounded-2xl border border-slate-800/80 bg-slate-900/60 p-6 backdrop-blur-xl transition-all duration-300 shadow-glass",
        glass && "bg-slate-900/40 border-white/10",
        hoverable && "hover:border-brand/40 hover:shadow-glow-brand hover:-translate-y-0.5",
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export function CardHeader({ className, children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("flex flex-col space-y-1.5 pb-4 border-b border-slate-800/60 mb-4", className)} {...props}>
      {children}
    </div>
  );
}

export function CardTitle({ className, children, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h3 className={cn("text-lg font-bold tracking-tight text-white", className)} {...props}>
      {children}
    </h3>
  );
}
