/** @type {import('next').NextConfig} */
const nextConfig = {
  // build standalone para a imagem Docker de produção
  output: "standalone",
  // pacotes do workspace são TS cru — o Next precisa compilá-los
  transpilePackages: ["@borafest/ui"],
  reactStrictMode: true,
};

module.exports = nextConfig;
