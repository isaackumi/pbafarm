import { Html, Head, Main, NextScript } from 'next/document'

export default function Document() {
  return (
    <Html lang="en">
      <Head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Figtree:wght@500;600;700&family=JetBrains+Mono:wght@500;600&family=Lexend:wght@600;700;800&display=swap"
          rel="stylesheet"
        />
      </Head>
      <body className="bg-foam text-chart-ink antialiased font-sans">
        <Main />
        <NextScript />
      </body>
    </Html>
  )
}
