import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'edge-runtime',
    server: { deps: { inline: ['convex-test'] } },
    include: ['convex/**/*.test.ts', '{lib,components,hooks,contexts}/**/*.test.{js,ts}', 'workers/*/src/**/*.test.ts'],
  },
})
