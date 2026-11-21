import { Html, Head, Main, NextScript } from 'next/document'
import { BRAND } from '../lib/brand'
import { THEME_SCRIPT } from '../lib/themeScript.mjs'

export default function Document() {
  return (
    <Html lang="en" data-theme="dark" className="dark">
      <Head>
        <link rel="manifest" href="/manifest.webmanifest" />
        <link rel="icon" href="/favicon.ico" sizes="32x32" />
        <link rel="icon" href="/icon.svg" type="image/svg+xml" />
        <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png" />
        <meta name="theme-color" content="#0a0b0c" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-title" content="Anowa" />
        <meta name="application-name" content="Anowa" />
        <meta property="og:site_name" content="Anowa" />
        <meta property="og:type" content="website" />
        <meta property="og:image" content={`${BRAND.appUrl}/og.png`} />
        <meta property="og:image:width" content="1200" />
        <meta property="og:image:height" content="630" />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:image" content={`${BRAND.appUrl}/og.png`} />
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </Head>
      <body className="bg-bg text-text antialiased font-sans">
        <Main />
        <NextScript />
      </body>
    </Html>
  )
}
