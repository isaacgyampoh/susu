import type { Config } from 'tailwindcss'
const config: Config = {
  content: ['./components/**/*.{js,ts,jsx,tsx,mdx}', './app/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        paper: '#FFFFFF',
        tint:  '#F4F7FA',
        ink:   '#0B0F14',
        'ink-2': '#596574',
        'ink-3': '#94A0AE',
        line:  '#E3E9EF',
        blue:  '#0A56C4',
        'blue-lt': '#EAF1FB',
        red: { DEFAULT: '#B4322A', 50: '#FDF2F1', 200: '#F3C9C5', 700: '#8F2820' },
      },
      fontFamily: { sans: ['Inter', 'system-ui', 'sans-serif'] },
      animation: { 'fade-in': 'fadeIn .25s ease-out' },
      keyframes: { fadeIn: { '0%': { opacity: '0' }, '100%': { opacity: '1' } } },
    },
  },
  plugins: [],
}
export default config
