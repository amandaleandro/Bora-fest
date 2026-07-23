/** @type {import('next').NextConfig} */
const nextConfig = {
  // build standalone para a imagem Docker de produção
  output: "standalone",
  reactStrictMode: true,
};

module.exports = nextConfig;
