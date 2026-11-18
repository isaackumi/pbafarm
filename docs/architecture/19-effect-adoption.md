# 19 — Effect adoption (incremental)

Status: adopted for new integration code (D-019). Owner request 2026-11-18: "we will need this https://effect.website/".
Research date for every external fact below: **2026-11-18**.

## 1. Summary

- We use the [Effect](https://effect.website/) library (`effect` 4.1.x) for code that talks to the outside world: provider calls, webhooks, automation runs, the AI proxy, IoT ingestion. It gives us typed errors, retry with backoff, timeouts, dependency injection (Layers) and runtime validation (Schema) in one library.
- Adoption is **incremental**. Existing Convex queries, mutations and React components are not rewritten. New code opts in where it removes hand-written retry/timeout/validation code.
- We use a **thin in-house bridge** (`convex/lib/effect.ts`, `convex/lib/effectHttp.ts`), not a Convex+Effect framework. Section 4 explains why.

## 2. Research findings

| Topic | Finding | Source |
|---|---|---|
| Current version | `effect` **4.1.4** is `latest` (published 2026-11-11). 4.0.0 shipped 2026-10-01, 4.1.0 on 2026-10-29. v3 line ends at 3.22.4 (`prev` tag). | npm registry, `npm view effect time dist-tags` ([npmjs.com/package/effect](https://www.npmjs.com/package/effect)) |
| v4 release | Dependency-free rewrite of the runtime; `@effect/platform` HTTP, RPC and cluster moved into the core package; one shared version for all ecosystem packages; LTS bug-fix support announced. | [effect.website v4 beta post](https://effect.website/blog/releases/effect/40-beta), [InfoQ, Effect 4.0 release (Nov 2026)](https://infoq.com/news/2026/11/effect-4-0-release) |
| Schema | Lives in core as `effect/Schema` (`Schema.Struct`, `Schema.decodeUnknownEffect`, `decodeUnknownSync`, …). Extra object keys are ignored by default, which suits provider payloads that grow fields. | `node_modules/effect/dist/Schema.d.ts` (4.1.4) |
| v4 API names we rely on | `Data.TaggedError`, `Context.Service` (replaces v3 `Context.Tag`), `Layer.succeed`, `Effect.retry({ schedule, times, while })`, `Effect.timeoutOrElse`, `Effect.tryPromise({ try: (signal) => …, catch })` (signal aborts on interruption), `Effect.result` (v3 `Effect.either`), `Result` module (v3 `Either`), `Cause.findError`, `Effect.runPromiseExit` / `runSyncExit`. | `node_modules/effect/dist/*.d.ts` (4.1.4) |
| Bundle size (vendor claim) | Minimal Effect+Stream+Schema program ~70 kB (v3) → ~20 kB (v4); basic bundle with Schema ~15 kB. Vendor figures, not independently reproduced. | [effect.website v4 beta post](https://effect.website/blog/releases/effect/40-beta) |
| Bundle size (measured here) | esbuild, minified, ESM: `runEffect` alone **28 kB / 10 kB gzip**; `runEffect` + `requestJsonAs` + a Schema struct **92 kB / 31 kB gzip** with deep imports (`effect/Effect`). The same program importing from the `effect` barrel was **391 kB / 124 kB gzip**: esbuild keeps unused modules (crypto, Cron, NetAddress) when namespaces are imported from the barrel. Hence the lint rule in §6. | Local measurement, 2026-11-18, esbuild from `node_modules` |
| Tree-shaking | Package declares `sideEffects` (only the Schema JIT opt-in module), so per-module imports shake well. | `node_modules/effect/package.json` |
| Convex default runtime (V8 isolate) | `fetch` only in actions; queries and mutations must be deterministic (`Math.random` seeded, `Date.now` frozen for the call); compiled `convex/` code counts toward a bundle limit. Effect has no Node built-ins, so it runs in the default runtime; no `"use node"` needed. | [docs.convex.dev/functions/runtimes](https://docs.convex.dev/functions/runtimes) |
| Effect scheduler in Convex | Effect yields with `setImmediate`/`setTimeout(0)` when async and uses `Date.now`/`performance.now` for its Clock and `Math.random` for Random (`dist/Scheduler.js`, `dist/internal/random.js`). Fine in actions; in queries/mutations only synchronous programs run through `runEffectSync`, which refuses async work. | `node_modules/effect/dist` (4.1.4) |
| `"use node"` actions | Effect works unchanged (Node 22/24). Only needed when a Node built-in or Node-only SDK is required, not for Effect itself. Actions time out after 10 minutes; size per-attempt timeouts and retry budgets well under that. | [docs.convex.dev/functions/runtimes](https://docs.convex.dev/functions/runtimes), [docs.convex.dev/functions/actions](https://docs.convex.dev/functions/actions) |
| Next.js 15 pages router | `pages/api/*` routes already import TypeScript from `convex/lib` (e.g. `pages/login.js` → `convex/lib/authErrors`), so server routes can use the bridge directly. Client bundles: possible but not wanted (§3). | Repo |
| Testing | `@effect/vitest` 4.1.4 requires `vitest >=5 <6`; this repo is on vitest 3.2. We test with plain vitest + `Effect.runPromise(Effect.result(…))` and a fake `Fetch` layer. Revisit `@effect/vitest` when vitest is upgraded. | `npm view @effect/vitest peerDependencies` |

### Convex + Effect integration options

| Option | Maturity (2026-11-18) | Fit for us |
|---|---|---|
| **Confect** (`@confect/server`, `@confect/core`, `@confect/react`, `@confect/cli`; [confect.dev](https://confect.dev), [github.com/rjdellecese/confect](https://github.com/rjdellecese/confect)) | Active, single maintainer, 384 stars, 15 open issues, pushed 2026-11-18. **10 major versions in 9 months** (1.0.0 on 2026-02-17, 10.6.0 on 2026-11-11; 85 published versions). Peer deps: `effect ~4.1.0`, `convex ^1.48.0`, `@effect/platform-node ~4.1.0`; requires Node 24+ for its CLI. Defines the database schema and function validators with Effect Schema, with codegen (`confect codegen` / `confect dev`). | Poor fit now: whole-app framework (schema + codegen + its own function builders) conflicts with "no rewrite"; needs a Convex upgrade (we are on 1.42.3) and Node 24; major-version churn would ripple through every function. |
| `@rjdellecese/confect` (old package name) | Last release 0.0.35 on 2026-02-10, on `effect ^3.19` and `@effect/platform`. Superseded by `@confect/*`. | Do not use. |
| Forks (`@gaganref/confect-*`) / `convex-effect` (mentioned on the [Convex Discord](https://discord-questions.convex.dev/m/1473180074881847296)) | Fork tracks Confect; `convex-effect` is not on npm. | Do not use. |
| **Thin in-house bridge** (chosen) | ~150 lines we own: run helpers + error mapping + HTTP wrapper. | Works with Convex 1.42 and the current schema, zero codegen, zero lock-in. Can be swapped for Confect later if we ever want Effect-defined schemas. |

**Recommendation:** thin in-house bridge. Re-evaluate Confect when (a) it holds one major version for 6+ months and (b) we are ready to move schema definitions to Effect Schema.

## 3. Where Effect is used, and where it is not

**Use Effect for:**
- Integration providers and adapters (SMS, WhatsApp, email, payments, weather, IoT vendors): typed provider errors, retry on transient failures, timeouts, Layers per provider, Schema for responses.
- Inbound webhooks (`httpAction`): Schema-decode the payload, verify signatures, map failures to HTTP status codes.
- Automation engine runs (D-008): an action that runs a rule's steps with per-step timeout/retry and a typed outcome stored on `automationRuns`.
- AI proxy (`pages/api/llm/chat.js`, and a future Convex action): provider calls with timeout/retry, Schema-validated request and response. Pilot: PLAT-006.
- IoT ingestion: decode and validate device batches; reject per reading with typed reasons.
- Complex pure domain pipelines (KPI / production-engine calculations) **only if** it removes code; run them with `runEffectSync`.

**Do not use Effect for:**
- Simple queries and mutations (`ctx.db` reads/writes, guards). Plain async code + `userError` is clearer.
- React components, hooks and other client code. The client bundle stays Effect-free; browser-side LLM calls in `lib/llmClient.js` stay Promise-based.
- Rewriting working code that has no retry/timeout/validation problem.

## 4. Conventions

1. **Imports by path.** `import * as Effect from 'effect/Effect'`, `import * as Schema from 'effect/Schema'`. The `effect` barrel is banned by ESLint (`no-restricted-imports`), see bundle numbers in §2.
2. **Errors are tagged classes.** `class SmsRejected extends Data.TaggedError('SmsRejected')<{ readonly message: string; readonly status: number }> {}`. Always include a human `message`. Never fail with strings or plain `Error`.
3. **User-facing failures** use `UserFacingError` (`convex/lib/effect.ts`) with an `ErrorCode` from `convex/lib/errors.ts`. The runner turns it into `userError(code, message, details)`.
4. **Retry only what is transient.** `Effect.retry({ schedule: Schedule.exponential(base).pipe(Schedule.jittered), times, while })`. Transient = network error, timeout, HTTP 5xx. Never 4xx (429 included unless the provider documents `Retry-After` and we honour it). Non-idempotent POSTs (send SMS, charge) do not retry timeouts unless the provider takes an idempotency key.
5. **Every outbound call has a timeout.** Per attempt, via `requestJson` (`timeoutMs`) or `Effect.timeoutOrElse`. Keep total time (attempts × timeout + backoff) well under the caller's limit (Convex action 10 min; Vercel function limit for `pages/api`).
6. **Validate what crosses a trust boundary with Schema.** Provider responses, webhook bodies, request bodies. Decode with `Schema.decodeUnknownEffect` (or `requestJsonAs`). Leave Convex argument validation to `v.*` validators.
7. **Providers are services; implementations are Layers.** `class Sms extends Context.Service<Sms, { send: … }>()('pbafarm/Sms') {}` + `Layer.succeed(Sms, impl)` per vendor. Network access goes through the `Fetch` service (`convex/lib/effectHttp.ts`) so tests inject a fake with `fetchLayer`.
8. **Run at the edge of the handler, once.**
   ```ts
   import { runEffect } from './lib/effect'
   export const send = internalAction({
     args: { … },
     handler: (ctx, args) =>
       runEffect(program(args).pipe(Effect.provide(FetchLive)), {
         toUserError: (e) => e._tag === 'SmsRejected' ? userError('VALIDATION', e.message) : undefined,
       }),
   })
   ```
   - Actions / httpActions: `runEffect`.
   - Mutations: prefer `runEffectSync`; never sleep, retry or time out inside a mutation.
   - Queries: `runEffectSync` with a pure program only. No `Clock`, `Random`, `Effect.sleep`, timers or `DateTime.now`; pass "now" as an argument (guidelines: no wall clock in queries). `runEffectSync` throws if the program goes async.
   - `ctx.runQuery` / `ctx.runMutation` inside a program: wrap with `Effect.promise` (failures become defects; a `ConvexError` thrown there is rethrown intact by the runner).
9. **Unmapped failures** become a plain `Error` with the tagged error's message (server-logged, generic on the client), the same as today's throws.
10. **Secrets never in errors.** `effectHttp` redacts URLs to origin + path; do not put API keys in error fields.

## 5. Testing

- Plain vitest (repo is on vitest 3.2; `@effect/vitest` 4.x needs vitest 5). Pattern: `await Effect.runPromise(Effect.result(program.pipe(Effect.provide(fetchLayer(fake)))))`, then assert `result._tag` and the tagged failure.
- Fake network with `fetchLayer(scriptedFetch)` (see `convex/lib/effectHttp.test.ts`): script 5xx-then-200 to prove retry, 4xx to prove no retry, a hanging promise to prove timeout + abort.
- Use small `retryBaseDelayMs` / `timeoutMs` in tests instead of a TestClock.
- Convex functions that call `runEffect` are tested with `convex-test` like any other function.

## 6. Bundle and runtime constraints

- Default Convex runtime: yes. `"use node"`: only for Node built-ins/SDKs, never for Effect itself.
- Budget: ~10 kB gzip for the runner, ~30 kB gzip with Schema + HTTP (measured). Convex bundles per deployment, so this is paid once.
- ESLint rule bans `import … from 'effect'`.
- Client bundle: Effect stays out of `pages/*` components and `components/`. `pages/api/*` may use it.
- Pin to the 4.1 line (`^4.1.4`). Modules under `effect/unstable/*` are not used without a decision-log note (they may break in minors).

## 7. Checklist for new code (agents and humans)

- [ ] Is this an integration, webhook, automation run, AI call, IoT ingest or a pure pipeline that gets simpler? If not, write plain Convex code.
- [ ] Deep imports only (`effect/Effect`, `effect/Schema`, …).
- [ ] Each failure is a `Data.TaggedError` with a `message`; user-actionable ones are `UserFacingError` or mapped with `toUserError`.
- [ ] Every outbound call has a timeout; retries only for network/timeout/5xx; non-idempotent sends do not retry timeouts.
- [ ] External payloads decoded with Schema.
- [ ] Network goes through `Fetch` (`requestJson`/`requestJsonAs`), so tests inject a fake.
- [ ] Run once at the handler edge with `runEffect` (actions) or `runEffectSync` (queries/mutations; pure, no Clock/Random/timers).
- [ ] Tests: success, 4xx no-retry, 5xx retry, timeout, decode failure, error mapping.
- [ ] No Effect in React components or client-side libs.

## 8. Rollout

| ID | Item | State |
|---|---|---|
| PLAT-005 | Foundation: `effect` dependency, `convex/lib/effect.ts`, `convex/lib/effectHttp.ts`, lint rule, tests, this doc | Implemented |
| PLAT-006 | Pilot: AI proxy (`pages/api/llm/chat.js`) on Effect: Schema-validated body, timeout + retry, typed provider errors | Designed |
| PLAT-007 | Convert messaging provider adapters (`convex/messaging/providers/*`, branch `feat/messaging-channels`) to Effect services once that branch is on `main` | Not started (waiting on INT-001 merge) |

Notes for PLAT-007: one `Context.Service` per channel kind (`SmsSender`, `WhatsAppSender`, `EmailSender`), one Layer per vendor (Hubtel, Africa's Talking, Twilio, Meta Cloud, Resend); provider responses decoded with Schema; `retries` limited to 5xx and network errors before the request is accepted. **Do not retry timeouts on sends** (duplicate SMS) unless the vendor supports an idempotency key; map vendor 4xx to `UserFacingError('VALIDATION', …)` and 401/403 to a credentials error shown in messaging settings.
