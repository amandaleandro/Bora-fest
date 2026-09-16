"use client";

import Image from "next/image";
import { useState } from "react";

/**
 * Banner de evento otimizado (2026-08-17): o produtor sobe foto crua de 3–8MB
 * e o site baixava o ORIGINAL até num card de 240px. Este wrapper passa tudo
 * pelo otimizador do Next (/_next/image): WebP no tamanho exato do slot, com
 * srcset por densidade e cache em disco. `sizes` diz quanto da tela o slot
 * ocupa — é o que decide o peso baixado.
 *
 * `fit` (decisão do Arthur, 2026-09-16, depois de olhar a concorrência):
 *
 *   `cover` (padrão) — enche o slot cortando o que sobra. É o que TODO card de
 *   listagem do mercado faz: Sympla (`object-fit: cover` em todo card, medido
 *   no CSS renderizado), Ingresse e Cheers. Miniatura de navegação corta, e o
 *   card fica limpo. Logo/avatar também vivem aqui.
 *
 *   `poster` — só na PÁGINA DO EVENTO, onde o flyer é o conteúdo, não uma
 *   miniatura. Duas camadas da mesma arte: fundo ampliado, borrado e
 *   ESCURECIDO (um palco quieto), e por cima o flyer inteiro como um pôster —
 *   com margem e cantos arredondados, nunca esticado até a borda. Nenhum
 *   pixel cortado, nenhum esticado. É a estrutura da própria Sympla na página
 *   do evento (fundo da mesma imagem a 120% + pôster em card).
 *
 *   A primeira versão (2026-09-16, manhã) usava `contain` com fundo CLARO em
 *   todo card — o Arthur reprovou, com razão: o blur colorido virava um borrão
 *   competindo com o flyer, e o `contain` esticado até a borda criava tarjas
 *   que pareciam defeito. O erro era de execução, não da ideia.
 */
export function EventImage({
  src,
  sizes,
  priority,
  className,
  fit = "cover",
}: {
  src: string;
  sizes: string;
  priority?: boolean;
  className?: string;
  fit?: "cover" | "poster";
}) {
  const isInline = src.startsWith("data:") || src.startsWith("blob:");
  // proporção real do flyer: é o que deixa o pôster ter exatamente o tamanho
  // da arte (e cantos arredondados de verdade) em vez de um retângulo genérico
  const [ratio, setRatio] = useState<number | null>(null);

  if (fit === "poster") {
    const medir = (el: HTMLImageElement) => {
      if (el.naturalWidth > 0 && el.naturalHeight > 0) setRatio(el.naturalWidth / el.naturalHeight);
    };
    const fundo = "scale-110 object-cover object-center blur-2xl brightness-[.4] saturate-[.85]";
    return (
      <>
        {isInline ? (
          // eslint-disable-next-line @next/next/no-img-element -- fonte inline, sem otimização possível
          <img src={src} alt="" aria-hidden decoding="async" className={`absolute inset-0 h-full w-full ${fundo}`} />
        ) : (
          <Image src={src} alt="" aria-hidden fill sizes={sizes} quality={20} className={fundo} />
        )}

        {/* o pôster: altura do slot menos a margem; a largura vem da proporção
            da arte. Flyer largo demais é contido por max-w e segue inteiro. */}
        <div className="absolute inset-0 flex items-center justify-center p-4 sm:p-6">
          <div
            className={`relative h-full max-w-full overflow-hidden rounded-2xl shadow-[0_18px_50px_-14px_rgba(0,0,0,.65)] ${
              ratio ? "" : "w-full"
            } ${className ?? ""}`}
            style={ratio ? { aspectRatio: ratio } : undefined}
          >
            {isInline ? (
              // eslint-disable-next-line @next/next/no-img-element -- fonte inline, sem otimização possível
              <img
                src={src}
                alt=""
                decoding="async"
                onLoad={(e) => medir(e.currentTarget)}
                className="absolute inset-0 h-full w-full object-contain object-center"
              />
            ) : (
              <Image
                src={src}
                alt=""
                fill
                sizes={sizes}
                priority={priority}
                onLoad={(e) => medir(e.currentTarget)}
                className="object-contain object-center"
              />
            )}
          </div>
        </div>
      </>
    );
  }

  if (isInline) {
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
