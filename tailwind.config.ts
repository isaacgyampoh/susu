import type { Config } from 'tailwindcss'

const config: Config = {
  content: ['./components/**/*.{js,ts,jsx,tsx,mdx}', './app/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        canvas:   '#E9F1EC',
        surface:  '#FFFFFF',
        ink:      '#0A1F14',
        forest:   '#0B4A2C',
        gold:     '#F4A200',
        muted:    '#6B7F73',
        hairline: '#DCE8E1',
        brand: {
          green:        '#0B4A2C',
          'green-mid':  '#1A6940',
          'green-light':'#E8F5EE',
          gold:         '#F4A200',
          'gold-mid':   '#FBBF24',
        },
      },
      fontFamily: {
        sans: ['Plus Jakarta Sans', 'system-ui', 'sans-serif'],
      },
      animation: {
        'fade-in':  'fadeIn 0.4s ease-out',
        'slide-up': 'slideUp 0.45s cubic-bezier(0.16, 1, 0.3, 1)',
        'ring-in':  'ringIn 1.1s cubic-bezier(0.16, 1, 0.3, 1) forwards',
      },
      keyframes: {
        fadeIn:  { '0%': { opacity: '0' }, '100%': { opacity: '1' } },
        slideUp: { '0%': { opacity: '0', transform: 'translateY(14px)' }, '100%': { opacity: '1', transform: 'translateY(0)' } },
        ringIn:  { '0%': { strokeDashoffset: '999' }, '100%': { strokeDashoffset: '0' } },
      },
    },
  },
  plugins: [],
}
export default config
