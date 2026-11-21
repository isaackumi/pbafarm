# Environments, deploys, errors and monitoring (OPS-001)

> Code parts implemented in `feat/w2-ops-infra`. The owner steps at the end
> (create deployments, keys, protection rules, DSN) are **not done**; nothing
> in this PR touched Convex, Vercel, Cloudflare or GitHub settings.

## 1. Environments

| Environment | Convex deployment | Frontend | Deployed by | Data |
|---|---|---|---|---|
| Production | new prod deployment (to be created; Q-002) | Vercel Production | `deploy-production` job, `main` only, `production` GitHub environment | live |
| Staging | separate deployment (OPS-004) | Vercel Preview (env vars scoped to Preview) behind Cloudflare Access (CF-007) | `deploy-staging` job: `main`, `release/**`, manual | copy of live (`scripts/ops/staging-refresh.sh`) |
| Today's live | `vibrant-stork-860` (a **dev** deployment) | Vercel Production | `CONVEX_DEPLOY_KEY` points here until cutover | live |
| Developer | personal `npx convex dev` deployments | localhost | developer | synthetic |

Cutover from `vibrant-stork-860` to the new production deployment:
[staging-and-cutover.md](staging-and-cutover.md).

## 2. Deploy pipeline (`.github/workflows/convex-deploy.yml`)

1. **verify** — `npm ci`, lint, `tsc -p convex`, tests. Nothing deploys if it fails.
2. **deploy-staging** — uses `CONVEX_DEPLOY_KEY_STAGING`. If the secret is
   unset the job logs a notice and succeeds without deploying, so the pipeline
   works before staging exists.
3. **deploy-production** — uses `CONVEX_DEPLOY_KEY`, runs only for `main`,
   only after staging succeeded (or was skipped by a manual dispatch with
   `target: production`), and runs in the `production` GitHub environment.
   A release branch (`release/**`) never reaches production.

Manual runs: Actions → Deploy Convex → Run workflow → `target` =
`staging` | `production` | `both`.

### Backend and frontend ship together (Vercel build)

