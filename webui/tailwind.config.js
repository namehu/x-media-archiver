/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        border: "hsl(215 18% 86%)",
        background: "hsl(42 24% 98%)",
        foreground: "hsl(220 18% 16%)",
        muted: "hsl(210 16% 94%)",
        "muted-foreground": "hsl(218 11% 43%)",
        primary: "hsl(168 61% 28%)",
        "primary-foreground": "hsl(0 0% 100%)",
        accent: "hsl(39 84% 55%)",
        destructive: "hsl(0 66% 48%)",
      },
    },
  },
  plugins: [],
};

