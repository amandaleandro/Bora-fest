import type { Config } from "tailwindcss";

export const boraPreset: Partial<Config> = {
  theme: {
    extend: {
      colors: {
        background: {
          DEFAULT: "#090D16",
          card: "#0F172A",
          elevated: "#1E293B",
          hover: "#334155",
        },
        brand: {
          DEFAULT: "#F1126E", // rosa da marca (gradiente magenta→rosa→laranja)
          hover: "#D9128F",
          light: "#F868A6",
          dark: "#8E0B54",
          glow: "rgba(241, 18, 110, 0.25)",
        },
        accent: {
          DEFAULT: "#10B981", // Emerald Neon
          hover: "#059669",
          light: "#34D399",
          glow: "rgba(16, 185, 129, 0.25)",
        },
        neon: {
          pink: "#EC4899",
          cyan: "#06B6D4",
          amber: "#F59E0B",
        },
      },
      fontFamily: {
        sans: ["Plus Jakarta Sans", "Inter", "sans-serif"],
      },
      boxShadow: {
        "glow-brand": "0 0 20px -3px rgba(241, 18, 110, 0.35)",
        "glow-accent": "0 0 20px -3px rgba(16, 185, 129, 0.35)",
        "glass": "0 8px 32px 0 rgba(0, 0, 0, 0.37)",
      },
      backgroundImage: {
        "gradient-radial": "radial-gradient(var(--tw-gradient-stops))",
        "hero-pattern": "radial-gradient(circle at 50% 0%, rgba(241,18,110,0.15) 0%, rgba(9,13,22,0) 70%)",
        "brand-gradient": "linear-gradient(135deg,#C913DB 0%,#F1126E 55%,#FB7032 100%)",
      },
    },
  },
};
