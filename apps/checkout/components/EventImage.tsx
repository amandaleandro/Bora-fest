"use client";

import Image from "next/image";

/**
 * Banner de evento otimizado (2026-08-17): o produtor sobe foto crua de 3–8MB
 * e o site baixava o ORIGINAL até num card de 240px. Este wrapper passa tudo
 * pelo otimizador do Next (/_next/image): WebP no tamanho exato do slot, com
 * srcset por densidade e cache em disco. `sizes` diz quanto da tela o slot
 * ocupa — é o que decide o peso baixado.
 *
 * data:/blob: (mocks e SVGs inline) não passam pelo otimizador — caem no <img>.
 */
export function EventImage({
  src,
  sizes,
  priority,
  className,
}: {
  src: string;
  sizes: string;
  priority?: boolean;
  className?: string;
}) {
  if (src.startsWith("data:") || src.startsWith("blob:")) {
    // eslint-disable-next-line @next/next/no-img-element -- fonte inline, sem otimização possível
    return <img src={src} alt="" decoding="async" className={className} />;
  }
  return (
    <Image
      src={src}
      alt=""
      fill
      sizes={sizes}
      priority={priority}
      className={className}
    />
  );
}
