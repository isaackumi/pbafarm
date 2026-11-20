# Plan: voice notes, Ask Anowa actions, cycle planner

*Date: 2026-11-20. Status: **waiting for design approval**. Nothing here is built yet.*

Designs (Paper file "Anowa — Workspace", page "Anowa app · Console, bot & AI", bottom row):

| Artboard | Feature |
|---|---|
| 48 Ask Anowa — Does it for you (draft) | Ask Anowa proposes changes; you confirm |
| 49 WhatsApp — Voice note in Twi | Voice notes become drafts (BOT-005) |
| 50 Cycle planner — What if | Plan a cycle: harvest date, feed, cash, compare plans |

The three share one rule from doc 23: **the AI only ever writes a draft; a person's tap saves it**, and the save re-checks permission and site scope exactly like the web form does.

---

## 1. Voice notes on WhatsApp and Telegram (BOT-005)

**What the worker sees (artboard 49).**
- Sends a voice note in Twi, Ewe, Ga, English or French.
- Anowa replies with the transcript and an English line, then the usual Save/Edit/Cancel draft.
- One note can cover several cages ("I heard 2 cages").
- A figure Anowa is unsure of is marked **CHECK** and explained ("I heard 'aduasa' (30)… the line was noisy").
- Anything not said is left blank, never 0.
- If the cage itself is unclear, Anowa asks "Which one?" with reply buttons for the closest matches.

