import Image from "next/image";

/**
 * Faixa "Produza seu evento" da home. A arte vem do painel de admin (slot
 * desktop e slot mobile); sem arte anexada, cai no banner padrão da marca.
 *
 * 2026-08-17 (waterfall do GTmetrix): era um <img> cru de 54,6 KB — o maior
 * arquivo da página — e ainda buscava as URLs na API DEPOIS do carregamento.
 * Agora as URLs vêm do servidor (a home já é Server Component) e a arte passa
 * pelo otimizador: WebP no tamanho do slot, carregada só ao chegar perto.
 */
export function PromoBanner({
  panelUrl,
  desktopUrl,
  mobileUrl,
}: {
  panelUrl: string;
  desktopUrl?: string | null;
  mobileUrl?: string | null;
}) {
  const desktop = desktopUrl ?? "/brand/banner-produtores.webp";
  const mobile = mobileUrl ?? "/brand/banner-produtores.webp";
  const alt =
    "Do bora? ao ingresso vendido em minutos. Sem burocracia — publique em minutos, Pix direto na tela, sem trava de verificação. Grátis para começar.";

  return (
    <section className="mt-12 lg:mt-14">
      <a
        href={`${panelUrl}/cadastro`}
        aria-label="Criar conta de produtor — do bora ao ingresso vendido em minutos, sem burocracia"
        className="group block overflow-hidden rounded-2xl shadow-card transition-transform duration-200 hover:-translate-y-0.5 lg:rounded-3xl"
      >
        <Image
          src={desktop}
          alt={alt}
          width={1600}
          height={420}
          sizes="(min-width: 1024px) 1160px, 100vw"
          className="hidden h-auto w-full transition-transform duration-300 group-hover:scale-[1.01] lg:block"
        />
        <Image
          src={mobile}
          alt={alt}
          width={1080}
          height={1080}
          sizes="430px"
          className="h-auto w-full transition-transform duration-300 group-hover:scale-[1.01] lg:hidden"
        />
      </a>
    </section>
  );
}
