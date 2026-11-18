# 06 — Release Strategy

Date: 2026-11-18. Status: Proposed — awaiting owner approval. Sources: doc 01 §5–6, doc 12 §7–8, doc 13 §33–34, D-011.

## 1. Current state

| Piece | Today | Evidence |
|---|---|---|
| Convex | One deployment, `vibrant-stork-860`, which is a **dev** deployment acting as production | `.env.local` `CONVEX_DEPLOYMENT=dev:vibrant-stork-860`; `.github/workflows/convex-deploy.yml:3-5` |
| Backend deploys | Every push to `main` touching `convex/**` runs `npx convex deploy --yes` with no tests. Ran three times on 2026-11-18 (PR #7, #8, #13 merges) | doc 12 §7; `gh run list --workflow convex-deploy.yml` |
| Developer pushes | `.env.local` carries the same dev deploy key; `npm run dev:backend` from any branch pushes functions **and schema** to the live deployment | doc 01 §6, doc 12 §7 "Drift" |
| Frontend | Vercel (inferred); project settings and which Convex URL production uses cannot be verified from the repo | doc 13 §33 |
| Ordering | Frontend and backend deploy independently | doc 12 §7 |
| Backups | Nothing in the repo; dashboard settings unknown | doc 12 §8 |
| Flags | None | — |

## 2. Target environments

| Environment | Convex deployment | Frontend | Data | Who deploys |
|---|---|---|---|---|
| **Personal dev** | One per developer (`npx convex dev` with a personal project/deployment) | `next dev` locally | Seeded fixtures (`seed` as an internal function run from the CLI) | Each developer |
| **Dev (shared)** | `vibrant-stork-860` — after the cutover in §3 it becomes a shared integration sandbox with no real data | Vercel preview (optional) | Synthetic | CI from feature branches on request |
| **Staging** | New `staging` deployment | Vercel preview environment | Copy of production restored from the latest backup, refreshed before each migration rehearsal; personal data masked if required (Q-021) | CI on merge to `main` |
| **Production** | New `prod` deployment | Vercel production | Real farm data | CI on a release tag, with manual approval |

Deploy keys: production and staging keys exist only as GitHub Actions secrets (environment-protected). Laptops hold only personal dev keys. The current shared dev key is rotated after the cutover.

## 3. Cutover from `vibrant-stork-860` to production (OPS-001, M14)

Precondition: owner confirms whether real users use `vibrant-stork-860` and which Vercel URL they use (Q-002). If not, the cutover is just "create prod, point Vercel at it".

1. Create `prod` and `staging` deployments; set env vars (`JWT_PRIVATE_KEY`, `JWKS`, `SITE_URL`, LLM keys) — `SITE_URL` and the auth issuer change with the deployment, so existing sessions end and users sign in again.
2. Deploy `main` (with Phase 0 hotfixes) to `prod`.
3. Announce a maintenance window (field staff: record on paper or let the outbox queue; the queued batches will fail against the old deployment if it is made read-only, so time the window outside daily-entry hours, before 16:00 UTC reminders).
4. Put `vibrant-stork-860` in read-only mode (deploy a build where mutations refuse with a `MAINTENANCE` code) and run `npx convex export --include-file-storage`.
5. `npx convex import` into `prod`; compare document counts per table (P10 list) and spot-check five cages, feed stock levels and the latest audit rows.
6. Switch Vercel production `NEXT_PUBLIC_CONVEX_URL` to `prod`; redeploy frontend; smoke test (sign-in, dashboard, daily entry, approvals).
7. Keep `vibrant-stork-860` read-only for 30 days as a fallback, then wipe it to synthetic data.

**Rollback:** until step 6 is verified, re-point Vercel to `vibrant-stork-860` and lift read-only. After users have written to `prod`, rollback means exporting those writes; so the decision point is the smoke test in step 6.

Note: auth tables move with the export, but sessions are tied to the issuer; everyone signs in again. Users with forgotten passwords need admin resets until SEC-005 (password reset) exists.

## 4. Branching and PR rules

- `main` is always deployable to staging. Feature branches: `feat/<id>-<slug>`, `fix/<id>-<slug>` (tracker ID in the name, e.g. `fix/PROD-000a-harvest-undo`).
- **No stacked PRs targeting other feature branches** for backend work. The 2026-11-18 stack left #14 merged into a branch after that branch had already merged, so it never reached `main` (`03-development-roadmap.md` §0.1). If stacking is needed, merge strictly bottom-up and re-target each PR to `main` before merging.
- One tracker item per PR where possible; Phase 0 hotfixes may group closely related scenarios (e.g. PROD-000a + b).
- PR description template: tracker ID; Rule 3 headings (what exists, problem, why, files, dependents, what could break, backward compatibility); migration ID and step if schema changes; test evidence; rollback.
- Required: CI gates (`05-testing-and-quality-plan.md` §8) and one review. Schema-changing PRs also require a staging rehearsal note.
- Squash merge; the PR title becomes the changelog line (`docs/project-management/CHANGELOG.md`).

## 5. Feature flags per organization

- Storage: `companies.settings.features` (a validated object, not `v.any()`) for per-org flags, plus a small `featureFlags` table for global kill switches (e.g. `engineReads`, `legacyReminderCron`).
- Read via one helper `isEnabled(ctx, company, flag)` on the server and a `useFeature(flag)` hook on the client (from the existing `CompanySettingsContext`).
- Flag lifecycle: introduced with the feature (default off), enabled for pilot orgs, enabled globally, removed within two releases of global enablement.
- Flags used by this roadmap: `engineReads` (Phase 4), `membershipGuard` (Phase 1 dual-read), `permissionGuardEnforce` (Phase 3 shadow → enforce), `hatchery`, `ponds`, `ras` (Phases 5–6), `offlineAllForms` (Phase 7), `customFields` (Phase 8), `costing` (Phase 9), `automations` (Phase 10), `integrations` (Phase 11).

## 6. Data-migration release choreography

For each migration in `04-migration-and-compatibility-plan.md`:

| Release | Contents | Gate to next release |
|---|---|---|
| R1 | Widen (schema + indexes) only | Deploy succeeded; index builds finished |
| R2 | Dual-write code | No errors for 48 h; new structure filling |
| (job) | Backfill on staging copy → compare → on prod after a fresh backup | Counts and verification queries match; owner reviews reconciliation reports (M1, M7) |
| R3 | Switch reads behind the flag; enable for pilot orgs | Pilot sign-off; reconciliation clean for the agreed period |
| R4 | Enable for all orgs | 7 days clean |
| R5 | Narrow (remove old writes/fields) | Owner approval; backup taken immediately before |

Backend before frontend: a release that the new frontend depends on is deployed to Convex first; the frontend is deployed only after the backend is live. Backend changes stay backward compatible with the previous frontend for one release (new args optional, old response fields kept).

## 7. Pilot farms

- **Pilot 1: the existing customer** (Ghana, tilapia cages, several sites). Every Phase 0 fix and every flag is enabled for them first in staging (with their data copy) and then in production.
- **Pilots 2–3** (from Phase 1 onward, owner to nominate, Q-022): ideally one pond farm and one hatchery/nursery, ideally one outside UTC+0 to exercise timezones (Phase 2) and one non-GHS currency.
- Pilot agreement: named contact, weekly feedback, a known rollback (flag off) and an export of their data on request.
- Exit criteria per pilot: the acceptance criteria of the enabled features hold on their data; no Sev-1 incident for 14 days.

## 8. Rollback

| Change type | Rollback |
|---|---|
| Frontend | Vercel instant rollback to the previous deployment |
| Backend code | Redeploy the previous tag from CI (`npx convex deploy` of the prior commit) |
| Flagged behaviour | Turn the flag off for the org or globally |
| Additive schema | Leave in place; code stops using it |
| Backfill | Delete tagged rows / restore fields from `migrationLog` |
| Narrowing or data deletion | Restore from the backup taken immediately before; requires owner approval in advance (PART 16) |
| Deployment cutover | §3 |

## 9. Incident basics (until a full runbook exists)

- Severity: Sev-1 = data corruption, cross-tenant exposure or production down; Sev-2 = a field flow broken; Sev-3 = other.
- Sev-1: freeze deploys, flag off or roll back, take a backup snapshot of the current state before any repair, write a short post-incident note in `docs/project-management/CHANGELOG.md`.
- Monitoring alerts (OPS-001) go to the owner and the on-duty developer.
