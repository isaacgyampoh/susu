import type { Config } from 'tailwindcss'
const config: Config = {
  content: ['./components/**/*.{js,ts,jsx,tsx,mdx}', './app/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        paper:  '#FFFFFF',
        wash:   '#FAFAF9',
        ink:    '#0F0F0F',
        'ink-2':'#6E6E6E',
        'ink-3':'#A8A8A5',
        line:   '#E7E7E4',
        accent: '#F4A200',
        alert:  '#C1332B',
      },
      fontFamily: { sans: ['Archivo', 'system-ui', 'sans-serif'] },
      animation: { 'fade-in': 'fadeIn .3s ease-out' },
      keyframes: { fadeIn: { '0%': { opacity: '0' }, '100%': { opacity: '1' } } },
    },
  },
  plugins: [],
}
export default config
