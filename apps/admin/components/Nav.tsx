"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
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

  return (
    <header className="border-b border-gray-800 py-4">
      <div className="flex items-center justify-between">
        <Link href="/organizacoes" className="font-bold">
          BoraFest — Backoffice
        </Link>
        <div className="flex items-center gap-4 text-sm text-gray-400">
          {user?.email ? (
            <span>
              {user.email} <span className="text-xs text-gray-500">({user.platformRole})</span>
            </span>
          ) : null}
          <button
            type="button"
            onClick={() => {
              logout();
              router.push("/login");
            }}
          >
            Sair
          </button>
        </div>
      </div>
      <nav className="mt-3 flex flex-wrap gap-3 text-sm text-gray-400">
        {LINKS.map((link) => (
          <Link key={link.href} href={link.href} className="hover:text-gray-200">
            {link.label}
          </Link>
        ))}
      </nav>
    </header>
  );
}
