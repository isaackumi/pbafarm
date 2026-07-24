import { Html, Head, Main, NextScript } from 'next/document'

export default function Document() {
  return (
    <Html lang="en">
      <Head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,600;9..144,700;9..144,800&family=IBM+Plex+Mono:wght@500;600&family=Source+Sans+3:wght@500;600;700;800&display=swap"
          rel="stylesheet"
        />
      </Head>
      <body className="bg-foam text-chart-ink antialiased">
        <Main />
        <NextScript />
      </body>
    </Html>
  )
}
