/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        surface: {
          DEFAULT: "#030303",
          card: "#0a0a0a",
          elevated: "#121212",
        },
        accent: {
          teal: "#4fd1c5",
          blue: "#3182ce",
          purple: "#805ad5",
          green: "#48bb78",
          amber: "#ecc94b",
        },
      },
      fontFamily: {
        sans: [
          "Inter",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "Roboto",
          "sans-serif",
        ],
      },
      boxShadow: {
        glow: {
          teal: "0 0 20px rgba(79, 209, 197, 0.35)",
          blue: "0 0 24px rgba(49, 130, 206, 0.45)",
          purple: "0 0 18px rgba(128, 90, 213, 0.45)",
        },
      },
    },
  },
  plugins: [],
};
