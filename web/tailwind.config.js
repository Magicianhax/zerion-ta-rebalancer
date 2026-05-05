/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui"],
        mono: ["JetBrains Mono", "ui-monospace", "monospace"],
      },
      colors: {
        ink: {
          900: "#0a0a0b",
          800: "#111114",
          700: "#1a1a1f",
          600: "#26262d",
          500: "#3a3a44",
          400: "#6b6b78",
          300: "#9c9caa",
          200: "#c8c8d0",
          100: "#e8e8ee",
        },
        accent: {
          DEFAULT: "#7c5cff",
          dim: "#5a3fd9",
        },
      },
    },
  },
  plugins: [],
};
