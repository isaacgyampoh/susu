import type { Config } from 'tailwindcss'

const config: Config = {
  content: ['./components/**/*.{js,ts,jsx,tsx,mdx}', './app/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        field:       '#0A2E1E',
        'field-2':   '#0C3823',
        card:        '#F5EDDC',
        'card-edge': '#E3D5B8',
        ink:         '#1C1917',
        rule:        '#D6C9AE',
        stamp:       '#C1332B',
        gold:        '#F4A200',
        dim:         '#8A7B5E',
        'dim-field': '#7FA890',
        brand: { green: '#0A2E1E', gold: '#F4A200' },
      },
      fontFamily: {
        sans: ['Archivo', 'system-ui', 'sans-serif'],
        mono: ['Courier Prime', 'ui-monospace', 'monospace'],
      },
      animation: {
        'fade-in':  'fadeIn .35s ease-out',
        'slide-up': 'slideUp .4s cubic-bezier(.16,1,.3,1)',
      },
      keyframes: {
        fadeIn:  { '0%': { opacity: '0' }, '100%': { opacity: '1' } },
        slideUp: { '0%': { opacity: '0', transform: 'translateY(12px)' }, '100%': { opacity: '1', transform: 'translateY(0)' } },
      },
    },
  },
  plugins: [],
}
export default config
