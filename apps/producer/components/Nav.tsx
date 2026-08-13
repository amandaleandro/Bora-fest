"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";

export function Nav() {
  const { user, logout } = useAuth();
  const router = useRouter();

  return (
    <header className="flex items-center justify-between border-b border-line py-4">
      <Link href="/organizacoes" className="font-bold">
        BoraFest
      </Link>
      <div className="flex min-w-0 items-center gap-4 text-sm text-muted">
        <Link href="/ajuda" className="shrink-0">Ajuda</Link>
        {user?.email ? <span className="min-w-0 truncate">{user.email}</span> : null}
        <button
          type="button"
          className="shrink-0"
          onClick={() => {
            logout();
            router.push("/login");
          }}
        >
          Sair
        </button>
      </div>
    </header>
  );
}
