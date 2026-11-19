import { Html, Head, Main, NextScript } from 'next/document'

// Runs before first paint: apply the saved theme (dark by default) and outdoor
// contrast so the page never flashes the wrong palette. ThemeContext keeps it in sync.
const THEME_SCRIPT = `(function(){try{var d=document.documentElement;var t=localStorage.getItem('theme')==='light'?'light':'dark';d.dataset.theme=t;d.classList.toggle('dark',t==='dark');d.style.colorScheme=t;if(localStorage.getItem('pbafarm:contrast')==='high')d.dataset.contrast='high';var m=document.querySelector('meta[name="theme-color"]');if(m)m.setAttribute('content',t==='dark'?'#0a0b0c':'#f5f6f7');}catch(e){}})();`

export default function Document() {
  return (
    <Html lang="en" data-theme="dark" className="dark">
      <Head>
        <link rel="manifest" href="/manifest.webmanifest" />
        <link rel="icon" href="/icon.svg" type="image/svg+xml" />
        <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png" />
        <meta name="theme-color" content="#0a0b0c" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-title" content="Anowa" />
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </Head>
      <body className="bg-bg text-text antialiased font-sans">
        <Main />
        <NextScript />
      </body>
    </Html>
  )
}
