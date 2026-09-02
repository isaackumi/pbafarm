/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Avoid Pages Router HMR race: isrManifest → handleStaticIndicator reads
  // window.next.router.components before the router is ready (Next 15.x bug).
  devIndicators: false,
  eslint: {
    ignoreDuringBuilds: true,
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
