import type { Config } from "tailwindcss";
// preset importado por caminho direto: o loader de config do Tailwind roda em
// Node puro e não resolve os componentes .tsx re-exportados pelo index do pacote
import { boraPreset } from "../../packages/ui/src/tailwind-preset";

const config: Config = {
  presets: [boraPreset as Config],
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "../../packages/ui/src/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {},
  },
  plugins: [],
};

export default config;
