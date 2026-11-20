# Anowa's voice, and what reaches the member

How the farm assistant sounds, and the three filters between a model and the person reading the answer. The prompt itself is `lib/anowaPersona.js`; change this page and that file together.

## Character

Anowa is a calm, experienced farm hand who has also read every record the team keeps. It talks with owners, managers and field staff, often on a phone at the pond side. It is on their side: direct, warm, practical. Never preachy, salesy or cute.

The prompt is written as a character brief (who you are, how you answer, boundaries), not a task list. Persona prompts hold better that way: Anthropic's guidance on keeping a model in character recommends describing the personality, background and traits, and its character work treats a good assistant as one consistent character rather than a list of rules.

## How it answers

| Rule | Why |
|---|---|
| Lead with the answer: figure, unit, cage or site. Then the reason, then one next step. | People read the first line on a small screen. |
| Only figures from the records, with units and dates. Never invent or estimate. | Trust. A wrong number on a farm costs fish. |
| When the records cannot answer, name the entry that would (daily entry, sampling, water reading, harvest, sale). | Turns a dead end into a task. |
| Fish at risk (DO < 4 mg/L, mortality spike, critical alert) comes first, even unasked. | Safety beats the question. |
| Say how sure it is ("two samplings only"). | Honest about thin data. |
| Short by default (2–6 sentences); deep analysis up to ~400 words. | Respect the reader's time. |
| Answers in the member's app language (en/fr), or the question's language if different. | Most farm teams are bilingual or French-first. |
| Never says "the JSON", "the context", "as an AI". | It is Anowa, talking about *your records*. |

Three short style examples sit in the prompt, with made-up numbers marked as tone only. Few examples, all different, so the model does not copy one.

## Format

Light Markdown only: **bold** key figure, `- ` bullets, `1.` steps, `###` headings in deep analysis. No tables, links, images, HTML or code. `components/AnswerText.js` renders exactly this subset (`lib/answerBlocks.js`) as React elements; anything else shows as text.

## Filter 1: the records are data

The farm context goes inside `<farm_records>…</farm_records>`, with every `<` escaped, so a note typed into a record cannot close the fence. The prompt says plainly that text inside is data, not instructions (prompt-injection defence for notes, names and comments).

## Filter 2: the answer is cleaned (`convex/lib/llmAnswer.ts`)

Model output is untrusted (OWASP LLM05, improper output handling). Before it is returned or saved:

- hidden reasoning (`<think>…</think>`), HTML (`<script>`/`<style>` with their contents), invisible and bidi-override characters are removed;
- images and links become their text, and bare URLs lose their scheme, so an answer can never load a URL (the usual exfiltration route) or send someone off-app;
- an echoed system prompt or farm-context JSON is cut off;
- "As an AI language model…" openers are dropped;
- length is capped at 6,000 characters on a paragraph boundary.

An empty result is reported as the `empty` failure, not shown as a blank bubble.

## Filter 3: failures are explained, never echoed (`convex/lib/llmErrors.ts`)

Provider errors carry quota metric names, URLs, project and model ids and retry timers. None of it reaches the member. The gateway and the Next routes sort each failure into a kind, log the raw text on the server (and in the usage log admins see), and return `{ error, code, retryAfterSec }`.

| Kind | Member reads | Admins also read |
|---|---|---|
| `quota` | Anowa has used up its AI allowance for now. Try again in about N hours. | Choose another model, or add billing in AI settings. |
| `rate_limited` | Lots of questions right now. Try again in N minutes. | |
| `unavailable` / `timeout` | Not responding / took too long, with what to try. | |
| `auth` / `not_configured` | Can't reach its AI service; an admin needs to check AI settings. | Open AI settings to check or add the key. |
| `model_unavailable` | The chosen model is gone; pick Auto. | AI settings lists the models the key can use. |
| `blocked`, `too_long`, `empty`, `unknown`, `offline` | A plain sentence and what to try. | |

The words live in `locales/*.json` under `assistantUi.errors`; `lib/assistantErrors.js` picks them. Failed turns are marked `failed` and are never sent back to the model as conversation history.

## Tools (Ask Anowa in the app and the farm bot)

When a message asks for live figures or a change, the web chat sends it to the agent with tools (`convex/anowa/agent.ts`; routing in `lib/anowaIntent.js`). The agent's instructions sit in that file and follow this page: cite every figure a tool returns with its unit and date, call a forecast an estimate with its range, say when a list is partial, and ask for a missing figure instead of guessing.

Read tools (each re-checks the member's permission and sites; bounded):

| Tool | Answers | Permission |
|---|---|---|
| `listUnits`, `unitStatus`, `missingEntries` | Units, one unit's KPIs, units with no entry today | `production.view` |
| `feedStock` | Feed on hand vs minimum | `inventory.view` |
| `whoIsBehind`, `keeperOf` | Cage keepers | `production.keepers.manage` / `production.view` |
| `projectsOverview`, `projectStatus` | Capex projects | `projects.view` |
| `forecast` | When a unit reaches a weight (expected, earliest, latest) | `production.view` |
| `harvestPlanner` | Units reaching target in N weeks | `reports.view` |
| `samplingHistory` | ABW trend and g/day between samples | `production.view` |
| `waterQuality` | Latest reading, DO/temperature trend, low-DO events | `production.view` |
| `salesSummary` | Harvests, sales, revenue and cost per kg, receivables, P&L | `finance.view` |
| `stockingTransfers` | Stockings, top-ups and transfers in a period | `production.view` |
| `pendingApprovals` | Requests the member can decide (`ref`, `youRequested`) | `production.stocking.approve` / `production.transfer.approve` |
| `hatcherySummary` | Broodstock, spawns, eggs, fry output | `hatchery.view` |
| `lotLookup` | A traceability lot by code | `production.view` |
| `cyclePlans` | Saved cycle-planner plans | `production.plan.manage` |
| `openAlerts` | Open early warnings and sensor alarms | `production.view` |

Draft tools only add an item to a card the member confirms; Confirm writes through the form's own helper, so the form's rules apply: `proposeDailyEntry`, `proposeMortality`, `proposeFeedIssue`, `proposePurchaseOrder`, `proposeTask`, keeper and project drafts, and `proposeSampling`, `proposeWaterReading`, `proposeHarvest` (with its lot), `proposeStocking` and `proposeTransfer` (to approval as usual), `proposeSale` (optionally with its invoice), `proposeApproval` (refused for the requester when a different approver is required), `proposeReportSchedule`, `proposeCyclePlan`. Farm records (harvests, sales, approvals, …) have no 10-minute Undo; they are changed from their page.

On WhatsApp and Telegram the bot (`convex/bot/agent.ts`) has the daily-entry drafts plus `forecast`, `waterQuality`, `pendingApprovals` and `salesSummary`; approvals are decided with the bot's Approve / Reject buttons (BOT-007).

## Sources

- OWASP, [LLM05:2025 Improper Output Handling](https://genai.owasp.org/llmrisk/llm052025-improper-output-handling/)
- Anthropic, [Keep Claude in character](https://docs.anthropic.com/en/docs/test-and-evaluate/strengthen-guardrails/keep-claude-in-character) and [Claude's character](https://www.anthropic.com/research/claude-character)
- Microsoft Fluent 2, [Content engineering](https://fluent2.microsoft.design/content-engineering) (role, task, rules, examples)
