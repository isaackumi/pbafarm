# Farm bot runbook (WhatsApp + Telegram)

Architecture: `docs/architecture/23-farm-bot.md`.

Every value below goes in the **Convex** deployment environment (Dashboard → Settings → Environment Variables, or `npx convex env set NAME value`), not just in Vercel. The webhooks and the bot run in Convex.

`<deployment>` is the Convex deployment name, e.g. `happy-otter-123`. HTTP actions are served at `https://<deployment>.convex.site`.

## 1. WhatsApp: Meta app and number

1. **Create the Meta app.** In Meta Business Suite, create (or reuse) a **Business portfolio**. At developers.facebook.com, create an app of type **Business** and add the **WhatsApp** product.
2. **Set up the WhatsApp Business Account (WABA).** Under WhatsApp → API Setup, add a phone number for the bot. It must be a number not used in the WhatsApp app. Verify it by SMS or voice.
   - Copy the **Phone number ID** → `WHATSAPP_BOT_PHONE_NUMBER_ID`.
   - Put the human-readable number, digits only (e.g. `233201234567`), in `WHATSAPP_BOT_DISPLAY_NUMBER`. It is used for the wa.me link on `/account`.
3. **Create a permanent token.** In Business settings → Users → System users, add a system user (Admin) and assign the app and the WABA with *Full control*.
   - Generate a token with `whatsapp_business_messaging` and `whatsapp_business_management`, set to never expire.
   - Store it as `WHATSAPP_BOT_ACCESS_TOKEN`.
4. **Copy the app secret.** In App settings → Basic → **App secret** → `WHATSAPP_APP_SECRET`. It is used to check `X-Hub-Signature-256` on every webhook.
5. **Configure the webhook** (WhatsApp → Configuration → Webhook):
   - Callback URL: `https://<deployment>.convex.site/channels/whatsapp`.
   - Verify token: any long random string, also set as `WHATSAPP_VERIFY_TOKEN` (`openssl rand -hex 24`). Set the env var **before** clicking *Verify and save*: Convex answers Meta's GET handshake with the challenge only when the token matches.
   - Subscribe to the **`messages`** field. It carries inbound messages and the delivery statuses with pricing.
6. **Payment and display name.** Add a payment method to the WABA; utility templates outside the 24 h window are billed. Get the display name approved.
7. **Test.** On `/account` (phone verified), tap *Connect WhatsApp* and send `LINK 123456` from your phone. The bot answers *Connected…*.

## 2. Telegram: BotFather and webhook

1. **Create the bot.** In Telegram, open **@BotFather** → `/newbot` → choose a name and a username ending in `bot`.
   - Store the token as `TELEGRAM_BOT_TOKEN`.
   - Store the username, without `@`, as `TELEGRAM_BOT_USERNAME`. It is used for the `t.me/<bot>?start=…` deep link.
2. **Set the bot up** (optional): `/setdescription`, `/setuserpic`, and `/setcommands`:
   ```
   help - What I can do
   site - Choose the site
   org - Choose the organization
   stop - Disconnect this chat
   ```
   Leave **privacy mode** on; the bot ignores groups anyway.
3. **Create the webhook secret.** Run `openssl rand -hex 32` and set the result as `TELEGRAM_WEBHOOK_SECRET`. Use only `A-Z a-z 0-9 _ -`, at most 256 characters.
4. **Register the webhook:**
   ```bash
   curl -sS "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook" \
     -H 'Content-Type: application/json' \
     -d '{"url":"https://<deployment>.convex.site/channels/telegram",
          "secret_token":"'"$TELEGRAM_WEBHOOK_SECRET"'",
          "allowed_updates":["message","callback_query"],
          "drop_pending_updates":true}'
   curl -sS "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/getWebhookInfo"
   ```
   Telegram sends the secret in `X-Telegram-Bot-Api-Secret-Token`. Requests without it get 401.
5. **Test.** On `/account`, tap *Connect Telegram*, open the link, and press **Start**.

## 3. WhatsApp message template (daily reminder)

Outside 24 hours after the user's last message, WhatsApp only allows approved templates. Submit this one in WhatsApp Manager → Message templates → Create. Use the same name in both languages.

