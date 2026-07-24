import type { Config } from "tailwindcss";

// Tokens do handoff (docs/design/README.md) — cores, sombras e raios finais.
const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        primary: { DEFAULT: "#6d28d9", hover: "#5b21b6" },
        ink: { DEFAULT: "#16121f", soft: "#544e60" },
        muted: { DEFAULT: "#6b6577", 2: "#8b8598", 3: "#a49eb0", 4: "#c5bed6" },
        bg: { DEFAULT: "#f6f5fb", dark: "#0b0910" },
        surface: "#ffffff",
        line: { DEFAULT: "#ece9f2", input: "#e0dbec", divider: "#f4f2f8" },
        success: "#12a150",
        warning: "#b45309",
        danger: "#e11d48",
        pix: { DEFAULT: "#17b0a0", text: "#0f766e" },
        accent: "#ec4899",
      },
      fontFamily: {
        sans: ["var(--font-jakarta)", "system-ui", "sans-serif"],
      },
      boxShadow: {
        cta: "0 12px 24px -8px rgba(109,40,217,.5)",
        "cta-green": "0 12px 24px -8px rgba(18,161,80,.5)",
        card: "0 18px 40px -18px rgba(30,20,60,.25)",
      },
      backgroundImage: {
        "brand-gradient": "linear-gradient(135deg,#6d28d9,#9333ea)",
      },
      keyframes: {
        pop: { "0%": { transform: "scale(.5)", opacity: "0" }, "100%": { transform: "scale(1)", opacity: "1" } },
        shake: {
          "0%,100%": { transform: "translateX(0)" },
          "20%,60%": { transform: "translateX(-8px)" },
          "40%,80%": { transform: "translateX(8px)" },
        },
        pulseDot: { "0%,100%": { opacity: "1" }, "50%": { opacity: ".35" } },
      },
      animation: {
        pop: "pop .45s cubic-bezier(.2,1.4,.5,1) both",
        shake: "shake .45s ease-in-out",
        pulseDot: "pulseDot 1.4s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};

export default config;
