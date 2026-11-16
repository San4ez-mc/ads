/** Своя гама реклами: violet на темному slate-тлі. */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: { brand: { DEFAULT: '#8b5cf6', dark: '#7c3aed', light: '#c4b5fd' } },
      fontFamily: { sans: ['Inter', 'system-ui', 'sans-serif'] },
    },
  },
  plugins: [],
};
