/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx}',
    './components/**/*.{js,ts,jsx,tsx}',
    './contexts/**/*.{js,ts,jsx,tsx}',
  ],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        display: ['Lexend', 'system-ui', 'sans-serif'],
        sans: ['Figtree', 'system-ui', 'sans-serif'],
        data: ['JetBrains Mono', 'ui-monospace', 'monospace'],
        montserrat: ['Figtree', 'system-ui', 'sans-serif'],
      },
      colors: {
        lagoon: {
          700: '#3f3f46',
          800: '#27272a',
          950: '#18181b',
        },
        foam: {
          DEFAULT: '#f8fafc',
          deep: '#e4e4e7',
        },
        kelp: {
          DEFAULT: '#15803d',
          soft: '#22c55e',
        },
        signal: {
          DEFAULT: '#dc2626',
          soft: '#fca5a5',
        },
        'chart-ink': '#18181b',
        muted: '#71717a',
        surface: '#ffffff',
        'input-border': '#d4d4d8',
        primary: {
          50: '#fafafa',
          100: '#f4f4f5',
          200: '#e4e4e7',
          300: '#a1a1aa',
          400: '#71717a',
          500: '#52525b',
          600: '#3f3f46',
          700: '#27272a',
          800: '#18181b',
          900: '#09090b',
        },
      },
      spacing: {
        72: '18rem',
        84: '21rem',
        96: '24rem',
      },
      maxWidth: {
        '8xl': '88rem',
        '9xl': '96rem',
      },
      borderRadius: {
        '4xl': '2rem',
      },
      animation: {
        'fade-in': 'fadeIn 0.5s ease-in-out',
        'slide-in': 'slideIn 0.5s ease-in-out',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: 0 },
          '100%': { opacity: 1 },
        },
        slideIn: {
          '0%': { transform: 'translateY(100%)' },
          '100%': { transform: 'translateY(0)' },
        },
      },
    },
  },
  plugins: [
    require('@tailwindcss/forms'),
    require('@tailwindcss/typography'),
    require('@tailwindcss/aspect-ratio'),
  ],
}
