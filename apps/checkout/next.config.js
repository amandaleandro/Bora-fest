/** @type {import('next').NextConfig} */
const nextConfig = {
  // build standalone para a imagem Docker de produção
  output: "standalone",
  // pacotes do workspace são TS cru — o Next precisa compilá-los
  transpilePackages: ["@borafest/ui"],
  reactStrictMode: true,
  /*
   * Otimizador de imagem (2026-08-17): o banner sobe cru da câmera (3–8MB) e o
   * site baixava o ORIGINAL até em card de 240px. Com isto, todo banner passa
   * por /_next/image: WebP no tamanho do slot + cache de 30 dias no servidor.
   * hostname "**" porque a URL do upload segue API_PUBLIC_URL (configurável).
   */
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "**" },
      { protocol: "http", hostname: "localhost" },
      { protocol: "http", hostname: "127.0.0.1" },
    ],
    formats: ["image/webp"],
    minimumCacheTTL: 60 * 60 * 24 * 30,
  },
};

module.exports = nextConfig;
