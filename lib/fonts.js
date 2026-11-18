/**
 * Self-hosted fonts (MOBILE-007). next/font downloads the files at build time
 * and serves them from this app, so text renders in the right face with no
 * signal and no request to Google from the field.
 */
import { Figtree, JetBrains_Mono, Lexend } from 'next/font/google'

export const figtree = Figtree({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  display: 'swap',
})

export const lexend = Lexend({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  display: 'swap',
})

export const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  display: 'swap',
})

/** CSS custom properties the stylesheets read (styles/globals.css, theme.css). */
export const fontVariablesCss = `:root{--font-figtree:${figtree.style.fontFamily};--font-lexend:${lexend.style.fontFamily};--font-jetbrains:${jetbrainsMono.style.fontFamily};}`
