/**
 * What `npm run vercel-build` does (scripts/vercel-build.mjs). Vercel runs the
 * `vercel-build` script instead of `build` when it exists.
 *
 * In Vercel Production with a CONVEX_DEPLOY_KEY, the backend is deployed first
 * and the frontend is built only if that succeeds, so a page never ships before
 * the Convex functions it calls (the `home:overview` gap on 2026-11-21).
 * `convex deploy --cmd` also hands the build the deployment URL as
 * NEXT_PUBLIC_CONVEX_URL, so the two always point at the same backend.
 *
 * Previews and builds without a key only build the frontend: a preview must
 * never push its branch's functions to the production backend.
 */
export function buildPlan(env) {
  const isProduction = env.VERCEL_ENV === 'production'
  const hasKey = Boolean(env.CONVEX_DEPLOY_KEY && env.CONVEX_DEPLOY_KEY.trim())
  if (isProduction && hasKey) {
    return {
      deployConvex: true,
      command: ['npx', ['convex', 'deploy', '--yes', '--cmd', 'npm run build']],
      note: 'Vercel Production: deploying Convex, then building the frontend.',
    }
  }
  const reason = !isProduction
    ? `VERCEL_ENV is ${env.VERCEL_ENV || 'unset'}, not production`
    : 'CONVEX_DEPLOY_KEY is not set for Vercel Production'
  return {
    deployConvex: false,
    command: ['npm', ['run', 'build']],
    note: `Building the frontend only (${reason}); Convex is deployed by the "Deploy Convex" GitHub Action.`,
  }
}
