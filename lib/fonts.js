/**
 * Self-hosted fonts (MOBILE-007). The variable font files live in
 * public/fonts (SIL Open Font License, from @fontsource-variable), so builds
 * never download from Google and text renders correctly with no signal.
 */
import localFont from 'next/font/local'

export const inter = localFont({
  src: '../public/fonts/inter-latin-wght-normal.woff2',
  weight: '100 900',
  display: 'swap',
})

export const jetbrainsMono = localFont({
  src: '../public/fonts/jetbrains-mono-latin-wght-normal.woff2',
  weight: '100 800',
  display: 'swap',
})

/** Display serif of Ask Anowa's headline (Paper artboard 47). */
export const instrumentSerif = localFont({
  src: '../public/fonts/instrument-serif-latin-400-normal.woff2',
  weight: '400',
  display: 'swap',
})

/** CSS custom properties the stylesheets read (styles/globals.css, theme.css). */
export const fontVariablesCss = `:root{--font-inter:${inter.style.fontFamily};--font-jetbrains:${jetbrainsMono.style.fontFamily};--font-instrument-serif:${instrumentSerif.style.fontFamily};}`
