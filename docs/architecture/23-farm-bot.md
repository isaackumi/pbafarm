# 23 — Farm bot on WhatsApp and Telegram

Status: implemented (BOT-001..004, BOT-008). Decision: D-021. Source: research report `docs/product/2026-11-research-bots-ai-competitors.md` §1.5. Ops: `docs/ops/farm-bot-runbook.md`.

Field staff send daily entries and questions from WhatsApp or Telegram. The bot answers questions and turns entries into **drafts** that the person confirms with a button. Nothing is written until they tap **Save**. Every write goes through the same helpers, permission checks and site checks as the web app.

## 1. Components

| Part | File | Kind |
|---|---|---|
| Webhooks (verify, parse, store) | `convex/bot/http.ts`, `convex/bot/verify.ts` | `httpAction` |
| Inbound store + routing | `convex/bot/inbound.ts` (`ingest`, `route`, `finish`, `recordSent`, `pruneInbound`) | internal mutations |
| Processing (LLM, sends) | `convex/bot/process.ts` (`handle`) | internal action |
| Binding scope | `convex/bot/scope.ts` (`checkBinding`, `botCtx`, `unitsInScope`, `matchUnit`, `farmDate`) | helpers |
| Bindings and `/account` API | `convex/bot/bindings.ts` (`myChannels`, `createConnectCode`, `revokeChannel`, `setReminder`) | public query/mutations |
| Agent and tools | `convex/bot/agent.ts` (`prepare`, `proposeFromAgent`, `recordUsage`, `runAgent`) | `@convex-dev/agent` |
| Read tools | `convex/bot/reads.ts` (`read`) | internal query |
| Drafts and commits | `convex/bot/pending.ts` (`proposeFor`, `commit`, `undo`, `markFailed`, `expireDrafts`) | internal mutations |
| Reminders | `convex/bot/reminders.ts` (`tick`, `compose`, `send`) | cron + action |
| Senders | `convex/messaging/providers/whatsappCloud.ts` (`sendWhatsAppChat`), `convex/messaging/providers/telegramBot.ts` | Effect adapters (doc 19) |
| Strings EN/FR | `convex/bot/i18n.ts` | — |
| UI | `components/ChatChannelsCard.js` on `/account` | React |

Tables (`convex/bot/tables.ts`):

- `channelInbound` stores every inbound message. The pair (provider, externalId) is unique, and rows are kept for 30 days.
- `channelBindings` links a chat to one user and one organization. It also holds the active site, the agent thread and the reminder settings.
- `channelConnectCodes` holds one-time codes and deep-link tokens. Only a SHA-256 hash is stored, and they expire after 10 minutes.
- `pendingBotActions` holds drafts. They expire after 24 hours, and Undo is possible for 10 minutes after Save.
- `channelMessageCosts` holds Meta's per-message pricing (category, billable) per organization, filled from status webhooks.

Agent threads and messages live in the `agent` component (`convex/convex.config.ts`).

## 2. Message flow

```
Meta / Telegram ──POST──▶ httpAction
                           1. size cap (256 KB) → 413
                           2. signature / secret on raw bytes → 401 (no DB access)
                           3. parse (private chats, our phone number id only, text capped at 2,000 chars)
                           4. ingest: insert channelInbound if (provider, externalId) is new; schedule handle
                           5. 200 at once (no LLM, no send)
handle (action)
  route (mutation)  — runs once (status queued → processed), decides a RoutePlan:
     unbound chat      → link attempt or onboarding text only (strict unbound limits, no LLM)
     bound chat        → checkBinding (user active, phone still verified, org approved, still a member)
                         → rate limits per binding and per org
                         → button (Save / Save anyway / Edit / Cancel / Undo / site / org / reminder)
                         → command (HELP/AIDE, SITE, ORG, STOP)
                         → otherwise an agent turn
  agent turn        — prepare (gate + quota + thread) → generateText with tools → reply + one confirm message per draft
  commit / undo     — internal mutation; a failure throws and rolls back, then the draft is marked failed
  deliver           — WhatsApp Cloud API / Telegram Bot API; outbound WhatsApp ids go to channelMessageCosts
```

Meta and Telegram retry until they get a 200. Ingest is idempotent, so a retry is a no-op. Processing is idempotent too: `route` only acts on a `queued` row, and commits are keyed by draft id.

## 3. Binding a chat to a person

