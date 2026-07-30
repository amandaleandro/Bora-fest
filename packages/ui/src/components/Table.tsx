import React from "react";
import { cn } from "../cn";

export function Table({ className, children, ...props }: React.TableHTMLAttributes<HTMLTableElement>) {
  return (
    <div className="w-full overflow-hidden rounded-2xl border border-slate-800/80 bg-slate-900/40 backdrop-blur-xl shadow-glass">
      <table className={cn("w-full text-left text-sm text-slate-300 border-collapse", className)} {...props}>
        {children}
      </table>
    </div>
  );
}

export function TableHeader({ className, children, ...props }: React.HTMLAttributes<HTMLTableSectionElement>) {
  return (
    <thead className={cn("bg-slate-800/60 text-xs font-semibold uppercase tracking-wider text-slate-400 border-b border-slate-800", className)} {...props}>
      {children}
    </thead>
  );
}

export function TableRow({ className, children, ...props }: React.HTMLAttributes<HTMLTableRowElement>) {
  return (
    <tr className={cn("border-b border-slate-800/50 transition-colors hover:bg-slate-800/30", className)} {...props}>
      {children}
    </tr>
  );
}

export function TableHead({ className, children, ...props }: React.ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th className={cn("px-5 py-3.5 font-medium", className)} {...props}>
      {children}
    </th>
  );
}

export function TableCell({ className, children, ...props }: React.TdHTMLAttributes<HTMLTableCellElement>) {
  return (
    <td className={cn("px-5 py-4 align-middle", className)} {...props}>
      {children}
    </td>
  );
}
