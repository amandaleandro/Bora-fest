"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const PANEL = process.env.NEXT_PUBLIC_PANEL_URL ?? "http://localhost:3001";

/** A portaria é um app standalone: nada de header/rodapé/moldura do site. */
function isStandaloneRoute(pathname: string | null): boolean {
  return Boolean(pathname?.startsWith("/portaria"));
}

/** Moldura de largura do site (430px no mobile) — a portaria fica fora dela. */
export function SiteFrame({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  if (isStandaloneRoute(pathname)) return <>{children}</>;
  return <div className="mx-auto min-h-dvh w-full max-w-[430px] bg-bg lg:max-w-none">{children}</div>;
}

/** Header/footer do Site Público (desktop) — no mobile o app é full-screen. */
export function SiteHeader() {
  const pathname = usePathname();
  const [signedIn, setSignedIn] = useState(false);

  // a sessão vive no localStorage: reavalia a cada navegação
  useEffect(() => {
    setSignedIn(Boolean(localStorage.getItem("bf.token")));
  }, [pathname]);

  if (isStandaloneRoute(pathname)) return null;

  return (
    <header className="hidden border-b border-line bg-surface lg:block">
      <div className="mx-auto flex h-16 max-w-[1160px] items-center justify-between px-6">
        <Link href="/" className="text-[20px] font-extrabold text-primary">BoraFest</Link>
        <nav className="flex items-center gap-3">
          <a href={`${PANEL}/cadastro`} className="rounded-xl border-[1.5px] border-line-input px-4 py-2 text-[13px] font-bold text-ink">
            Produza seu evento
          </a>
          <Link href="/perfil" className="rounded-xl bg-primary px-5 py-2 text-[13px] font-extrabold text-white shadow-cta">
            {signedIn ? "Minha conta" : "Entrar"}
          </Link>
        </nav>
      </div>
    </header>
  );
}

export function SiteFooter() {
  const pathname = usePathname();
  if (isStandaloneRoute(pathname)) return null;

  return (
    <footer className="hidden border-t border-line bg-surface lg:block">
      <div className="mx-auto grid max-w-[1160px] grid-cols-4 gap-8 px-6 py-10 text-[13px]">
        <div>
          <p className="text-[16px] font-extrabold text-primary">BoraFest</p>
          <p className="mt-2 font-medium text-muted">A compra de ingresso mais simples do Brasil — sem senha, sem app obrigatório.</p>
        </div>
        <div>
          <p className="font-extrabold">Para produtores</p>
          <ul className="mt-2 space-y-1.5 font-semibold text-muted">
            <li><a href={`${PANEL}/login`} className="hover:text-primary">Painel do organizador</a></li>
            <li><a href={`${PANEL}/cadastro`} className="hover:text-primary">Criar conta</a></li>
            {/* o painel abre o Financeiro pela hash — é lá que taxas e repasses são explicados */}
            <li><a href={`${PANEL}/login#financeiro`} className="hover:text-primary">Taxas e repasses</a></li>
          </ul>
        </div>
        <div>
          <p className="font-extrabold">Para você</p>
          <ul className="mt-2 space-y-1.5 font-semibold text-muted">
            <li><Link href="/perfil" className="hover:text-primary">Minha conta</Link></li>
            <li><Link href="/minhas-compras" className="hover:text-primary">Minhas compras</Link></li>
          </ul>
        </div>
        <div>
          <p className="font-extrabold">Legal</p>
          <ul className="mt-2 space-y-1.5 font-semibold text-muted">
            <li><Link href="/legal" className="hover:text-primary">Política de Privacidade</Link></li>
            <li><Link href="/legal?aba=termos" className="hover:text-primary">Termos de Uso</Link></li>
            <li><Link href="/legal?aba=termos" className="hover:text-primary">Meia-entrada</Link></li>
            <li className="text-muted-3">DPO: privacidade@borafest.com</li>
          </ul>
        </div>
      </div>
    </footer>
  );
}
