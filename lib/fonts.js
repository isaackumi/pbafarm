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

/** Marketing site display face (Paper landing v4, legal pages, 404). */
export const interTight = localFont({
  src: '../public/fonts/inter-tight-latin-wght-normal.woff2',
  weight: '100 900',
  display: 'swap',
})

/** Marketing eyebrows and buttons (uppercase mono). */
export const dmMono = localFont({
  src: [
    { path: '../public/fonts/dm-mono-latin-400-normal.woff2', weight: '400' },
    { path: '../public/fonts/dm-mono-latin-500-normal.woff2', weight: '500' },
  ],
  display: 'swap',
})

/** The "anowa" wordmark and figures. */
export const geistMono = localFont({
  src: '../public/fonts/geist-mono-latin-wght-normal.woff2',
  weight: '100 900',
  display: 'swap',
})

/** CSS custom properties the stylesheets read (styles/globals.css, theme.css). */
export const fontVariablesCss = `:root{--font-inter:${inter.style.fontFamily};--font-jetbrains:${jetbrainsMono.style.fontFamily};--font-instrument-serif:${instrumentSerif.style.fontFamily};--font-inter-tight:${interTight.style.fontFamily};--font-dm-mono:${dmMono.style.fontFamily};--font-geist-mono:${geistMono.style.fontFamily};}`
