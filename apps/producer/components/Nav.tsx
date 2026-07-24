"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";

export function Nav() {
  const { user, logout } = useAuth();
  const router = useRouter();

  return (
    <header className="flex items-center justify-between border-b border-gray-800 py-4">
      <Link href="/organizacoes" className="font-bold">
        BoraFest
      </Link>
      <div className="flex items-center gap-4 text-sm text-gray-400">
        <Link href="/ajuda">Ajuda</Link>
        {user?.email ? <span>{user.email}</span> : null}
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
    </header>
  );
}
