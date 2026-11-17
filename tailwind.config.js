/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        // Official SIL brand colors, from the SIL Brand Resource Center:
        // https://sites.google.com/sil.org/brand-resource-center/branding/visual-brand
        brand: {
          DEFAULT: '#005CB9', // SIL Blue
          dark: '#034D8A',    // SIL Darker Blue
          accent: '#FF6B00',  // SIL Orange
        },
        sil: {
          blue: '#005CB9',
          'light-blue': '#00A7E1',
          violet: '#93358D',
          red: '#D52227',
          orange: '#FF6B00',
          green: '#509E2F',
          yellow: '#FFB71B',
          gray: '#666666',
        },
      },
      fontFamily: {
        // SIL brand typography: Source Sans 3 for body/UI (default sans),
        // Playfair Display reserved for headlines — use `font-display`.
        sans: ['"Source Sans 3"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        display: ['"Playfair Display"', 'ui-serif', 'Georgia', 'serif'],
      },
    },
  },
  plugins: [],
}
