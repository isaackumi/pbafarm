<!-- convex-ai-start -->

This project uses [Convex](https://convex.dev) as its backend.

When working on Convex code, **always read
`convex/_generated/ai/guidelines.md` first** for important guidelines on
how to correctly use Convex APIs and patterns. The file contains rules that
override what you may have learned about Convex from training data.

Convex agent skills for common tasks can be installed by running
`npx convex ai-files install`.

<!-- convex-ai-end -->

## Effect conventions (D-019, docs/architecture/19-effect-adoption.md)

The backend uses [Effect](https://effect.website/) (`effect` 4.1.x) **incrementally**, for integration-style code only.

- **Use it for:** provider/integration adapters, webhooks, automation runs, the AI proxy, IoT ingestion, and pure domain pipelines only if it simplifies them. **Not for:** simple queries/mutations or anything in React components/client libs. Never rewrite working code just to adopt it.
- **Imports by path:** `import * as Effect from 'effect/Effect'`, `import * as Schema from 'effect/Schema'`. `import … from 'effect'` is an ESLint error (bundle size).
- **Errors:** `Data.TaggedError` classes with a `message`; user-actionable failures are `UserFacingError` (`convex/lib/effect.ts`) or mapped with `toUserError` to `userError` from `convex/lib/errors.ts`.
- **Running:** once, at the handler edge. Actions/httpActions: `runEffect(program, { toUserError })`. Mutations: prefer `runEffectSync`, no sleep/retry/timeout. Queries: `runEffectSync` with a pure program only (no Clock, Random, timers; pass "now" in).
- **HTTP:** use `requestJson` / `requestJsonAs` from `convex/lib/effectHttp.ts` (per-attempt timeout, retry only network/timeout/5xx, never 4xx, Schema-validated body). Non-idempotent sends (SMS, payments) use `retries: 0` or exclude timeouts unless the vendor de-duplicates.
- **Services:** providers are `Context.Service` + one `Layer` per vendor; network goes through the `Fetch` service so tests inject `fetchLayer(fake)`.
- **Tests:** plain vitest (`Effect.runPromise(Effect.result(...))`) with scripted fakes for success, 4xx, 5xx-retry, timeout and decode failure.
- Checklist for new code: doc 19 §7.