Vercel publishes the frontend as soon as `main` moves, while the Action above
deploys Convex only after lint, type-check and tests (about 5 minutes). Any
merge that adds a Convex function therefore had a window where the live page
called a function the backend did not have yet ("Could not find public
function for 'home:overview'", 2026-11-21).

`package.json` now has a `vercel-build` script (`scripts/vercel-build.mjs`,
logic in `lib/vercelBuild.mjs`), which Vercel runs instead of `build`:

| Vercel environment | `CONVEX_DEPLOY_KEY` in Vercel | What the build does |
|---|---|---|
| Production | set | `npx convex deploy --cmd 'npm run build'`: deploy Convex, then build the frontend against that deployment's URL. A failed backend deploy fails the build, so the old site stays up. |
| Production | not set (today) | `npm run build` only, with a log line saying so. Convex is still deployed by the Action. |
| Preview / development | any | `npm run build` only. A preview never pushes its branch's functions to the production backend. |

Owner steps to switch it on (both are needed, in this order):

1. Vercel → Project → Settings → Environment Variables: add
   `CONVEX_DEPLOY_KEY` (the same key as the GitHub secret) scoped to
   **Production only**. If the project's Build Command is overridden in the
   dashboard, clear it so `vercel-build` is used.
2. GitHub → Settings → Secrets and variables → Actions → Variables: add
   `CONVEX_DEPLOYS_FROM_VERCEL` = `true` on every repo that runs this workflow
   (`Hei-Tech-Inc/anowa` and `isaackumi/pbafarm`). The Action then still
   verifies every push but skips its production deploy, so a run finishing
   minutes after Vercel cannot roll the backend back to an older commit.
   Manual runs with `target: production` still deploy.

Pull request CI (`ci.yml`) still runs lint, type-check and tests before
anything is merged.

`convex deploy` itself type-checks and validates the schema against existing
data, so a schema change that existing rows violate fails on staging (which
holds a copy of live data) before production.

## 3. User-facing errors (`ConvexError`)

In production Convex replaces the message of a plain `Error` with
"Server Error", so validation messages must be thrown as `ConvexError`.
Use `userError(code, message)` from `convex/lib/errors.ts`; the client reads
`err.data.message` (`lib/errorMessage.js`). Codes: `VALIDATION`, `NOT_FOUND`,
`CONFLICT`, `INSUFFICIENT_STOCK`, `DUPLICATE`, `FORBIDDEN`, ….

Converted in this change: every person-facing refusal in
`convex/lib/feedLedger.ts` and `convex/dailyRecords.ts` (dates, quantities,
stock, cycle, duplicates, batch lines). A failing line in a batch save keeps
its code and is prefixed with the line number. Two `throw new Error` remain on
purpose: internal invariants a person cannot act on.

## 4. Error boundaries

- `pages/_app.js` wraps everything (auth, settings, i18n providers included)
  in a **root** `ErrorBoundary` whose fallback (`RootErrorFallback`) uses no
  providers, theme or UI kit, so a crash in a provider shows a reload screen
  instead of a blank page. It resets on navigation.
- Page content and the assistant keep their own boundaries, so a page crash
  keeps the layout and navigation usable.

## 5. Error monitoring (optional, Q-012)

No SDK. `convex/lib/monitoring.ts` posts one Sentry envelope per error; with
no DSN everything is a no-op.

| Where | Variable | Set in | Reports |
|---|---|---|---|
| Browser | `NEXT_PUBLIC_SENTRY_DSN` (+ optional `NEXT_PUBLIC_APP_ENV`) | Vercel, per environment (build time) | render errors caught by any boundary, `window.onerror`, unhandled rejections; max 20 per page load |
| Convex actions | `SENTRY_DSN` (+ optional `SENTRY_ENVIRONMENT`) | `npx convex env set` on each deployment | errors thrown inside `withErrorReporting('module:fn', async () => …)` |

Not reported: `ConvexError`/`userError` refusals (expected outcomes).
Not sent: arguments, request bodies, emails, query strings — only error type,
message, stack, page path or function name, environment and release.

Queries and mutations cannot call `fetch`; their errors are in the Convex
dashboard Logs. For alerting on those, enable a Convex **log stream** (Pro
plan; Settings → Integrations) to the same vendor. Any vendor that accepts a
Sentry DSN works (Sentry, GlitchTip, Bugsink).

Wrapped today: `r2Sync:copyToR2`, `r2Sync:reconcileR2`. Wrap other actions
the same way when touched (AI proxy, webhooks, automation runs).

## 6. Owner steps (in order)

1. **Convex** (Q-002, Q-032): create the production deployment (and a staging
   project/deployment for OPS-004). Record the plan and enable daily backups
   (Settings → Backups) on production; fill in `backup-restore.md` §1.
2. **Env vars on the new deployments**: copy from `vibrant-stork-860`
   (`npx convex env list --deployment vibrant-stork-860 --names-only`):
   `JWT_PRIVATE_KEY`, `JWKS`, `SITE_URL` (the production/staging frontend URL, prod `https://app.getanowa.com`),
   LLM keys, then `SENTRY_DSN` if used.
3. **GitHub** → Settings → Environments:
   - `production`: required reviewers (owner), deployment branches = `main`.
     Move `CONVEX_DEPLOY_KEY` into it as an environment secret holding the
     **prod** deploy key (today the repo secret holds the dev key).
   - `staging`: secret `CONVEX_DEPLOY_KEY_STAGING` = staging deploy key.
4. **Vercel**: confirm the plan is Pro (CF-001). Production env vars point at
   the prod deployment (at cutover); Preview env vars point at staging.
   Add `NEXT_PUBLIC_SENTRY_DSN` per environment if monitoring is wanted.
5. Run the first restore drill (`backup-restore.md` §2) and record it.

Acceptance (tracker OPS-001): prod and staging live; restore drill recorded;
validation messages visible in prod; boundary catches render errors.
