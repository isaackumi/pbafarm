import { ConvexReactClient } from 'convex/react'

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL

if (!convexUrl && typeof window !== 'undefined') {
  console.error(
    'Missing NEXT_PUBLIC_CONVEX_URL. Run `npx convex dev` and add the URL to .env.local.',
  )
}

export const convex = new ConvexReactClient(convexUrl || 'https://placeholder.convex.cloud')
