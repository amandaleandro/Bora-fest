import type { Config } from "tailwindcss";
import { boraPreset } from "@borafest/ui";

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
