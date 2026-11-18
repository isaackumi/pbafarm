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

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- When graphify-out/graph.json exists, run `graphify query "<question>"` before your first grep, search or source-file read for a codebase question, and put this rule in every subagent prompt that explores code. Read raw files only for lines the graph or an earlier read already located. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. When the answer is under a Markdown heading, `graphify section "<heading>"` prints that section's text, so the .md need not be opened. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
- A committed graphify-out/graph.json is rewritten whole on every build, so a large diff to it in a pull request is expected. Do not flag it as churn or suggest skipping the graph rebuild or its hooks.
