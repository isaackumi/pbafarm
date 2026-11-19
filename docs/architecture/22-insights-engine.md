# 22 — Insights engine: early warnings, feeding recommendations, weekly report

Phase 13 follow-up (AI-001..003; research report "bots, AI and competitors" §2, ranks 1–4).

The shared rule: **numbers come from code, never from a model.** Every alert,
ration and report figure is computed by a pure, unit-tested module from the
farm's own rollups. An LLM may only reword those numbers, and its reply is
rejected if it states a figure the data does not hold.

## 1. Early-warning alerts (AI-001)

| Piece | Where |
|---|---|
| Pure engine (rules, statistics, dedupe decision, EN/FR text) | `convex/lib/earlyWarning.ts` |
| Cron, storage, notifications, app and bot reads | `convex/farmAlerts.ts` |
| UI | `components/FarmAlerts.js` (dashboard "insights" widget, unit page) |

### Inputs

Per stocked unit, up to 60 days of `unitDailyStats` (deaths, feed, whether a
daily entry exists, sampling ABW, manual DO and temperature), the cycle's live
count at the start of each day (from the batch ledger), sensor daily min/max
(`sensorReadings`, `dissolved_oxygen` and `temperature_c`, in the company's
time zone) and the effective water-quality thresholds for the unit type
(`lib/farmRules.effectiveThresholds`, company and site overrides).

### Rules (`RULES` in the engine)

| Rule | Fires when | Guards |
|---|---|---|
| `mortality_spike` | Daily rate z ≥ 3 against a 14-day baseline (EWMA reported as evidence) **or** ≥ 0.5 %/day with too little history. Critical at ≥ 1 %/day, or z ≥ 6 while above 0.5 %. | ≥ 5 deaths and ≥ 0.05 %/day; SD floor 0.05 %; baseline needs 7 days with entries |
| `feed_drop` | Feed ≥ 20 % below the 7-day median (critical at 60 %). | ≥ 4 fed days, median ≥ 2 kg |
| `missing_entries` | No daily entry for ≥ 2 consecutive days up to the evaluated day. | Stocked units only |
| `low_oxygen` | DO below the minimum on 2 of the last 3 days, a single day below 75 % of it (critical), or falling 3 days in a row within 10 % above it. | Needs a threshold |
| `temperature_out_of_range` | Outside min/max on 2 of 3 days, or trending 3 days toward a limit within 1 °C. | Needs a threshold |
| `fcr_deterioration` | Weekly cycle FCR rising 3 weeks in a row by ≥ 0.1 in total. | — |
| `growth_stall` | SGR between the last two samplings (≥ 7 days apart) below half of the size-expected SGR. | Latest sample ≤ 45 days old |

### Scheduling, idempotence, cool-down

- `crons.ts` → `farmAlerts.tick` at 05:00 UTC pages approved companies (20 per
  page) and schedules `evaluateCompany`, which evaluates **yesterday in the
  company's time zone**, 8 units per transaction, and re-schedules itself with
  a cursor.
- Each candidate goes through `decide(prior, candidate)` against the latest
  alert of the same unit and rule (`by_unitId_and_rule`):
  - same cycle, not resolved → **refresh** (lastSeenDate, evidence, severity);
    a higher severity is an escalation and re-opens an acknowledged alert;
  - resolved within `COOLDOWN_DAYS[rule]` (1–14 days) → **suppress** unless
    escalated;
  - otherwise, or a new cycle (`batchId` changed) → **insert**.
  Re-running a day therefore changes nothing.
- An alert not seen for 2 days, or whose cycle ended, is auto-resolved
  (`autoResolved: true`).

### Who sees and who is told

- `farmAlerts.list` (production.view) and the unit page filter by
  PERM-004 site scope; alerts of units without a site are for all-sites
  members only. Acknowledge/resolve need `production.daily.record` and the
  same scope.
- Notifications (insert or escalation, ≤ 25 per job) go through
  `lib/notify.notifyUsers` (preferences and quiet hours apply) to
  production.view members of the unit's site, grouped by language. Critical:
  every channel; others: in-app and email. Dedupe key
  `farm-alert:<id>:<severity>`.
- `assistant.context` gains `early_warnings` (same scope) so the assistant
  can talk about them.

## 2. Feeding recommendations (AI-002)

`lib/ration.recommendRation({ count, abwG, bands, speciesKey, tempC })`:

