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
        display: ['Fraunces', 'Georgia', 'serif'],
        sans: ['Source Sans 3', 'Source Sans Pro', 'system-ui', 'sans-serif'],
        data: ['IBM Plex Mono', 'ui-monospace', 'monospace'],
        montserrat: ['Source Sans 3', 'system-ui', 'sans-serif'],
      },
      colors: {
        lagoon: {
          700: '#0e5c6e',
          800: '#0b4a58',
          950: '#062a33',
        },
        foam: {
          DEFAULT: '#f3f7f6',
          deep: '#e4eeeb',
        },
        kelp: {
          DEFAULT: '#2f6b4f',
          soft: '#3d8a64',
        },
        signal: {
          DEFAULT: '#c45c26',
          soft: '#e8a07a',
        },
        'chart-ink': '#1a2b32',
        muted: '#5a6f76',
        surface: '#ffffff',
        'input-border': '#c5d4d1',
        primary: {
          50: '#f3f7f6',
          100: '#e4eeeb',
          200: '#c5d4d1',
          300: '#7aa0a8',
          400: '#4a7a86',
          500: '#0e5c6e',
          600: '#0b4a58',
          700: '#083d49',
          800: '#062a33',
          900: '#041f26',
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
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
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
