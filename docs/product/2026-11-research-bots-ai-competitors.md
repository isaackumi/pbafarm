# Research: chat bots, advanced AI, competitors and African SaaS billing

*Date: 2026-11-19. Status: decision-ready research. No product code was changed.*

**How it was checked:** each pricing or API claim links to a primary source that was fetched on 2026-11-19. Repo activity comes from the GitHub API (`stargazers_count`, `pushed_at`, `license`) and the npm registry on the same day. A claim we could not verify is marked **(unverified)**.

**Codebase grounding:** `graphify-out/` does not exist in this worktree, so these files were read directly:
- [convex/messaging/providers/whatsappCloud.ts](convex/messaging/providers/whatsappCloud.ts): outbound only, Graph API v27.0, authentication templates.
- [convex/lib/permissions.ts](convex/lib/permissions.ts): `memberContext(ctx, user)`, `requirePermission`, `assertSiteInScope`, `assertDifferentApprover`.
- [convex/schema.ts](convex/schema.ts): `users.phone`, `phoneVerificationTime`, and the `phone` index.
- [convex/integrations/apiHttp.ts](convex/integrations/apiHttp.ts): `createDailyRecordsHandler`, which already does machine-authenticated writes.
- [convex/idempotency.ts](convex/idempotency.ts): the `idempotencyKeys` table.
- [convex/convex.config.ts](convex/convex.config.ts): only `@convex-dev/rate-limiter` is installed.
- [lib/offlineOutbox.js](lib/offlineOutbox.js).
- [convex/llmGateway.ts](convex/llmGateway.ts): per-org BYO keys and quota.

There is **no billing integration** in the repo today.

---

## TL;DR (decisions)