```
live count = stocked + transferred in − out − harvested − dead − unaccounted   (liveCount)
biomass kg = count × ABW (latest sampling) / 1000
%BW        = feed-table band for the ABW × temperature factor (tilapia / catfish curves; 1 when unknown)
kg/day     = biomass × %BW, split in the band's feedings per day
```

The temperature is the newest sensor `temperature_c` or manual daily reading
no more than 2 days old (`feedingPlans.latestTemperature`). `rationReasons`
renders the working in EN/FR, e.g. *"ABW 180 g (sampled 2026-05-10), 9,420
fish, 28 °C → 2.50% BW → 42.4 kg/day, split in 3 meals of 14.13 kg."* Daily
entry and the unit page show it with "a suggestion only — never entered for
you"; the unit page adds the count breakdown. Nothing is ever written to a
daily record.

## 3. Weekly report (AI-003)

| Piece | Where |
|---|---|
| Pack figures, template, grounding check (pure) | `convex/lib/weeklyReport.ts` |
| Data pack, generation, delivery, app list, bot entry points | `convex/aiReports.ts` |
| Gateway accounting for scheduled calls | `convex/llmGateway.ts` (`beginReport`, `recordReportUsage`) |
| UI | `pages/weekly-report.js` |

1. **Pack** (`buildPack`, internal query): batch stats of the scope (one site,
   or company-wide) → `lib/analytics.periodOf`/`groupKpis` for the week ending
   Sunday and the week before; suggested feed = the AI-002 ration at mid-week
   count and ABW × days stocked; top 5 units by deaths; alerts raised and open.
   Costs (feed at purchase price + tagged expenses) go to a **separate finance
   pack** that is never sent to a model.
2. **Phrasing**: `beginReport` checks `aiAssistantEnabled`, the per-company
   (and, for a member request, per-user) rate limits, and picks the org BYO key
   or the server key (Convex env `LLM_DEFAULT_PROVIDER` + `GEMINI_API_KEY` /
   `OPENAI_API_KEY` / `OPENROUTER_API_KEY` / `ANTHROPIC_API_KEY` /
   `GROQ_API_KEY`). The prompt carries the pack as JSON and asks for the
   numbers verbatim. Usage is recorded (`llmUsage.feature = 'report'`, no user
   for the cron).
3. **Grounding**: `acceptReply` strips Markdown, requires 40–4,000 characters
   and runs `groundingProblems`: every number in the reply (EN or FR
   separators, ISO dates expanded) must equal a pack number at 0, 1 or 2
   decimals, or a small count (0–7). Anything else → the deterministic
   `templateReport` text is stored instead (`source: 'template'`). No key, AI
   off or a failed call also fall back to the template.
4. **Storage and delivery**: one `weeklyReports` row per scope/week/language
   (re-used unless forced). The Monday 06:30 UTC cron writes, per active site
   and company-wide, one report per language its readers use and delivers it
   in-app + email per preferences: members with `finance.view` get the
   finance paragraph appended, others never do.
5. **Reading**: `aiReports.list` (reports.view) — site reports in the
   member's sites, company-wide reports only for all-sites members,
   `financeText` only with `finance.view`. `generateNow` rewrites last week
   for a scope the caller may read.

## 4. Internal entry points for the chat bot

All take explicit `companyId`/`userId` and re-check membership, permission
and site scope; they return text already in the user's language.

| Function | Returns |
|---|---|
| `internal.farmAlerts.openForMember({ companyId, userId, limit? })` | Live alerts in the member's sites: `{ alertId, unitId, severity, status, date, title, detail, actions[] }[]`, or null without production.view |
| `internal.aiReports.forBot({ companyId, userId, locationId? })` | Last week's report for the member's scope (their site, or company-wide for all-sites members), written now if missing: `{ weekEnd, text, financeText \| null }`, or null without reports.view/scope |
| `internal.aiReports.generateWeekly({ companyId, locationId?, weekEnd, lang, useLlm?, force?, deliver? })` | Low-level generator (no member check — callers must authorize) |

## 5. Limits and follow-ups

- Rules are fixed thresholds per company; per-species baselines and learned
  thresholds are future work. Sensor gaps simply produce no water alerts.
- `liveCount` ignores count adjustments; it can differ slightly from the
  unit's displayed count after a recount.
- AI-004 (forecasting), AI-005 (photo counting, R&D) and AI-006 (photo
  disease hints, never a diagnosis) are tracked as Not started.
