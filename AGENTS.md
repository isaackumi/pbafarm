<!-- convex-ai-start -->

This project uses [Convex](https://convex.dev) as its backend.

When working on Convex code, **always read
`convex/_generated/ai/guidelines.md` first** for important guidelines on
how to correctly use Convex APIs and patterns. The file contains rules that
override what you may have learned about Convex from training data.

Convex agent skills for common tasks can be installed by running
`npx convex ai-files install`.

<!-- convex-ai-end -->

## Paper designs

Paper is the source of truth for the UI; every app artboard is tracked in `docs/design/paper-ledger.json`. Follow [docs/design/README.md](docs/design/README.md):

- Run the ledger check (`scripts/paper-ledger-check.md`) before UI work and at the end of each UI PR; rebuild any CHANGED artboard you touch.
- Every UI PR names the artboard ids it implements and updates their ledger entries (`status`, `notes`, `verifiedAt`), then runs `node scripts/paper-ledger.mjs --md`.
- `built` only after a browser comparison with the artboard's screenshot and JSX at its width and theme. Never from an agent report alone; when unsure, `partial` with what's missing.

## Security audits (security-audit skill)

The Cloudflare `security-audit` skill is installed in `.agents/skills/security-audit` (symlinked into `.claude/skills`).

- **Use it** for any security audit, vulnerability hunt, "is this safe/secure" review, and before merging changes that touch auth, permissions/tenant isolation, file uploads/storage, webhooks, public API/HTTP actions, the AI proxy, payments/SMS, or Cloudflare/Vercel/Convex deployment config.
- Follow its phases (recon → coverage-led hunting → independent validation → `findings.json` validated by `validate-findings.cjs` → verification → report). Write audit artifacts under `docs/security/audits/<date>/`, never secrets.
- Only `confirmed` findings become fixes; `needs_validation` items go to `docs/project-management/OPEN-QUESTIONS.md` or the tracker.

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

When the user types `/graphify`, use the installed graphify skill or instructions before doing anything else.

Rules:
- When graphify-out/graph.json exists, run `graphify query "<question>"` before your first grep, search or source-file read for a codebase question, and put this rule in every subagent prompt that explores code. Read raw files only for lines the graph or an earlier read already located. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. When the answer is under a Markdown heading, `graphify section "<heading>"` prints that section's text, so the .md need not be opened. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- Dirty graphify-out/ files are expected after hooks or incremental updates; dirty graph files are not a reason to skip graphify. Only skip graphify if the task is about stale or incorrect graph output, or the user explicitly says not to use it.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update . && npm run graph:convex-edges` to keep the graph current (AST-only, no API cost). The second step re-adds `calls` edges from `api.*`/`internal.*` references to the Convex functions they reach, which the AST pass cannot resolve.
- A committed graphify-out/graph.json is rewritten whole on every build, so a large diff to it in a pull request is expected. Do not flag it as churn or suggest skipping the graph rebuild or its hooks.
