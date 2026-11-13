/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/client/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      // Identidade visual ConectaLab (logo e crachás da Feira EI2026)
      colors: {
        conecta: {
          green: '#1B5632', // verde principal (fundo)
          deep: '#123D23', // verde mais escuro (títulos, botões)
          lime: '#C6F04D', // verde-limão (destaque, "Lab", disponível)
          cream: '#F6F3E8', // creme (cartões, texto claro)
          mist: '#E9E5D6', // creme um tom abaixo (bordas e campos)
        },
      },
      fontFamily: {
        sans: ['"Bricolage Grotesque Variable"', 'system-ui', 'sans-serif'],
      },
      borderRadius: {
        card: '1.75rem',
      },
    },
  },
  plugins: [],
};
