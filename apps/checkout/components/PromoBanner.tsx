"use client";

import { useEffect, useState } from "react";
import { api } from "../lib/api";

/**
 * Faixa "Produza seu evento" da home (2026-08-17): a arte agora vem do painel
 * de admin — um slot pro desktop (faixa larga) e outro pro mobile (formato de
 * post, MAIOR e legível). Sem arte anexada, cai no banner padrão da marca.
 * O banner inteiro é o link — o botão faz parte da imagem.
 */
export function PromoBanner({ panelUrl }: { panelUrl: string }) {
  const [urls, setUrls] = useState<{ desktopUrl: string | null; mobileUrl: string | null }>({
    desktopUrl: null,
    mobileUrl: null,
  });

  useEffect(() => {
    api.publicBanners().then(setUrls).catch(() => undefined);
  }, []);

  const desktop = urls.desktopUrl ?? "/brand/banner-produtores.webp";
  const mobile = urls.mobileUrl ?? "/brand/banner-produtores.webp";

  return (
    <section className="mt-12 lg:mt-14">
      <a
        href={`${panelUrl}/cadastro`}
        aria-label="Criar conta de produtor — do bora ao ingresso vendido em minutos, sem burocracia"
        className="group block overflow-hidden rounded-2xl shadow-card transition-transform duration-200 hover:-translate-y-0.5 lg:rounded-3xl"
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- proporção livre, definida pela arte */}
        <img
          src={desktop}
          alt="Do bora? ao ingresso vendido em minutos. Sem burocracia — publique em minutos, Pix direto na tela, sem trava de verificação. Grátis para começar."
          loading="lazy"
          decoding="async"
          className="hidden h-auto w-full transition-transform duration-300 group-hover:scale-[1.01] lg:block"
        />
        {/* eslint-disable-next-line @next/next/no-img-element -- proporção livre, definida pela arte */}
        <img
          src={mobile}
          alt="Do bora? ao ingresso vendido em minutos. Sem burocracia."
          loading="lazy"
          decoding="async"
          className="h-auto w-full transition-transform duration-300 group-hover:scale-[1.01] lg:hidden"
        />
      </a>
    </section>
  );
}
