import { describe, expect, it } from 'vitest'
import { buildPlan } from './vercelBuild.mjs'

describe('buildPlan (Vercel build: backend before frontend)', () => {
  it('deploys Convex then builds in Vercel Production with a key', () => {
    const plan = buildPlan({ VERCEL_ENV: 'production', CONVEX_DEPLOY_KEY: 'prod:abc|secret' })
    expect(plan.deployConvex).toBe(true)
    expect(plan.command).toEqual(['npx', ['convex', 'deploy', '--yes', '--cmd', 'npm run build']])
  })

  it('never deploys Convex from a preview, even with a key in scope', () => {
    const plan = buildPlan({ VERCEL_ENV: 'preview', CONVEX_DEPLOY_KEY: 'prod:abc|secret' })
    expect(plan.deployConvex).toBe(false)
    expect(plan.command).toEqual(['npm', ['run', 'build']])
    expect(plan.note).toContain('preview')
  })

  it('falls back to a plain build in Production without a key (today)', () => {
    for (const key of [undefined, '', '   ']) {
      const plan = buildPlan({ VERCEL_ENV: 'production', CONVEX_DEPLOY_KEY: key })
      expect(plan.deployConvex).toBe(false)
      expect(plan.note).toContain('CONVEX_DEPLOY_KEY is not set')
    }
  })

  it('builds only the frontend outside Vercel', () => {
    expect(buildPlan({}).deployConvex).toBe(false)
  })
})
