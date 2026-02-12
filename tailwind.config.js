import daisyui from "daisyui";

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
  plugins: [daisyui],
  daisyui: {
    themes: [
      {
        salesforce: {
          primary: "#0176d3",
          secondary: "#0b64a0",
          accent: "#129ef2",
          neutral: "#16325c",
          "base-100": "#ffffff",
          "base-200": "#f6f9fe",
          "base-300": "#d8e5f5",
          info: "#129ef2",
          success: "#16a34a",
          warning: "#f59e0b",
          error: "#dc2626"
        }
      }
    ]
  }
};
