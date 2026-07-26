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
          700: '#0d9488',
          800: '#0f766e',
          950: '#0b3d3a',
        },
        foam: {
          DEFAULT: '#f4f8f7',
          deep: '#d7e8e4',
        },
        kelp: {
          DEFAULT: '#15803d',
          soft: '#22a06b',
        },
        signal: {
          DEFAULT: '#dc2626',
          soft: '#fca5a5',
        },
        'chart-ink': '#134e4a',
        muted: '#5f7471',
        surface: '#ffffff',
        'input-border': '#c5d8d4',
        primary: {
          50: '#f4f8f7',
          100: '#d7e8e4',
          200: '#c5d8d4',
          300: '#5ea8a0',
          400: '#2a9b90',
          500: '#0d9488',
          600: '#0f766e',
          700: '#0d5f59',
          800: '#0b3d3a',
          900: '#072926',
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