| # | Question | Decision |
|---|---|---|
| 1 | Bot architecture | Talk to the **Meta WhatsApp Cloud API directly** (no BSP) plus the **Telegram Bot API**. Both webhooks go to a **Convex `httpAction`**. Messages are stored idempotently, then **`@convex-dev/agent`** runs with **tools that call the same internal functions and the same `memberContext` permission checks** as the web app. Every write is a **draft that the user confirms**. Voice notes: Whisper for EN/FR, **Khaya ASR** for Twi/Ewe/Ga. Paper sheets: a vision LLM. Don't use Baileys or whatsapp-web.js, and don't adopt Vercel Chat SDK, Botpress, Typebot, Rasa or n8n as the runtime. |
| 2 | AI features to build first | (1) Tool-calling agent over farm data (read-only Q&A first). (2) Rule-plus-statistics anomaly and mortality early-warning. (3) Feeding recommendations from feeding tables, biomass and temperature. (4) Weekly natural-language report on WhatsApp. Build growth/harvest forecasting next. Photo fish counting and sizing is R&D. Photo disease ID: **don't ship as a diagnosis.** |
| 3 | Competitive position | Incumbents (aquaManager, FishTalk, Aquabyte, Ace Aquatec, Umitron) target large salmon, sea-bass or shrimp operators with hardware and enterprise sales. Asian shrimp apps (JALA, Kampi) show the model. We found **no WhatsApp-first, mobile-money-billed, offline tilapia/catfish tool** for West Africa. Win on WhatsApp entry, MoMo billing, offline use, FR/EN plus local voice, and buyer/lender-grade records. |
| 4 | Billing | **Paystack** (Ghana MoMo 1.95%; Côte d'Ivoire MoMo, including Orange, MTN and Wave, 1.95% + tax). Use **Paystack Subscriptions for cards**. For MoMo, run **our own "renewal invoice + WhatsApp pay-link" loop**, because Paystack auto-recurring covers card and Nigerian direct debit only. Integrate it ourselves in Convex (Effect + `requestJson`), not through a community component. |

---

## 1. WhatsApp + Telegram conversational bot for record entry

### 1.1 Meta WhatsApp Cloud API: what it costs and what it allows

**Pricing model (2025–26).** Since **1 July 2025** Meta charges **per delivered message**. The price depends on the template category and the recipient's market. Messages from users to the business are free. ([Meta pricing](https://developers.facebook.com/docs/whatsapp/pricing))

- **Template messages** (marketing, utility, authentication) can be sent at any time.
- **Non-template "service" messages** can only be sent inside an open **24-hour customer-service window**. Each user message opens or resets the window. ([Meta pricing](https://developers.facebook.com/docs/whatsapp/pricing))
- **Change effective 1 Oct 2026:** service messages are no longer free without limit. Each business phone number gets **1,000 free service messages a month**. From the 1,001st, service messages are charged. Without a payment method on file, Meta stops delivering them after the free tier. ([Meta pricing, "Free tier of monthly service messages"](https://developers.facebook.com/docs/whatsapp/pricing#free-tier-of-monthly-service-messages))
- **Ghana (+233) and Côte d'Ivoire (+225)** are both in the **"Rest of Africa"** market. ([Meta pricing, country calling codes](https://developers.facebook.com/docs/whatsapp/pricing#pricing-regions-on-the-rate-card-country-calling-codes))

**USD rate card effective 1 Oct 2026** (Meta's linked USD list-rates file, read on 2026-11-19, [source](https://developers.facebook.com/docs/whatsapp/pricing#rate-cards-and-volume-tiers)):

| Market | Marketing | Utility | Authentication | Service (after 1,000 free) |
|---|---|---|---|---|
| **Rest of Africa (GH, CI)** | **$0.0225** | **$0.0040** | **$0.0040** | **$0.0040** |
| Nigeria (reference) | $0.0516 | $0.0067 | $0.0067 | $0.0067 |

- **Free entry point:** a conversation that starts from a Click-to-WhatsApp ad opens a window of up to 7 days in which marketing, utility, authentication and service messages are free. ([Meta pricing, FEP](https://developers.facebook.com/docs/whatsapp/pricing#free-entry-point-window-fep))
- **"Meta Business Agent" category:** Meta's own hosted AI bills **$2 per 1M tokens**, which Meta puts at about 4–5¢ per message. We should **not** use it; our own agent replies are cheaper "service" messages. ([Meta pricing](https://developers.facebook.com/docs/whatsapp/pricing#charges-for-meta-business-agent-messages))

**Cost example (our estimate from the rates above).** A farm with 10 workers, each replying to 1 reminder a day for 30 days, with about 3 bot replies per entry:
- 300 utility reminders × $0.004 = **$1.20**
- about 900 service replies: inside the 1,000 free tier if this is the only farm on the number; otherwise ≤ $3.60
- **Total: about $1.20–$4.80 per farm per month.** One shared business number serves all tenants, so the free 1,000 is shared, and margins must cover service messages at scale.

**Capabilities that matter here**
- **Media download.** Inbound audio, image and document webhooks carry a media ID. The URL you get from it **expires after 5 minutes**, so the media must be fetched straight away. Audio formats include AAC, AMR, MP3, M4A and OGG/Opus, each up to **16 MB**. ([Media reference](https://developers.facebook.com/docs/whatsapp/cloud-api/reference/media))
- **Interactive reply buttons and lists.** These cover confirm/edit/cancel and pickers such as "which cage?". **WhatsApp Flows** are multi-screen structured forms inside WhatsApp, designed for lead capture, quotes and similar. ([Flows](https://developers.facebook.com/docs/whatsapp/flows)) A Flow suits a guided "daily entry" form for low-literacy users: it works without free text but needs connectivity while filling.
- **Outbound status webhooks** report `pricing.billable/type/category` per message. We should persist these for cost attribution. ([Meta pricing](https://developers.facebook.com/docs/whatsapp/pricing#free-tier-of-monthly-service-messages))

**BSP vs direct**
- **Twilio** adds **$0.005 per message, inbound or outbound**, on top of Meta's fees. ([Twilio WhatsApp pricing](https://www.twilio.com/en-us/whatsapp/pricing))
- **360dialog** costs **€49 / €99 / €500 per number per month** plus Meta fees. ([360dialog pricing](https://360dialog.com/pricing))
- Twilio's $0.005 alone exceeds the $0.004 Ghana utility rate. We already have a direct Cloud API adapter. **Go direct.**

**Unofficial libraries: do not use.**
- **Baileys** (WhiskeySockets/Baileys, ★11.7k, MIT, last push 2026-11-17) and **whatsapp-web.js** (wwebjs, ★22.9k, Apache-2.0, last push 2026-11-15) automate a consumer WhatsApp account. ([Baileys](https://github.com/WhiskeySockets/Baileys), [whatsapp-web.js](https://github.com/wwebjs/whatsapp-web.js))
- WhatsApp's Terms forbid accessing the service "through automated means" in unauthorized ways, and forbid "bulk messaging, auto-messaging". ([WhatsApp Terms of Service](https://www.whatsapp.com/legal/terms-of-service))
- The risk is a number ban, which would mean losing every farm's channel at once. **Rejected.**

### 1.2 Telegram Bot API

- **Free.** Webhooks can carry a `secret_token`, which Telegram returns in `X-Telegram-Bot-Api-Secret-Token`. ([Bot API, setWebhook](https://core.telegram.org/bots/api#setwebhook))
- `getFile` downloads up to **20 MB**, and the link is valid for at least 1 hour. ([Bot API, getFile](https://core.telegram.org/bots/api#getfile))
- Keyboard buttons can `request_contact`, which shares the user's phone number. ([Bot API, KeyboardButton](https://core.telegram.org/bots/api#keyboardbutton))
- Broadcast limit is about 30 msg/s by default. ([Bots FAQ](https://core.telegram.org/bots/faq))
- The API is current: Bot API 10.4 shipped 2026-11-09. ([Bot API changelog](https://core.telegram.org/bots/api))
- **Role:** a cheap secondary channel for managers and French-speaking teams. In Ghana, WhatsApp is the primary channel **(unverified market-share claim, but consistent with the stated user base)**.

### 1.3 Frameworks and libraries

GitHub/npm data is from 2026-11-19.

| Option | Activity / license | Fit with Convex + Vercel | Verdict |
|---|---|---|---|
| **`@convex-dev/agent`** ([repo](https://github.com/get-convex/agent), [docs](https://docs.convex.dev/agents)) | ★361, push 2026-11-19, Apache-2.0, npm 0.7.10 (2026-11-17) | Threads/messages in Convex, tool calls, RAG, **usage tracking per user/model**, **rate limiting via the Rate Limiter component** (already installed), **human agents in threads**, files in thread history ([README](https://github.com/get-convex/agent#readme)) | **Use**: the agent runtime |
| **`@convex-dev/workflow`** ([repo](https://github.com/get-convex/workflow)) | ★86, push 2026-11-18, Apache-2.0, npm 0.5.0 | Durable multi-step runs: download media → transcribe → parse → confirm | **Use** for the voice/photo pipeline |
| `@convex-dev/rate-limiter` ([repo](https://github.com/get-convex/rate-limiter)) | ★27, push 2026-11-18, Apache-2.0 | Already installed (`convex/convex.config.ts`) | **Reuse**: per-phone and per-org limits |
| `@convex-dev/rag` ([npm](https://www.npmjs.com/package/@convex-dev/rag)) | npm 0.7.9 (2026-11-10), Apache-2.0 | SOP/feed-table retrieval | Later |
| **Vercel AI SDK** `ai` ([repo](https://github.com/vercel/ai)) | ★28.1k, push 2026-11-19, Apache-2.0 | `@convex-dev/agent` is built on it; model-agnostic | **Use** (indirectly) |
| **Vercel Chat SDK** `chat` ([repo](https://github.com/vercel/chat)) | ★2.5k, push 2026-11-18, MIT, npm 4.45.0; has `adapter-whatsapp`, `adapter-telegram`, `adapter-twilio` | State adapters are memory, Redis, ioredis and Postgres only ([packages](https://github.com/vercel/chat/tree/main/packages)), with **no Convex state**. The bot would live in Vercel functions, outside Convex auth and transactions | **Don't adopt now.** Revisit if we add Slack or Teams |
| grammY ([repo](https://github.com/grammyjs/grammY)) | ★3.8k, push 2026-10-16, MIT | Fine, but Telegram webhooks are simple JSON; one `requestJson` adapter is enough | Optional; not needed |
| Botpress ([repo](https://github.com/botpress/botpress)) | ★15.0k, push 2026-11-18, MIT | A separate hosted runtime, so auth and tenancy would be duplicated | Reject |
| Rasa ([repo](https://github.com/RasaHQ/rasa)) | ★21.4k, **last push 2026-07-24**, Apache-2.0 | Python NLU stack plus hosting; slowing activity | Reject |
| Typebot ([repo](https://github.com/baptisteArno/typebot.io)) | ★10.6k, push 2026-11-07, **Functional Source License 1.1** | Flow builder; FSL limits competing commercial use; separate runtime | Reject |
| n8n ([repo](https://github.com/n8n-io/n8n)) | ★211k, push 2026-11-19, **Sustainable Use License** (fair-code) | Embedding it in a SaaS sold to customers is restricted; separate runtime | Reject for product; OK for internal ops |
| Chatwoot ([repo](https://github.com/chatwoot/chatwoot)) | ★40.2k, push 2026-11-19, MIT core + enterprise portions | Human-handoff inbox. It needs its own WhatsApp channel or webhook relay | **Defer.** Use the Agent component's human-agent threads and an in-app inbox first |
| Twilio / 360dialog | see §1.1 | Extra per-message or per-number fees | Reject (go direct) |

### 1.4 Speech-to-text and OCR

| Need | Option | Evidence | Verdict |
|---|---|---|---|
| English, French | **OpenAI Whisper** (open model ★113k MIT, [repo](https://github.com/openai/whisper)); self-host via faster-whisper ★26.9k MIT ([repo](https://github.com/SYSTRAN/faster-whisper)) or whisper.cpp ★55.3k MIT ([repo](https://github.com/ggml-org/whisper.cpp)); hosted API ([docs](https://platform.openai.com/docs/guides/speech-to-text)) | Whisper's tokenizer includes French, Yoruba, Hausa and Lingala, but **no Twi/Akan, Ewe or Ga** ([tokenizer.py](https://github.com/openai/whisper/blob/main/whisper/tokenizer.py)) | **Use** hosted for EN/FR |
| Twi, Ewe, Ga (+ Dagbani, Frafra) | **Khaya AI (GhanaNLP)** ASR, translation and TTS APIs ([developer.khaya.ai](https://developer.khaya.ai/)) | Says it covers "Twi, Ewe, Ga, Dagbani, Frafra" for ASR. Pricing sits behind sign-in **(unverified)** | **Use** for Ghanaian languages; benchmark on 50 real farm voice notes first |
| Many languages, incl. Akan/Ewe | **Meta MMS** `facebook/mms-1b-all` ([HF](https://huggingface.co/facebook/mms-1b-all)) | Model card lists `ak`, `ee`, `fr`; licence is **CC-BY-NC-4.0** (non-commercial) | **Reject for production** (licence) |
| Google Cloud STT | ([supported languages](https://cloud.google.com/speech-to-text/docs/speech-to-text-supported-languages)) | Akan/Twi, Ewe and Ga were not in the published list we fetched **(verify again before deciding)** | Not primary |
| Paper logbook photos | Multimodal LLM (e.g. Gemini image understanding, [docs](https://ai.google.dev/gemini-api/docs/image-understanding)) returning JSON rows; PaddleOCR ★92.9k Apache-2.0 ([repo](https://github.com/PaddlePaddle/PaddleOCR)) as a self-host fallback | JALA already ships "input handwritten notes into the app using your camera" ([JALA pricing](https://jala.tech/en/pricing)), so the feature is market-proven | **Use a vision LLM**. Echo every extracted row for confirmation |

**Rule:** a transcript or OCR result is never written directly. It becomes a **draft** that is echoed back ("I heard: cage 4, feed 25 kg, 3 dead. Save?").

### 1.5 Recommended architecture

```
WhatsApp Cloud ──POST /channels/whatsapp (X-Hub-Signature-256)──┐
Telegram ───────POST /channels/telegram (X-Telegram-…-Secret-Token)┤
                                                                   ▼
                 Convex httpAction (verify signature, NO LLM here)
                 → internalMutation ingestInbound:
                     insert channelInbound {provider, externalId (wamid / update_id) UNIQUE,
                                             from, type, payload, receivedAt, sentAt}
                     duplicate externalId → no-op (Meta/Telegram retry)
                 → 200 OK fast; ctx.scheduler.runAfter(0, process)
                                                                   ▼
                 internalAction process (workflow for media):
                   1. resolve identity: channelBindings[provider, address] → userId
                        (unbound → onboarding reply, nothing else)
                   2. rate-limit (rateLimiter: per binding + per org)
                   3. media? download within 5 min → R2/Convex storage
                        → STT (Whisper EN/FR | Khaya Twi/Ewe/Ga) or vision OCR
                   4. @convex-dev/agent thread per binding; tools:
                        read:  getCageStatus, getFcr, getMortality, listCages …
                        write: proposeDailyEntry / proposeHarvest / proposeApproval …
                               → insert pendingBotActions (validated, NOT committed)
                   5. reply: summary + interactive buttons [Save] [Edit] [Cancel]
                                                                   ▼
                 Button reply (payload = pendingActionId)
                 → internalMutation commitPendingAction:
                     load binding user → memberContext(ctx, user)
                     → requirePermission + assertSiteInScope   (same as web)
                     → call the SAME internal write helper the public mutation uses
                     → idempotencyKeys row keyed by pendingActionId
                     → audit log with channel="whatsapp", sourceMessageId
```

**Design rules**

1. **Identity binding.** Add a `channelBindings` table: `{provider, address (E.164 or tg user id), userId, companyId, activeSiteId?, verifiedAt, revokedAt}`.
   - *WhatsApp:* bind only when `from` equals a `users.phone` that has `phoneVerificationTime` set (existing `phone` index in `convex/schema.ts`). The user also confirms once with a one-time code shown in the app, so a recycled SIM can't inherit a farm. Re-check on every write that the user is still active and still a member.
   - *Telegram:* bind through a deep link `t.me/<bot>?start=<one-time token>` generated in the app. Optionally cross-check `request_contact` against the verified phone.
   - Users in several companies or sites pick the active one from an interactive list, saved on the binding.
2. **Permissions.** Tools never take `companyId` or `siteId` from the LLM as trusted input. They take them from the binding, then run `memberContext` → `requirePermission` → `assertSiteInScope` ([convex/lib/permissions.ts](convex/lib/permissions.ts)), the same path as the web app. Extract the core of each public mutation into a helper that takes `(ctx, member, args)`, so web, public API and bot share it. `createDailyRecordsHandler` in [convex/integrations/apiHttp.ts](convex/integrations/apiHttp.ts) already shows a non-session caller doing this.
3. **Confirmation before writes.** The LLM can only *propose*. Commits happen on an explicit button tap, or a typed "yes" inside the window. Drafts expire after 24 h. An "Undo" button within 10 minutes soft-deletes the record using the existing audit trail.
4. **Idempotency.** Use three keys:
   - inbound `externalId` (unique), which absorbs webhook retries;
   - `pendingActionId`, so a double tap gives one write (reuse `idempotencyKeys`);
   - a content guard: the same cage, date, type and quantity within 10 minutes prompts "Looks like a duplicate — save anyway?".
5. **Offline-friendly.** WhatsApp queues on the phone and delivers when signal returns. Use the message `timestamp` from the webhook as the record's event time (not the receive time). Default the record date to that timestamp in the farm's timezone and show it in the confirmation. The bot complements the PWA offline outbox ([lib/offlineOutbox.js](lib/offlineOutbox.js)); it doesn't replace it.
6. **Reminders and approvals.**
   - Daily reminders go through cron → **utility template** ($0.004 GH/CI) with quick-reply buttons. Inside an open window, use free-form service messages instead.
   - Approvals (e.g. harvest or feed transfer) use a utility template with Approve/Reject buttons. The tap commits through the existing `assertDifferentApprover`.
7. **Cost control.** Persist `pricing` from status webhooks per org. Count LLM tokens through the Agent usage tracking hooked into the existing `llmQuota`. Rate-limit per binding.
8. **Language.** Detect from the binding's user preference (EN/FR) and reply in that language. Twi/Ewe/Ga voice input is transcribed and then handled in English internally. Echo a short English/French confirmation; Khaya TTS for spoken replies can come later.
9. **Security.**
   - Verify `X-Hub-Signature-256` (HMAC-SHA256 of the raw body with the app secret) and the Telegram secret header before any DB write.
   - Never echo data from other sites.
   - Treat message text as untrusted (prompt injection); tools enforce scope regardless of what the LLM asks for.
   - Run the repo's security-audit skill before release (webhook + public HTTP surface).

**Recommendation (§1).** Build the architecture above. Order of work:
1. Inbound WhatsApp webhook + binding + idempotent store.
2. Read-only Q&A tools ("FCR cage 4 last week").
3. Text entry with confirm buttons (feeding, mortality).
4. Daily reminder templates.
5. Voice (EN/FR, then Khaya).
6. Photo-of-sheet OCR.
7. Approvals.
8. Telegram adapter.

Use `@convex-dev/agent` + `@convex-dev/workflow`. Don't use a BSP, an unofficial WhatsApp library, or an external bot runtime.

---

## 2. Advanced AI features, ranked by value/effort

The ranking is our judgement for small and medium tilapia/catfish farms. Citations support the feasibility claims.

| Rank | Feature | Value | Effort | Notes / evidence |
|---|---|---|---|---|
| 1 | **Tool-calling agent over farm data** (Q&A + record entry, web and WhatsApp) | Very high | Medium | The pieces exist (`convex/assistant.ts` context, `llmGateway`). The Agent component adds tools, threads and usage ([docs](https://docs.convex.dev/agents)). Read-only answers must cite their numbers (cage, date range) so users can trust them. |
| 2 | **Anomaly + mortality early-warning** | Very high | Low–Med | Start with rules plus robust statistics on existing rollups: mortality > X% of stock per day, a 3-day rising trend, feed intake down > 20% vs the 7-day median, DO/temperature out of range from sensors. ML ideas exist in the literature (e.g. disease risk from water quality, [arXiv 2102.09390](https://arxiv.org/abs/2102.09390)), but explainable rules ship first. Alerts go out as WhatsApp utility templates. |
| 3 | **Feeding recommendations** | High | Medium | Daily ration = biomass (from sampling ABW × estimated count) × feed-rate table by size and temperature, using the farm's `feedingPlans`. Show it as a suggestion with its reasons, never auto-applied. aquaManager and Umitron sell feeding optimisation as a headline feature ([aquaManager](https://www.aqua-manager.com/), [Umitron](https://umitron.com/en/service.html)). |
| 4 | **Natural-language weekly report** (manager/owner, EN/FR, WhatsApp + PDF) | High | Low | LLM summarises existing `reportBuilder`/rollup numbers. It must not invent numbers: pass a computed JSON and check that every number in the output appears in that JSON. |
| 5 | **Growth and harvest forecasting** | High | Medium | `convex/lib/analytics.ts` already has `forecast` and `targetAbw`. Next, fit per-farm growth curves (e.g. a thermal-unit growth coefficient) and give harvest-date and biomass ranges. Competitors offer scenario planning and forecasting ([aquaManager](https://www.aqua-manager.com/)). |
| 6 | **Paper-sheet OCR → records** | High in field | Medium | See §1.4; JALA ships it ([JALA](https://jala.tech/en/pricing)). |
| 7 | **Image-based fish counting / size estimation** | Medium | High (R&D) | Commercial systems use fixed underwater cameras in pens: Aquabyte runs "over 800 systems in pens" ([Aquabyte](https://www.aquabyte.ai/)) and Ace Aquatec sells a biomass camera ([Ace Aquatec](https://www.aceaquatec.com/aquaculture-products/grow/)). A phone photo of fish on a board **with a reference marker** can estimate length → weight via a species L–W relationship. Open tooling: Roboflow Supervision ★51.7k **MIT** ([repo](https://github.com/roboflow/supervision)); Ultralytics YOLO ★63.6k is **AGPL-3.0** and needs a commercial licence for closed SaaS ([repo](https://github.com/ultralytics/ultralytics)). Public data: DeepFish ([arXiv 2008.12603](https://arxiv.org/abs/2008.12603)). Pilot only: "sample-weighing assistant" on a measuring board. |
| 8 | **Disease ID from photos** | Low (as a diagnosis) | High | Published image classifiers ([arXiv 2105.03934](https://arxiv.org/abs/2105.03934)) use small, narrow datasets and don't generalise to field photos of tilapia/catfish in Ghana. **Don't ship a diagnosis.** At most: "possible signs: lesions, fin rot. Isolate, check DO/ammonia, contact a vet", with a symptom checklist and a button to escalate to an extension officer or vet. |

**Recommendation (§2).** Build ranks 1–4 in the next two quarters. Ranks 5–6 follow. Fund 7 as a small R&D spike. Never present 8 as a diagnosis.

---

## 3. Competitors

Facts come from vendor pages fetched on 2026-11-19. "Pricing" means *publicly listed*; most are quote-only.

| Product | Segment | Public pricing | Standout | Weakness vs our target |
|---|---|---|---|---|
| **aquaManager** ([site](https://www.aqua-manager.com/)) | Mid–large multi-species farms (fish and shrimp; Regal Springs logo shown) | Demo / quote | Hatchery→harvest, cost per kg, scenario planning, BI + ML, IoT integration | Enterprise sales; no MoMo billing or WhatsApp entry advertised |
| **FishTalk (AKVA group)** ([AKVA digital](https://www.akvagroup.com/digital/solutions/our-digital-solutions); FishTalk sales contact listed on [AKVA site](https://www.akvagroup.com/search/?q=fishtalk)) | Large salmon / Nordic, integrated with AKVA feeding hardware | Quote | Precision feeding, lice and welfare, deep integration with AKVA equipment | Built for salmon and enterprises; heavy; FishTalk product page returned 404 on 2026-11-19 |
| **eFishery** ([Wikipedia](https://en.wikipedia.org/wiki/EFishery)) | Indonesian fish/shrimp smallholders; IoT feeders + financing | — | Smart feeders, eFisheryKu app, eFishery Fund financing | **Audit-revealed accounting fraud (late 2024)**, large layoffs in 2025, efishery.com unreachable on 2026-11-19. The lesson: embedded finance works, and trustworthy data is the moat. |
| **Aquabyte** ([site](https://www.aquabyte.ai/), [products](https://www.aquabyte.ai/products)) | Salmon sea pens (Norway) | Demo | Camera AI: weight, lice, welfare, appetite; "over 800 systems in pens" | Hardware-heavy, salmon-specific |
| **Umitron** ([services](https://umitron.com/en/service.html)) | Japan/Asia marine farms; feeding | Quote | AI and IoT smart feeder, appetite detection, satellite ocean data | Hardware; not built for ponds or cages in Ghana |
| **XpertSea → Kampi** (xpertsea.com now redirects to [bekampi.com](https://bekampi.com/)) | Shrimp farms (Latin America) | Quote | ML guidance from daily records, says it cuts human error by up to 90% | Shrimp-only, Spanish-first |
| **Observe Technologies** ([site](https://observe.tech/)) | Camera / feeding analytics | — | **(unverified)**: site is JS-only with no readable content on 2026-11-19 | Status unclear |
| **FarmMOJO** | Indian shrimp app | — | **(unverified)**: farmmojo.in did not resolve and farmmojo.com was a dead Wix page on 2026-11-19 | Likely inactive |
| **Aquaconnect** ([site](https://aquaconnect.blue/)) | South Asian shrimp value chain | — | AI + satellite sensing, market links, feed/biologicals, cross-border trade | Marketplace and trade first; India focus |
| **JALA** ([pricing](https://jala.tech/en/pricing)) | Indonesian shrimp | **Free: up to 10 ponds / 3 users. Plus: IDR 450,000 per user (30% off annual)**, paid via app stores | AI-assisted recording, camera sampling, **handwritten-note capture**, price data, Baruni water device | Shrimp-only; app-store billing |
| **Ace Aquatec** ([site](https://www.aceaquatec.com/)) | Welfare tech: stunning, predator control, biomass cameras; lists tilapia among species | Quote | Biomass camera, humane stunners | Hardware, not farm management |
| **AquaCloud** ([site](https://aquacloud.ai/)) | Norwegian industry data-sharing | — | 32 farmers sharing data, about 55% of Norwegian salmon/trout biomass; standards such as NS 9417 | A data consortium, not a farm tool. The model fits a future **Ghana benchmark pool** |
| **Mercatus** | Norwegian salmon planning **(unverified)** | — | mercatus.no unreachable and mercatus.com Cloudflare-blocked on 2026-11-19 | — |
| **Tidal (ex-Google X)** ([X page](https://x.company/projects/tidal/)) | Underwater AI for ocean farms | — | Graduated from X as an independent company in 2024 | Salmon/ocean, hardware |
| **Aquaweb** | **(unverified)**: aquaweb.no unreachable on 2026-11-19 | — | — | — |
| **Aquarech (Kenya)** ([site](https://www.aquarech.com/)) | Small/medium East African tilapia farmers | — | App with **feed purchase, selling harvest, training**; own feed brand | Marketplace-led, not deep farm records; Kenya/Swahili focus |
| **Ghana / West Africa** | — | — | We found no dedicated Ghanaian aquaculture SaaS in this pass. Farmerline ([site](https://farmerline.co/)) is a Ghanaian agri platform, not aquaculture-specific | **Gap** (verify with field interviews; our web search was limited because search engines blocked scraping) |

### 3.1 Gap analysis: pbafarm vs field

**What pbafarm already has**
- Multi-tenant, site-scoped permissions.
- Daily, feeding, mortality, harvest and sampling records.
- Hatchery and nursery.
- Inventory and P&L.
- Traceability and compliance.
- Sensors.
- Custom forms.
- Offline outbox.
- AI assistant with BYO keys.
- SMS and WhatsApp OTP.

On features, that already matches or beats aquaManager-class tools for tilapia/catfish.

**Where incumbents lead**
- Camera hardware and biomass AI (Aquabyte, Ace Aquatec, Umitron).
- Scenario planning and digital twins (aquaManager).
- Industry benchmarks (AquaCloud).

**Where nobody serves small/medium African farms**
- Data entry over WhatsApp, including voice in local languages.
- Subscriptions paid by mobile money.
- UX for low literacy and low bandwidth.
- Feed supplier ordering.
- Records that lenders or insurers accept.
- Traceability that buyers accept.

### 3.2 Prioritised features to beat them

1. **WhatsApp-first entry, reminders and approvals** (§1). This is the biggest differentiator and builds the daily habit.
2. **MoMo billing with GHS/XOF pricing, plus a free tier like JALA's** (≤ 1 site, ≤ 3 users, ≤ 10 units) (§4).
3. **Low-literacy UX:**
   - icon-first daily entry;
   - WhatsApp Flows forms;
   - voice confirmation (Khaya TTS later);
   - French parity everywhere.
4. **Offline-solid PWA.** Harden the outbox, add conflict UI, and target < 1 MB first load on cheap Android phones.
5. **Lender/insurer data pack.** A signed, tamper-evident export (audit chain exists) of stocking, survival, FCR and sales history. eFishery showed both the demand for embedded finance and the need for *verifiable* data ([Wikipedia](https://en.wikipedia.org/wiki/EFishery)).
6. **Buyer traceability QR.** Lot → farm → feed → harvest. `qrcode` is already a dependency and traceability already exists.
7. **Feed supplier marketplace (light).** Start with reorder-to-supplier over WhatsApp from inventory thresholds, then partner catalogues. Aquarech shows the model ([Aquarech](https://www.aquarech.com/)).
8. **Anonymous benchmarks** (opt-in, AquaCloud-style): "your FCR vs similar cage farms in Volta Lake".

**Recommendation (§3).** Position pbafarm as *"the WhatsApp-native farm record and finance-ready platform for African tilapia and catfish"*. Don't compete on camera hardware. Ship items 1, 2 and 5 first.

---

## 4. SaaS billing for Africa

| Provider | Ghana MoMo | Côte d'Ivoire MoMo | Recurring | Fees (public) | Convex integration |
|---|---|---|---|---|---|
| **Paystack** | Yes ([GH pricing](https://paystack.com/gh/pricing)) | **Orange Money, MTN MoMo, Wave** ([CI pricing](https://paystack.com/ci/pricing)) | Subscriptions API: **"Card and Direct Debit (Nigeria) only"** ([docs](https://paystack.com/docs/payments/subscriptions/)) | **GH: 1.95%** local and international; MoMo payout GHS 1. **CI: MoMo 1.95%, local cards 3.2%, international cards 3.8%, excl. tax** | `convex-paystack` 0.0.5 (community, 2026-09-18) ([npm](https://www.npmjs.com/package/convex-paystack)); `paystack-node` ★33 MIT ([repo](https://github.com/PaystackOSS/paystack-node)). **Recommend direct REST via Effect `requestJson`** + webhook httpAction |
| **Flutterwave** | Yes ([GH pricing](https://flutterwave.com/gh/pricing)) | Yes (multi-country; CI pricing not checked) | Has payment plans **(unverified: docs URLs returned 404 on 2026-11-19)** | **GH: 2% MoMo, 2.6% local cards, 4.8% international**; MoMo payout 1.5% | No Convex component |
| **Stripe** | Ghana and Côte d'Ivoire are listed as **"Extended network"** ([Stripe global](https://stripe.com/global)) | same | Best-in-class Billing; MoMo for local entities **(unverified)** | — | `@convex-dev/stripe` 0.2.0, Apache-2.0, ★80, push 2026-11-19 ([repo](https://github.com/get-convex/stripe)) |
| **Hubtel** | Yes, all networks ([developers](https://developers.hubtel.com/)) | **No** (Ghana only) | No recurring/direct-debit API documented publicly **(unverified)** | Pricing behind login ([hubtel.com/pricing](https://hubtel.com/pricing)) | Already a messaging provider in the repo (`providers/hubtel.ts`) |

**How MoMo renewals work in practice.** None of the verified options auto-debits MoMo wallets on a schedule. The pattern that works:
- Our own `subscriptions` table and renewal cron.
- 3 days before renewal, send a **WhatsApp utility template** with a **Paystack payment link** (MoMo prompt on the phone).
- Grace period, then downgrade to read-only.
- Cards use Paystack Subscriptions for true auto-renewal.

The Paystack `charge.success` webhook (signature-verified httpAction, idempotent by reference) extends `paidThrough`.

**Recommendation (§4).** Use **Paystack** as the single processor for Ghana and Côte d'Ivoire:
- Lowest verified MoMo fee in Ghana (1.95% vs Flutterwave's 2%).
- The only verified option covering Orange, MTN and Wave in Côte d'Ivoire.
- T+1 settlement ([GH pricing](https://paystack.com/gh/pricing)).
- Stripe-owned, which lowers counterparty risk **(ownership not re-verified in this pass)**.

Build it in-house: an Effect `Paystack` service plus a `Layer`, following doc 19. Price in GHS and XOF. Keep `@convex-dev/stripe` in reserve for future card-only customers outside Africa (EUR/USD).

---

## 5. Next steps (proposed tickets)

1. **BOT-001:** Inbound WhatsApp webhook httpAction + signature check + `channelInbound` (unique `externalId`) + `channelBindings` with phone-verified binding flow.
2. **BOT-002:** Install `@convex-dev/agent` + `@convex-dev/workflow`. Add read-only tools (status, FCR, mortality, feed stock) using `memberContext`.
3. **BOT-003:** `pendingBotActions` + interactive confirm/edit/cancel + commit through shared write helpers + `idempotencyKeys`.
4. **BOT-004:** Utility templates (EN/FR) for daily reminders and approvals. Persist status-webhook pricing per org.
5. **BOT-005:** Voice pipeline (5-minute media fetch → R2 → Whisper / Khaya), with a 50-note Twi/Ewe/Ga accuracy benchmark before GA.
6. **BOT-006:** Photo-of-logbook OCR with a vision LLM → batch drafts.
7. **AI-001:** Rule-based anomaly and mortality alerts. **AI-002:** feeding suggestions. **AI-003:** weekly NL report.
8. **BILL-001:** Paystack plans + card subscriptions + MoMo renewal-link loop + webhook.
9. **SEC:** Run the security-audit skill on BOT-001/003 and BILL-001 before merge (webhooks, public HTTP, payments).
