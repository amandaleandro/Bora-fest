"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";

const LINKS = [
  { href: "/organizacoes", label: "Organizações" },
  { href: "/eventos", label: "Eventos" },
  { href: "/pedidos", label: "Pedidos" },
  { href: "/payouts", label: "Repasses" },
  { href: "/webhooks", label: "Webhooks" },
  { href: "/filas", label: "Filas" },
  { href: "/auditoria", label: "Auditoria" },
];

export function Nav() {
  const { user, logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  return (
    <header className="mb-8 rounded-2xl border border-white/10 bg-slate-900/50 p-4 backdrop-blur-xl shadow-glass">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b border-slate-800/80 pb-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-tr from-brand to-brand-light font-extrabold text-white shadow-glow-brand">
            BF
          </div>
          <div>
            <Link href="/organizacoes" className="text-base font-extrabold tracking-tight text-white hover:text-brand-light transition-colors">
              BoraFest <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-brand/20 text-brand-light border border-brand/30 ml-2">Backoffice</span>
            </Link>
          </div>
        </div>

        <div className="flex items-center gap-4 text-xs sm:text-sm text-slate-400">
          {user?.email ? (
            <div className="flex items-center gap-2 rounded-lg bg-slate-800/60 px-3 py-1.5 border border-slate-700/50">
              <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
              <span className="font-medium text-slate-200">{user.email}</span>
              <span className="text-xs text-slate-500 font-mono">({user.platformRole})</span>
            </div>
          ) : null}
          <button
            type="button"
            onClick={() => {
              logout();
              router.push("/login");
            }}
            className="rounded-lg px-3 py-1.5 text-xs font-semibold text-rose-400 hover:bg-rose-500/10 border border-rose-500/20 transition-all"
          >
            Sair
          </button>
        </div>
      </div>

      <nav className="mt-4 flex flex-wrap gap-1">
        {LINKS.map((link) => {
          const isActive = pathname.startsWith(link.href);
          return (
            <Link
              key={link.href}
              href={link.href}
              className={`rounded-xl px-4 py-2 text-xs font-semibold transition-all ${
                isActive
                  ? "bg-brand/20 text-brand-light border border-brand/40 shadow-sm"
                  : "text-slate-400 hover:bg-slate-800/60 hover:text-slate-200"
              }`}
            >
              {link.label}
            </Link>
          );
        })}
      </nav>
    </header>
  );
}
