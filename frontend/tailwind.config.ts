import type { Config } from 'tailwindcss';

export default {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: { DEFAULT: '#17143A', soft: '#4A4670', faint: '#8A87AD' },
        paper: '#F6F4FF',
        brand: { DEFAULT: '#3D2FD9', dark: '#2F23B3', soft: '#E7E3FF' },
        lilac: '#DAD5FF',
        sun: '#FFC53D',
        ok: { DEFAULT: '#12805C', soft: '#DDF4EA' },
        warn: { DEFAULT: '#9A5B00', soft: '#FFF0CF' },
        bad: { DEFAULT: '#C2362F', soft: '#FDE4E2' },
      },
      fontFamily: {
        display: ['var(--font-display)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        sans: ['var(--font-body)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
} satisfies Config;
