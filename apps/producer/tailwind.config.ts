import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        primary: { DEFAULT: "#D9128F", hover: "#B30E76" },
        /*
         * Alias legado: telas antigas usavam `bg-brand` + `text-brand-dark`
         * (paleta do tema escuro). Sem estas chaves o Tailwind não gera as
         * classes e os botões ficavam transparentes/ilegíveis. `brand` vira
         * o primário e `brand-dark` é a cor de TEXTO usada sobre bg-brand.
         */
        brand: { DEFAULT: "#D9128F", hover: "#B30E76", dark: "#ffffff" },
        ink: { DEFAULT: "#16121f", soft: "#544e60" },
        muted: { DEFAULT: "#6b6577", 2: "#8b8598", 3: "#a49eb0" },
        bg: { DEFAULT: "#f6f5fb", dark: "#0b0910" },
        sidebar: "#1D1016",
        surface: "#ffffff",
        line: { DEFAULT: "#ece9f2", input: "#e0dbec", divider: "#f4f2f8" },
        success: "#12a150",
        warning: "#b45309",
        danger: "#e11d48",
        pix: "#17b0a0",
      },
      fontFamily: { sans: ["var(--font-jakarta)", "system-ui", "sans-serif"] },
      backgroundImage: {
        "brand-gradient": "linear-gradient(135deg,#C913DB 0%,#F1126E 55%,#FB7032 100%)",
      },
      boxShadow: {
        cta: "0 12px 24px -8px rgba(217,18,143,.45)",
        "cta-green": "0 12px 24px -8px rgba(18,161,80,.5)",
        card: "0 18px 40px -18px rgba(30,20,60,.25)",
      },
    },
  },
  plugins: [],
};

export default config;
