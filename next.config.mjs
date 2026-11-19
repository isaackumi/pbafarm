/**
 * Security headers for every route (TD-022, doc 10 §6). The enforced CSP only
 * carries directives that cannot break the app (framing, base, plugins, form
 * targets); the full policy runs as Report-Only until it has been observed in
 * production, then moves to the enforced header.
 */
const CONVEX = 'https://*.convex.cloud wss://*.convex.cloud https://*.convex.site'
const TURNSTILE = 'https://challenges.cloudflare.com'
const R2 = 'https://*.r2.cloudflarestorage.com'
const VERCEL = 'https://vercel.live https://*.vercel-insights.com'

const enforcedCsp = ["frame-ancestors 'none'", "base-uri 'self'", "object-src 'none'", "form-action 'self'"]

const reportOnlyCsp = [
  "default-src 'self'",
  `script-src 'self' ${TURNSTILE} https://vercel.live`,
  // Runtime brand colours (CompanySettingsContext) set inline styles.
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: blob: https://*.convex.cloud https://*.convex.site ${R2}`,
  "font-src 'self' data:",
  `connect-src 'self' ${CONVEX} ${R2} ${VERCEL}`,
  `frame-src ${TURNSTILE} https://vercel.live`,
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "media-src 'self' blob:",
  ...enforcedCsp,
]

const securityHeaders = [
  { key: 'Content-Security-Policy', value: enforcedCsp.join('; ') },
  { key: 'Content-Security-Policy-Report-Only', value: reportOnlyCsp.join('; ') },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
  // Camera for the QR scanner (components/QrScanner.js); nothing else.
  { key: 'Permissions-Policy', value: 'camera=(self), microphone=(), geolocation=(), payment=(), usb=()' },
]

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Avoid Pages Router HMR race: isrManifest → handleStaticIndicator reads
  // window.next.router.components before the router is ready (Next 15.x bug).
  devIndicators: false,
  eslint: {
    ignoreDuringBuilds: true,
  },
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }]
  },
  async redirects() {
    return [
      // Legacy feed-management nested paths → real pages
      {
        source: '/feed-management/purchases',
        destination: '/feed-purchases',
        permanent: false,
      },
      {
        source: '/feed-management/usage',
        destination: '/feed-issue',
        permanent: false,
      },
      {
        source: '/feed-management/types',
        destination: '/feed-types',
        permanent: false,
      },
      {
        source: '/feed-management/suppliers',
        destination: '/feed-suppliers',
        permanent: false,
      },
      // Legacy inventory nested paths → real pages
      {
        source: '/inventory/categories',
        destination: '/feed-types',
        permanent: false,
      },
      {
        source: '/inventory/reports',
        destination: '/inventory/analytics',
        permanent: false,
      },
      {
        source: '/inventory/transactions',
        destination: '/inventory-transactions',
        permanent: false,
      },
      // Legacy cage filter paths → the cage list with a filter
      { source: '/cages/active', destination: '/cages?filter=active', permanent: false },
      { source: '/cages/harvest-ready', destination: '/cages?filter=ready_to_harvest', permanent: false },
      { source: '/cages/maintenance', destination: '/cages?filter=maintenance', permanent: false },
      { source: '/cages/feed-types', destination: '/feed-types', permanent: false },
    ]
  },
  // Fix chunk loading issues
  webpack: (config, { isServer }) => {
    // Ensure proper module resolution
    config.resolve.fallback = {
      ...config.resolve.fallback,
      fs: false,
      net: false,
      tls: false,
    }

    return config
  },
}

export default nextConfig
