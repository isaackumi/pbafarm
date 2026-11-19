# Changelog

Changes to this repository during the Aquaculture OS engagement. Newest first. One line per PR; docs additions listed by file. Source: `gh pr list --state all`, `git log origin/main`, 2026-11-18.

## feat/platform-console — Platform console and billing foundation

- PLAT-101..113: console on `console.heitechinc.com` (`middleware.js`), `pages/platform/*`, `convex/platform/*`; billing model, plan limits, tenant suspension, trial/dunning cron, usage rollup, `/billing`. Docs: `docs/architecture/22-platform-console-billing.md`, `docs/ops/platform-console-dns.md`.

## 2026-11-18 — Discovery, architecture and roadmap (branch `docs/discovery`, not yet committed)

Docs only; no application code changed on this branch.

- Added `docs/MASTER-PROMPT.md` — the owner's standing brief, kept verbatim.
- Added discovery set `docs/discovery/`:
  - `01-repository-overview.md` — stack, configuration, folder structure, dependency health.
  - `02-application-inventory.md` — every route and module with queries, mutations and limitations.
  - `03-route-and-feature-map.md` — route table, feature → route map, navigation.
  - `04-convex-schema-audit.md` — all 25 application tables + auth tables; cross-cutting findings F1–F23.
  - `05-database-relationships.md` — entity relationships and link strength.
  - `06-backend-function-inventory.md` — 142 public functions, counts, flags.
  - `07-authentication-and-authorization.md` — auth flows; authorization sweep; vulnerabilities X1–X3, V1–V16.
  - `08-aquaculture-business-logic.md` — production model as implemented; every writer of `cages.currentCount`.
  - `09-production-calculation-audit.md` — calculation inventory C1–C43; stock scenarios S1–S16.
  - `10-frontend-and-design-system-audit.md`, `11-mobile-user-experience-audit.md` — UI and field usability.
  - `12-technical-health-and-risk-report.md` — build, lint, tests, security, scale, deployment, backups.
  - `13-existing-integrations.md` — 34 integrations with status.
  - `14-existing-feature-completeness.md` — 65 features classified.
  - `15-technical-debt-register.md` — technical debt register (written in parallel).
- Added `docs/architecture/` (written in parallel) — current and target architecture per MASTER-PROMPT PART 12.
- Added `docs/roadmap/01`–`06` — product vision, feature gap analysis, development roadmap (Phase 0 + Phases 1–14), migration and compatibility plan, testing and quality plan, release strategy.
- Added `docs/project-management/` — `MASTER-TRACKER.md`, `DECISION-LOG.md` (D-001..D-013, all proposed), `RISK-REGISTER.md`, `OPEN-QUESTIONS.md`, this changelog.

## 2026-11-18 — Pull requests

State verified on GitHub on 2026-11-18. The brief for this engagement listed #7–#14 as open; GitHub shows them merged as below. See `docs/roadmap/03-development-roadmap.md` §0.1 for consequences.

| PR | Title | Branch → base | State | Reached `main`? |
|---|---|---|---|---|
| #14 | Bring the remaining pages onto the shared design system | `ui/consistent-pages` → `feat/per-site-stock` | Merged 10:35 UTC, after #13 had merged | **No** — needs a new PR to `main` (OPS-000) |
| #13 | Check feed stock per site, add daily reminders, and let harvests save with optional size grades | `feat/per-site-stock` → `main` | Merged 09:43 UTC; Convex deploy ran | Yes (carries #10, #11, #12) |
| #12 | Check feed stock per site | `feat/per-site-stock` → `feat/daily-reminders` | Merged into stack branch | Yes, via #13 |
| #11 | Daily reminders: missed entries and low feed stock | `feat/daily-reminders` → `fix/real-feed-kpis` | Merged into stack branch | Yes, via #13 |
| #10 | Real numbers on feed and inventory pages | `fix/real-feed-kpis` → `feat/growth-metrics` | Merged into stack branch | Yes, via #13 |
| #9 | Growth metrics: eFCR, SGR, biomass and live fish weight | `feat/growth-metrics` → `feat/harvest-closes-cage` | Merged 00:52 UTC | Yes, via #8 |
| #8 | Harvest closes the cage and its stocking cycle | `feat/harvest-closes-cage` → `main` | Merged 00:54 UTC; Convex deploy ran | Yes — contains the S5 defect (doc 09), hotfix PROD-000a |
| #7 | Daily records page: review, edit and delete entries | `feat/daily-records-view` → `main` | Merged 00:54 UTC; Convex deploy ran | Yes — ships the edit UI that makes S8 reachable, hotfix PROD-000c |
| #6 | Auto-deploy Convex backend on push to main | `feat/batch-entry-security-ui` → `main` | Merged 00:35 UTC | Yes |
| #5 | Batch daily entry, daily record edits, security fixes and offline capture | `feat/batch-entry-security-ui` → `main` | Merged 00:28 UTC | Yes |

Earlier history (before this engagement): #1–#4 merged 2026-09-02 and 2026-11-17 (Convex Auth + theme, RSC CVE fix, feed bags/kg and passwords, batch daily entry).
