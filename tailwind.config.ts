import type { Config } from 'tailwindcss'
const config: Config = {
  content: ['./components/**/*.{js,ts,jsx,tsx,mdx}', './app/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        surface:   '#FFFFFF',
        green:     '#0B4A2C',
        'green-2': '#17703F',
        'green-50':'#E9F5EC',
        ink:       '#14261C',
        'ink-2':   '#5F7268',
        'ink-3':   '#93A79A',
        line:      '#DDEAE1',
        gold:      '#F4A200',
        red: {
          DEFAULT: '#C4382F',
          50:  '#FDF2F1',
          400: '#D9635B',
        },
      },
      fontFamily: { sans: ['Plus Jakarta Sans', 'system-ui', 'sans-serif'] },
      animation: { 'fade-in': 'fadeIn .3s ease-out', 'slide-up': 'slideUp .35s cubic-bezier(.16,1,.3,1)' },
      keyframes: {
        fadeIn: { '0%': { opacity: '0' }, '100%': { opacity: '1' } },
        slideUp: { '0%': { opacity: '0', transform: 'translateY(12px)' }, '100%': { opacity: '1', transform: 'translateY(0)' } },
      },
    },
  },
  plugins: [],
}
export default config
