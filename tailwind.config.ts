import type { Config } from 'tailwindcss'

/*
 * Every colour is a CSS variable holding raw RGB channels, surfaced to Tailwind
 * through `rgb(var(--x) / <alpha-value>)`. That indirection is what keeps
 * `bg-ink/25`, `text-danger/60` and friends working while the actual values
 * live in one block in globals.css — swap the theme there, not in 30 files.
 */
const c = (name: string) => `rgb(var(--c-${name}) / <alpha-value>)`

const config: Config = {
  content: ['./components/**/*.{js,ts,jsx,tsx,mdx}', './app/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        // Ground and surfaces
        bg:          c('bg'),
        surface:     c('surface'),
        'surface-2': c('surface-2'),
        'surface-3': c('surface-3'),
        line:        c('line'),
        'line-2':    c('line-2'),

        // Text
        ink:      c('ink'),
        'ink-2':  c('ink-2'),
        'ink-3':  c('ink-3'),
        inverse:  c('inverse'),

        // Brand accent — money, growth, "settled"
        accent: {
          DEFAULT: c('accent'),
          soft:    c('accent-soft'),
          line:    c('accent-line'),
          strong:  c('accent-strong'),
        },

        // Semantic status. A ledger is unreadable without these.
        success: { DEFAULT: c('success'), soft: c('success-soft'), line: c('success-line') },
        warning: { DEFAULT: c('warning'), soft: c('warning-soft'), line: c('warning-line') },
        danger:  { DEFAULT: c('danger'),  soft: c('danger-soft'),  line: c('danger-line'), strong: c('danger-strong') },
        info:    { DEFAULT: c('info'),    soft: c('info-soft'),    line: c('info-line')    },

        /* Legacy aliases. Older screens still name these; they resolve to the
           same tokens so nothing renders unstyled during the migration. */
        paper: c('surface'),
        tint:  c('surface-2'),
        red:   {
          DEFAULT: c('danger'),
          50:  c('danger-soft'),
          200: c('danger-line'),
          700: c('danger-strong'),
        },
      },

      // One scale, ten steps. Replaces 21 ad-hoc arbitrary sizes.
      fontSize: {
        '2xs': ['0.6875rem', { lineHeight: '1rem',     letterSpacing: '0.005em' }], // 11
        xs:    ['0.75rem',   { lineHeight: '1.0625rem' }],                          // 12
        sm:    ['0.8125rem', { lineHeight: '1.125rem' }],                           // 13
        base:  ['0.875rem',  { lineHeight: '1.25rem' }],                            // 14
        md:    ['0.9375rem', { lineHeight: '1.375rem' }],                           // 15
        lg:    ['1.0625rem', { lineHeight: '1.5rem',   letterSpacing: '-0.01em' }], // 17
        xl:    ['1.25rem',   { lineHeight: '1.625rem', letterSpacing: '-0.015em' }],// 20
        '2xl': ['1.5rem',    { lineHeight: '1.875rem', letterSpacing: '-0.02em' }], // 24
        '3xl': ['1.875rem',  { lineHeight: '2.125rem', letterSpacing: '-0.025em' }],// 30
        '4xl': ['2.375rem',  { lineHeight: '2.5rem',   letterSpacing: '-0.03em' }], // 38
      },

      borderRadius: {
        xs:   '0.375rem',  // 6
        sm:   '0.5rem',    // 8
        DEFAULT: '0.625rem', // 10
        md:   '0.625rem',
        lg:   '0.875rem',  // 14
        xl:   '1.125rem',  // 18
        '2xl':'1.5rem',    // 24
      },

      boxShadow: {
        xs:    '0 1px 2px -1px rgb(var(--c-shadow) / .08)',
        sm:    '0 1px 2px -1px rgb(var(--c-shadow) / .08), 0 2px 6px -2px rgb(var(--c-shadow) / .06)',
        DEFAULT:'0 2px 4px -2px rgb(var(--c-shadow) / .08), 0 6px 16px -6px rgb(var(--c-shadow) / .10)',
        md:    '0 4px 8px -4px rgb(var(--c-shadow) / .10), 0 12px 28px -10px rgb(var(--c-shadow) / .14)',
        lg:    '0 8px 16px -8px rgb(var(--c-shadow) / .12), 0 24px 48px -16px rgb(var(--c-shadow) / .18)',
        pop:   '0 12px 24px -8px rgb(var(--c-shadow) / .16), 0 32px 64px -24px rgb(var(--c-shadow) / .24)',
        focus: '0 0 0 3px rgb(var(--c-ink) / .12)',
      },

      fontFamily: {
        sans: ['var(--font-geist-sans)', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'system-ui', 'sans-serif'],
        mono: ['var(--font-geist-mono)', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },

      // Motion that tells you what happened: sheets rise, toasts slide, panels fade.
      keyframes: {
        fadeIn:    { from: { opacity: '0' }, to: { opacity: '1' } },
        fadeOut:   { from: { opacity: '1' }, to: { opacity: '0' } },
        riseIn:    { from: { opacity: '0', transform: 'translateY(8px)' },  to: { opacity: '1', transform: 'none' } },
        sheetUp:   { from: { transform: 'translateY(100%)' },               to: { transform: 'none' } },
        popIn:     { from: { opacity: '0', transform: 'translateY(6px) scale(.985)' }, to: { opacity: '1', transform: 'none' } },
        toastIn:   { from: { opacity: '0', transform: 'translateY(-8px) scale(.97)' }, to: { opacity: '1', transform: 'none' } },
        shimmer:   { from: { backgroundPosition: '200% 0' }, to: { backgroundPosition: '-200% 0' } },
        spin:      { to: { transform: 'rotate(360deg)' } },
        countUp:   { from: { opacity: '0', transform: 'translateY(4px)' }, to: { opacity: '1', transform: 'none' } },
      },
      animation: {
        'fade-in':  'fadeIn .18s ease-out both',
        'rise-in':  'riseIn .24s cubic-bezier(.22,1,.36,1) both',
        'sheet-up': 'sheetUp .3s cubic-bezier(.32,.72,0,1) both',
        'pop-in':   'popIn .18s cubic-bezier(.22,1,.36,1) both',
        'toast-in': 'toastIn .22s cubic-bezier(.22,1,.36,1) both',
        'slide-up': 'riseIn .24s cubic-bezier(.22,1,.36,1) both', // legacy name, now real
        shimmer:    'shimmer 1.6s linear infinite',
        spin:       'spin .7s linear infinite',
      },

      transitionTimingFunction: {
        out: 'cubic-bezier(.22,1,.36,1)',
      },
    },
  },
  plugins: [],
}
export default config
