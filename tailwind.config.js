/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        display: ['"Playfair Display"', 'serif'],
        body: ['"DM Sans"', 'sans-serif'],
      },
      colors: {
        stage: {
          50: '#fdf8f0',
          100: '#f5ead8',
          900: '#1a1208',
        },
        gold: {
          400: '#f5c842',
          500: '#e6b22e',
          600: '#c49a1e',
        }
      }
    },
  },
  plugins: [],
}
