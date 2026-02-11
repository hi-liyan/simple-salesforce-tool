/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#f5fbff",
          100: "#d8f0ff",
          200: "#b5e5ff",
          300: "#7fd2ff",
          400: "#46bcff",
          500: "#129ef2",
          600: "#0b7fca",
          700: "#0b64a0",
          800: "#0e5684",
          900: "#12486e"
        }
      },
      boxShadow: {
        panel: "0 10px 30px rgba(18, 72, 110, 0.12)"
      }
    }
  },
  plugins: []
};