| Field | Value |
|---|---|
| Category | **Utility** |
| Name | `farm_daily_reminder` |
| Languages | English (`en`) and French (`fr`) |
| Body (en) | `{{1}} units have no entry today: {{2}}. Reply here to enter feed and mortality.` |
| Body (fr) | `{{1}} unités n'ont pas de saisie aujourd'hui : {{2}}. Répondez ici pour saisir l'aliment et la mortalité.` |
| Sample values | `{{1}}` = `3`, `{{2}}` = `Cage 1, Cage 4, Pond B` |
| Buttons | 3 × **Quick reply**: en `Enter now` / `Later` / `Stop reminders`; fr `Saisir` / `Plus tard` / `Arrêter les rappels` |

When sending, the code fills the quick-reply payloads with `rem:enter`, `rem:later` and `rem:stop` in that order, so keep the buttons in this order.

If the template is not yet approved, sends outside the window fail and are logged on the inbound row. Free-form reminders inside the window still work.

Template names and languages are set in `convex/bot/i18n.ts` (`REMINDER_TEMPLATES`). Change them there if Meta requires a different name.

## 4. LLM for the bot

The bot uses the organization's own LLM key when one is set (Settings → AI). Otherwise it uses the server key. Configure at least one server key:

| Variable | Purpose |
|---|---|
| `GEMINI_API_KEY` / `OPENAI_API_KEY` / `OPENROUTER_API_KEY` / `ANTHROPIC_API_KEY` / `GROQ_API_KEY` / `CUSTOM_LLM_API_KEY` (+ `CUSTOM_LLM_BASE_URL`) | Server key, same as the web assistant |
| `BOT_LLM_PROVIDER` | Optional: provider id to use for the bot (`gemini`, `openai`, …) |
| `BOT_LLM_MODEL` | Optional: model id; otherwise the provider's default |

The organization must turn on the AI assistant (Settings → AI, `aiAssistantEnabled`). Without it, buttons, commands and reminders work, but free text gets *the assistant is off*.

Usage is in `llmUsage` with feature `bot`, and counts against the same per-user and per-organization limits as the web assistant.

## 5. Environment variables (Convex)

| Variable | Required | Notes |
|---|---|---|
| `WHATSAPP_BOT_PHONE_NUMBER_ID` | WhatsApp | Required: inbound for other phone numbers, or all inbound when unset, is ignored |
| `WHATSAPP_BOT_ACCESS_TOKEN` | WhatsApp | System user token |
| `WHATSAPP_APP_SECRET` | WhatsApp | Without it every POST is 401 |
| `WHATSAPP_VERIFY_TOKEN` | WhatsApp | Without it the GET handshake is 403 |
| `WHATSAPP_BOT_DISPLAY_NUMBER` | optional | Digits; enables the wa.me link on `/account` |
| `TELEGRAM_BOT_TOKEN` | Telegram | |
| `TELEGRAM_WEBHOOK_SECRET` | Telegram | Without it every POST is 401 |
| `TELEGRAM_BOT_USERNAME` | Telegram | For the deep link |
| `SITE_URL` | recommended | App URL in onboarding replies |
| LLM keys | for free text | §4 |

## 6. Operations

**Disconnecting chats**
- To disconnect a user's chats, they use `/account` → Disconnect. An admin suspends the membership, which revokes the user's bindings on the next message or immediately via the hook.
- A user who changes phone number loses the WhatsApp binding.

**Stopping the bot**
- WhatsApp: unsubscribe the webhook in Meta.
- Telegram: `deleteWebhook`.
- Removing `WHATSAPP_APP_SECRET` / `TELEGRAM_WEBHOOK_SECRET` also makes every request fail closed.

**Rotating secrets**
- App secret: rotate in Meta, then update `WHATSAPP_APP_SECRET` at once. Webhooks fail with 401 until both match, and Meta retries for up to 7 days.
- Telegram secret: set the new env var, then call `setWebhook` again with the new `secret_token`.

**Logs and data**
- `channelInbound` keeps every message for 30 days, with status `queued`, `processed`, `ignored` or `failed` and an error field. It is pruned daily at 04:05 UTC.
- Drafts are in `pendingBotActions`. Expiry runs hourly.
- Audit rows for bot writes have `channel` = `whatsapp` or `telegram`, plus `sourceMessageId`.

**Costs**
- `channelMessageCosts` has one row per outbound WhatsApp message, with Meta's category and billable flag from status webhooks. Index: `by_companyId_and_sentAt`.

**Limits**
- See doc 23 §6. A flood from one unbound number gets at most 10 replies an hour; all unbound replies together are capped at 500 an hour.