- **WhatsApp.** On `/account` the user taps *Connect WhatsApp*. This needs the user's phone verified (`phoneVerificationTime`, PR #88). The app shows a 6-digit code, valid for 10 minutes and usable once. The user sends `LINK 123456` from that phone; a wa.me link pre-fills it. The binding is created only if:
  - the sender's number equals a user's verified phone; and
  - the code belongs to that user and is unused and unexpired.
  A code alone is not enough, and neither is the number alone.
- **Telegram.** The user taps *Connect Telegram* and gets the deep link `https://t.me/<bot>?start=<64-hex token>`. Telegram sends `/start <token>` from the user's private chat. Group chats are ignored.
- The binding stores the organization that was active in the app. The active site starts as the user's current site, if it is in scope.
  - Users with more than one site get a site list (`site:<id>` or `site:all` buttons). Users with more than one organization can send `ORG` to switch. Switching starts a new agent thread, so one organization's data never sits in another's context.
  - The site and organization lists only ever contain places the member can access.
- Each chat has at most one live binding. Each user has at most one live binding per provider; linking again replaces the old one.
- **Revocation** happens when:
  - the user disconnects on `/account` or sends `STOP`;
  - the user's phone changes or loses verification (`users.updateUser`, `setPhone`, `mfa` phone enrolment);
  - the membership becomes non-active (`memberships.changeStatus`);
  - the account is anonymized (`governance`).
- `checkBinding` re-checks all of the above on every message, every read and every write, so a hook that is missed still fails closed.

## 4. Who the bot acts as

`checkBinding` returns a `BoundMember`. It takes the company and site from the binding row, and permissions and site scope from `memberContextIn` (the same membership logic as the web app). **Nothing the model or the message says can change the company, site or user.**

