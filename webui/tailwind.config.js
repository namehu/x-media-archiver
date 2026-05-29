/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        "bg-base": "hsl(var(--bg-base))",
        "bg-surface": "hsl(var(--bg-surface))",
        "bg-elevated": "hsl(var(--bg-elevated))",
        "bg-muted": "hsl(var(--bg-muted))",
        "border-subtle": "hsl(var(--border-subtle))",
        "border-strong": "hsl(var(--border-strong))",
        "fg-primary": "hsl(var(--fg-primary))",
        "fg-secondary": "hsl(var(--fg-secondary))",
        "fg-tertiary": "hsl(var(--fg-tertiary))",
        brand: {
          DEFAULT: "hsl(var(--brand))",
          hover: "hsl(var(--brand-hover))",
          soft: "hsl(var(--brand-soft) / 0.08)",
        },
        success: "hsl(var(--success))",
        warning: "hsl(var(--warning))",
        danger: "hsl(var(--danger))",
        info: "hsl(var(--info))",
        accent: "hsl(var(--accent))",
      },
      borderRadius: {
        md: "6px",
        lg: "10px",
        xl: "14px",
      },
      boxShadow: {
        1: "var(--shadow-1)",
        2: "var(--shadow-2)",
        3: "var(--shadow-3)",
      },
      transitionTimingFunction: {
        out: "var(--ease-out)",
        spring: "var(--ease-spring)",
      },
      transitionDuration: {
        fast: "var(--dur-fast)",
        base: "var(--dur-base)",
        slow: "var(--dur-slow)",
      },
      fontSize: {
        xs: ["11px", { lineHeight: "1.55" }],
        sm: ["13px", { lineHeight: "1.55" }],
        base: ["14px", { lineHeight: "1.55" }],
        lg: ["16px", { lineHeight: "1.5" }],
        xl: ["20px", { lineHeight: "1.4" }],
        "2xl": ["28px", { lineHeight: "1.25" }],
        "3xl": ["36px", { lineHeight: "1.1" }],
      },
      keyframes: {
        shimmer: {
          "0%": { backgroundPosition: "-200% 0" },
          "100%": { backgroundPosition: "200% 0" },
        },
        breathe: {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.55" },
        },
      },
      animation: {
        shimmer: "shimmer 1.6s linear infinite",
        breathe: "breathe 1.8s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};
