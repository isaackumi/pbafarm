/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Avoid Pages Router HMR race: isrManifest → handleStaticIndicator reads
  // window.next.router.components before the router is ready (Next 15.x bug).
  devIndicators: false,
  eslint: {
    ignoreDuringBuilds: true,
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
        source: '/inventory/items',
        destination: '/feed-types',
        permanent: false,
      },
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
