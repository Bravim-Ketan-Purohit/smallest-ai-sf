import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["class"],
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "hsl(var(--bg) / <alpha-value>)",
        panel: "hsl(var(--panel) / <alpha-value>)",
        text: "hsl(var(--text) / <alpha-value>)",
        muted: "hsl(var(--muted) / <alpha-value>)",
        accent: "hsl(var(--accent) / <alpha-value>)",
        danger: "hsl(var(--danger) / <alpha-value>)",
        warning: "hsl(var(--warning) / <alpha-value>)",
      },
      boxShadow: {
        soft: "0 15px 40px -25px rgba(15, 23, 42, 0.35)",
      },
      keyframes: {
        pulseDot: {
          "0%, 100%": { transform: "scale(1)", opacity: "0.5" },
          "50%": { transform: "scale(1.3)", opacity: "1" },
        },
        riseIn: {
          "0%": { transform: "translateY(6px)", opacity: "0" },
          "100%": { transform: "translateY(0)", opacity: "1" },
        },
      },
      animation: {
        pulseDot: "pulseDot 1.2s ease-in-out infinite",
        riseIn: "riseIn 260ms ease-out",
      },
    },
  },
  plugins: [],
};

export default config;