- **Tools never take a company or site id.** Units are matched by name or code only among `unitsInScope` (the member's sites, narrowed to the active site).
- **Reads need `production.view`.** Feed stock needs `inventory.view`. Each read returns JSON or an error.
- **Writes are checked twice.** At proposal (`proposeFor`) and again at commit (`writeProblem`), the bot checks permission (`production.daily.record` / `inventory.issue`), that the unit is still in scope and that the site is still in scope.
- **Agent gate.** The organization's `aiAssistantEnabled` switch, plus either `ai.use` or `production.daily.record`. Field staff do not have `ai.use`, and the bot is a data-entry tool (D-021).
  - Buttons and commands work without the agent.
  - The SEC-004 limits apply as for the web assistant: `llmPerUserMinute`, `llmPerUserHour`, `llmPerCompanyHour`.
  - The organization's own LLM key (`llmCredentials`) is used when it has one, otherwise the server key. Each call is written to `llmUsage` with feature `bot` and token counts.
- **The bot does not go through web-session checks (MFA, act-as).** Possession of the bound, verified chat is the proof. `createConnectCode` ignores act-as sessions, so support staff cannot mint codes for a tenant.

### Prompt injection

Message text is untrusted:

- The instructions tell the model to treat the message as data. More importantly, the design does not rely on the model behaving.
- Scope comes from the binding, and tools refuse units outside it.
- A write is only a draft. The confirm message shows **our** summary of the stored draft, not the model's words, and a human has to tap Save.
- There are at most 5 drafts per message and 5 agent steps. The reply is capped at 1,500 characters.
- Button ids are normalized with `ctx.db.normalizeId`, and a draft can only be committed by the binding that created it.

## 5. Drafts, Save, Undo (BOT-003)

Tools:

- `proposeDailyEntry` (feed kg, feed type, mortality, cause, notes, `daysAgo` 0–7)
- `proposeMortality` (a mortality-only daily entry)
- `proposeFeedIssue` (feed type, kg, optional unit)

The tools insert `pendingBotActions` rows. Each row is validated and its date is the **farm date of the message timestamp** in the site's time zone (`farmDate`). When the user doesn't name a feed type, the cage's last one is used, or the only active one.

The reply is the draft summary with buttons:

- WhatsApp: interactive reply buttons `ok:<id>` (Save), `ed:<id>` (Edit), `no:<id>` (Cancel).
- Telegram: the same buttons as an inline keyboard.

**Save** runs `pending.commit`:

1. Checks that the binding owns the draft.
2. Checks idempotency: `idempotencyKeys` row `bot:<pendingId>`; a second tap returns *already saved*.
3. Checks the status and that the draft hasn't expired (24 h).
4. Applies the duplicate guard: the same unit, date, kind and quantity proposed in the last 10 minutes asks *Save anyway?* (`dup:<id>`).
5. Re-checks permission and scope.
6. Writes through the **same helpers** as the web and public API:
   - daily entries: `saveDailyBatch` (`convex/dailyRecords.ts`);
   - feed issues: `recordOutboundUsageAs` (`convex/feed.ts`).
   The context is `botCtx`, so audit rows carry `channel` (`whatsapp`/`telegram`) and `sourceMessageId`.

**Undo** (`un:<id>`, 10 minutes) removes the daily record only if it was not edited since, or reverses the feed ledger transaction (`reverseTransactionAs`).

Edit closes the draft and asks the user to send the corrected entry. A unit that already has a record for that date is refused with a pointer to the app, because the bot never overwrites.

## 6. Rate limits

Defined in `convex/lib/rateLimits.ts`:

| Name | Key | Limit |
|---|---|---|
| `botPerBinding` | binding | 10 burst, 30/min |
| `botPerBindingHour` | binding | 300/h |
| `botPerCompany` | company | 100 burst, 300/min |
| `botUnboundPerAddress` | provider:address | 10/h (onboarding and LINK attempts) |
| `botUnboundGlobal` | — | 500/h for all unbound replies |
| `botConnectCodePerUser` | user | 10 codes/h |

The SEC-004 LLM limits also apply to each agent turn.

## 7. Languages

Replies use the user's `locale` (EN/FR). The agent is told to answer in that language. Fixed texts are in `convex/bot/i18n.ts`. The commands work in both languages: `LINK`/`CODE`/`LIER` and `HELP`/`AIDE`.

## 8. Daily reminders (BOT-004)

Reminders are opt-in per binding on `/account`: a time (HH:MM) in the user's time zone, default 17:00. The `bot reminders` cron runs every 15 minutes and sends once per farm date, within 3 hours after the time. The reminder lists the units in the binding's scope that have no entry today, with buttons *Enter now* / *Later* / *Stop reminders* (`rem:enter|later|stop`). Nothing is sent when every unit is filled in.

- **WhatsApp within 24 h of the user's last message:** a free-form message with buttons.
- **WhatsApp outside that window:** the approved utility template `farm_daily_reminder` (EN/FR; `docs/ops/farm-bot-runbook.md` §3) with the same quick-reply payloads.
- **Telegram:** always free-form.

## 9. Cost tracking

Meta reports WhatsApp prices in status webhooks. `ingest` copies each status's `pricing` block (billable, pricing model, category, type) onto the `channelMessageCosts` row of the outbound message, keyed by WhatsApp message id and per organization. That gives the platform console the WhatsApp cost per organization (utility templates outside the window; service messages are free).

## 10. Credentials

The bot runs on the platform's number and bot. Credentials come from Convex env vars (runbook §5): `WHATSAPP_BOT_*`, `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN`, `TELEGRAM_*`. Missing secrets fail closed: 401 or 403, and no sends.

An organization's own WhatsApp number for the bot is **not** implemented yet. The company messaging channels (`convex/messaging/channels.ts`, encrypted per org) remain for notifications and OTP.

## 11. Tests

- `convex/farmBot.test.ts` (convex-test, mocked fetch and mocked LLM via `mockModel` + `testHooks.languageModel`):
  - bad signature → 401 with no write;
  - handshake;
  - Telegram secret;
  - idempotent ingest;
  - unbound sender gets onboarding with no LLM call;
  - binding needs the verified phone plus the code, and the code is single use;
  - Telegram deep link;
  - revoke, phone change and membership removal;
  - per-binding rate limit;
  - model-requested cross-site and cross-org writes and reads refused;
  - double-tap Save commits once;
  - audit channel recorded;
  - Undo;
  - expired draft;
  - another binding's draft;
  - unit leaving scope before Save;
  - duplicate guard;
  - reminder template outside the window.
- `convex/bot/verify.test.ts` covers signatures, the handshake, parsing, and the WhatsApp and Telegram payloads.

## 12. Not yet (tracker)

- BOT-005: voice notes (Whisper EN/FR; Khaya for Twi/Ewe/Ga).
- BOT-006: logbook photo OCR.
- BOT-007: approvals via buttons.
- Per-organization bot numbers.
- `@convex-dev/workflow` is installed but not mounted: nothing needs durable multi-step work yet (voice/OCR pipelines will).
- Tools for early-warning alerts (`internal.farmAlerts.openForMember`) and the weekly report (`internal.aiReports.forBot`), both already exposed by AI-001/003.