**Build, reusing what exists.**
- **Download:** extend `convex/bot/media.ts` (BOT-006 photos) with an audio path. Add `MAX_AUDIO_BYTES` (16 MB, Meta's limit) and an OGG/Opus, AAC, AMR, MP3 or M4A check from the magic bytes. It uses the same 5-minute URL handling and never logs URLs.
- **Transcription:** a new adapter, `convex/lib/speech.ts`, using an Effect `Context.Service` with one Layer per vendor, as in CLAUDE.md:
  - **Whisper** (OpenAI-compatible `/audio/transcriptions`) for EN/FR;
  - **Khaya ASR** (GhanaNLP) for Twi/Ewe/Ga.
  - The language comes from the binding's locale, with a "try both" fallback.
  - Requests go through `requestJsonAs`. Retries happen on network errors, timeouts and 5xx only.
- **Pipeline:** `@convex-dev/workflow` (recommended in the research doc) runs download → transcribe → agent → draft. One run per inbound message id gives idempotency.
- **Agent:** the transcript goes to the existing agent as the user turn (`convex/bot/agent.ts`), so the existing `proposeDailyEntry`, `proposeMortality` and `proposeFeedIssue` tools do the rest.
- **Multi-cage drafts:** allow several items in one `pendingBotActions` row, saved in one commit.
- **Low confidence:** the transcriber returns word confidences. Any number or cage token below a threshold sets `needsCheck` on that field.
- **Cage disambiguation:** `convex/bot/unitMatch.ts` already ranks names. When the top match is weak, send its top 3 as reply buttons.
- **Storage and privacy:** audio goes to R2 under the existing file rules and is deleted after 30 days. The transcript stays with the draft and its audit row.

**Tests:**
- media size and type limits;
- the speech adapter's success, 4xx (no retry), 5xx (retried), timeout and decode-failure paths;
- a multi-cage draft committing once;
- a CHECK field still requiring Save;
- the cage picker;
- an unsupported language returning a polite reply.

**Before general release:**
- benchmark 50 real Twi/Ewe/Ga notes from the farm (tracker BOT-005) and record word error rate per language;
- release language by language.

**Open questions:**
- Khaya API pricing and limits need checking with GhanaNLP.
- Who records the 50 benchmark notes?

---

## 2. Ask Anowa does it for you

**What the user sees (artboard 48).**
- The user types "Record 3 dead in C-02 and order feed so we don't run out next week".
- Anowa says what it checked, then shows one **draft card** with numbered changes:
  - a mortality record, with the cage count before and after;
  - a purchase order, with quantity worked out as 14-day need minus stock on hand, a bar showing why, the supplier and cost, and a note that it goes to approval.
- The footer shows that your role allows both and that the change is logged as "you, via Anowa", plus Cancel, Edit and **Confirm both**.
- Under the card, Anowa may suggest one follow-up, for example "add a water check task?".

**Build.**
- **Agent:** move the web assistant from context injection (ANLY-005: "tool-calling loop deferred") to the same `@convex-dev/agent` setup the bot uses, with web-specific tools. Read tools first, then propose tools:
  - `proposeDailyEntry`, `proposeMortality` and `proposeFeedIssue`, which are shared with the bot;
  - new: `proposePurchaseOrder` → `procurement.create` (status draft, then the existing approval);
  - new: `proposeTask` → `tasks`.
- **Drafts:** reuse `pendingBotActions` with a `channel: 'web'` binding equivalent. Alternatively, generalise it into an `aiDrafts` table, which needs a decision (below). The 24 h expiry, once-only commit (`idempotencyKeys`), Undo for 10 min and audit `channel` + source all carry over.
- **Feed quantity:** `convex/lib/ration.ts` (`recommendRation`) × days, summed across cages, minus site stock from `feedLedger`. The maths sits in a pure function with unit tests.
- **UI:**
  - `components/AskAnowa.js` renders a `DraftCard` when a message carries a draft id;
  - each change row comes from a typed draft item (no free text from the model goes into the fields);
  - Edit opens the normal form prefilled.
- **Permissions:** the card shows only the changes the user can make. If any item is not allowed, it is shown greyed out with the reason, and Confirm covers the allowed items only.

**Tests:**
- the draft never writes before confirm;
- confirm twice writes once;
- a user without `procurement.create` sees that item refused;
- another tenant's cage is refused;
- an expired draft;
- the order-quantity maths.

**Open question:** keep one draft table for bot and web (`pendingBotActions`), or rename it to `aiDrafts` with a migration? Recommendation: add `channel: 'web'` to the existing table now and rename later.

---

## 3. Cycle planner (what if)

**What the owner sees (artboard 50, under Production → Cycle planner).**
- **Inputs:** cages, stocking date, fingerlings per cage and size, harvest weight (slider), feed price per bag and sale price per kg.
- **Assumptions:** taken from their own last 3 cycles (survival, FCR, growth curve), each one editable.
- **Results:**
  - the harvest date in large type, with tonnes and fish count;
  - feed to buy, cash needed (peak), sales and margin;
  - a monthly chart of feed tonnes against average weight, with the harvest window;
  - a table comparing plans A, B and C, with one Anowa note on the trade-off.
- **Save plan:** stores it. A saved plan can later become the stocking request and a feed purchase schedule.

**Build.**
- **Maths:** pure functions in a new `convex/lib/cyclePlan.ts`:
  - growth from `convex/lib/growthForecast.ts` (`forecastGrowth`, `abwAfter`, `harvestPlan`) using the site's temperature history or species prior;
  - survival applied as a daily hazard;
  - daily feed from `ration.ts` feed tables and FCR;
  - month buckets, a cash curve from feed + fingerlings out and sales in at harvest, and the margin.
  - Unit tests check that the numbers on artboard 50 come out of the function.
- **Assumptions:** a query reads the last N closed cycles per row or site from rollups (`convex/rollups.ts`) and the existing KPI helpers (`convex/lib/kpi.ts`).
- **Storage:** a new `cyclePlans` table (company, site, unit ids, inputs, assumptions snapshot, createdBy). Owner/manager permission `production.plan.manage` (new, added to the catalog).
- **UI:**
  - `pages/cycle-planner.js`, with inputs debounced so results recompute live on the client from the same pure functions, shared via a client-safe lib;
  - a chart with recharts, lazily loaded as doc 12 asks;
  - a compare table of up to 4 plans.
- **Later, not in v1:**
  - "Turn into stocking request";
  - feed purchase schedule into procurement;
  - market prices.

**Tests:**
- pure maths with fixed inputs (artboard numbers);
- assumptions with no history fall back to species defaults and are labelled as such;
- permission and tenant isolation on `cyclePlans`.

**Open question:** should cash include labour and other expenses from `expenses`, or stay "before labour" as designed?

---

## Order and size

| # | Feature | Depends on | Rough size |
|---|---|---|---|
| 1 | Cycle planner | nothing new, pure maths on existing forecasts | about 1 PR, medium |
| 2 | Ask Anowa actions | agent on web, draft card, PO tool | about 2 PRs, medium-large |
| 3 | Voice notes | speech vendor accounts, benchmark recordings | about 2 PRs plus the benchmark, large |

Suggested order: the cycle planner first (no outside dependencies), Ask Anowa actions second, and voice notes third, once Khaya access and the benchmark recordings are ready. Each ships behind the org's AI switch where it uses AI, follows the PR flow (branch, tests, PR, no direct `main`), and gets a security-audit pass because 2 and 3 touch the AI proxy and webhooks.
