import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        primary: { DEFAULT: "#6d28d9", hover: "#5b21b6" },
        ink: { DEFAULT: "#16121f", soft: "#544e60" },
        muted: { DEFAULT: "#6b6577", 2: "#8b8598", 3: "#a49eb0" },
        bg: { DEFAULT: "#f6f5fb", dark: "#0b0910" },
        sidebar: "#17131f",
        surface: "#ffffff",
        line: { DEFAULT: "#ece9f2", input: "#e0dbec", divider: "#f4f2f8" },
        success: "#12a150",
        warning: "#b45309",
        danger: "#e11d48",
        pix: "#17b0a0",
      },
      fontFamily: { sans: ["var(--font-jakarta)", "system-ui", "sans-serif"] },
      boxShadow: {
        cta: "0 12px 24px -8px rgba(109,40,217,.5)",
        "cta-green": "0 12px 24px -8px rgba(18,161,80,.5)",
        card: "0 18px 40px -18px rgba(30,20,60,.25)",
      },
    },
  },
  plugins: [],
};

export default config;
