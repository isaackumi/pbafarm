/**
 * Self-hosted fonts (MOBILE-007). The variable font files live in
 * public/fonts (SIL Open Font License, from @fontsource-variable), so builds
 * never download from Google and text renders correctly with no signal.
 */
import localFont from 'next/font/local'

export const figtree = localFont({
  src: '../public/fonts/figtree-latin-wght-normal.woff2',
  weight: '300 900',
  display: 'swap',
})

export const lexend = localFont({
  src: '../public/fonts/lexend-latin-wght-normal.woff2',
  weight: '100 900',
  display: 'swap',
})

export const jetbrainsMono = localFont({
  src: '../public/fonts/jetbrains-mono-latin-wght-normal.woff2',
  weight: '100 800',
  display: 'swap',
})

/** CSS custom properties the stylesheets read (styles/globals.css, theme.css). */
export const fontVariablesCss = `:root{--font-figtree:${figtree.style.fontFamily};--font-lexend:${lexend.style.fontFamily};--font-jetbrains:${jetbrainsMono.style.fontFamily};}`
