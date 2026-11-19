# Anowa cutover: new Convex, Vercel, DNS and bots

Development has moved from `isaackumi/pbafarm` to **`Hei-Tech-Inc/anowa`** and the
product is now **Anowa**. This runbook is for the owner. Nothing here has been
created yet; every step is a manual action in a dashboard or CLI. Values are never
written in this file or in git.

| Surface | Host |
|---|---|
| Tenant app | `https://app.getanowa.com` |
| Platform console | `https://console.getanowa.com` (same Vercel project, PLAT-101) |
| Marketing site | `https://getanowa.com` (repo `Hei-Tech-Inc/anowa-website`, separate) |
| Support / sales | `hello@getanowa.com` |

Order: (a) Convex → (b) Vercel → (c) GitHub secrets → (d) DNS → (e) bot webhooks →
(f) data, then smoke-test. Steps (a)–(e) can run before the data decision in (f).

---

## (a) Convex: new project and production deployment

1. Convex dashboard → team **Hei-Tech-Inc** (create or reuse) → **Create project**
   `anowa`. It comes with a dev deployment; production is created on first deploy
   or under *Deployments*.
2. Production → Settings → **Backups**: enable daily backups (see
   [backup-restore.md](backup-restore.md)).
3. Production → Settings → **Deploy keys** → generate a production deploy key
   (used in (c)). Optional: a second project/deployment for staging
   ([staging-and-cutover.md](staging-and-cutover.md)) and its deploy key.
4. Sign-in keys: `node generateKeys.mjs` prints a new `JWT_PRIVATE_KEY` / `JWKS`
   pair. Reusing the old pair from `vibrant-stork-860` keeps existing sessions
   valid after a data import; a new pair signs everyone out once. Either works.
5. Set the env vars below with `npx convex env set NAME -- "value"
   --prod` (or the dashboard). To copy names from the old deployment:
   `npx convex env list --deployment vibrant-stork-860 --names-only`.

### Convex deployment env vars (read by `convex/**`)

**Required**

| Name | Purpose |
|---|---|
| `JWT_PRIVATE_KEY`, `JWKS` | Convex Auth session signing (step 4) |
| `SITE_URL` | `https://app.getanowa.com`: auth redirects, links in emails and bot replies |

`CONVEX_SITE_URL` is provided by Convex automatically (auth issuer); do not set it.

**Email, SMS, WhatsApp OTP (platform defaults, doc 18 §6)**: `PLATFORM_<CHANNEL>_PROVIDER`
picks the adapter, `PLATFORM_<CHANNEL>_SENDER` the sender, and each credential is
`PLATFORM_<FIELD>`:

| Name | Purpose |
|---|---|
| `PLATFORM_EMAIL_PROVIDER`, `PLATFORM_EMAIL_SENDER`, `PLATFORM_RESEND_API_KEY` | Verification, reset, invite emails (sender e.g. `Anowa <no-reply@getanowa.com>`; verify the domain in Resend) |
| `PLATFORM_SMS_PROVIDER`, `PLATFORM_SMS_SENDER` | Phone sign-in / MFA SMS (sender id e.g. `Anowa`; register it with the SMS vendor) |
| `PLATFORM_HUBTEL_CLIENT_ID`, `PLATFORM_HUBTEL_CLIENT_SECRET`, `PLATFORM_HUBTEL_HOST` | Hubtel adapter |
| `PLATFORM_AT_API_KEY`, `PLATFORM_AT_USERNAME` | Africa's Talking adapter |
| `PLATFORM_TWILIO_ACCOUNT_SID`, `PLATFORM_TWILIO_AUTH_TOKEN`, `PLATFORM_TWILIO_MESSAGING_SERVICE_SID`, `PLATFORM_TWILIO_CONTENT_SID` | Twilio SMS / WhatsApp adapter |
| `PLATFORM_WHATSAPP_PROVIDER`, `PLATFORM_WHATSAPP_SENDER`, `PLATFORM_META_ACCESS_TOKEN`, `PLATFORM_META_PHONE_NUMBER_ID`, `PLATFORM_META_OTP_TEMPLATE`, `PLATFORM_META_TEMPLATE_LANG` | WhatsApp Cloud OTP adapter |

Only the variables of the adapters actually used are needed.

**Farm bot (WhatsApp / Telegram, [farm-bot-runbook.md](farm-bot-runbook.md))**

`WHATSAPP_BOT_PHONE_NUMBER_ID`, `WHATSAPP_BOT_ACCESS_TOKEN`, `WHATSAPP_APP_SECRET`,
`WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_BOT_DISPLAY_NUMBER`, `TELEGRAM_BOT_TOKEN`,
`TELEGRAM_WEBHOOK_SECRET`, `TELEGRAM_BOT_USERNAME`, `BOT_LLM_PROVIDER`, `BOT_LLM_MODEL`.

**LLM keys (bot and AI features on Convex)**: `GEMINI_API_KEY`, `OPENAI_API_KEY`,
`OPENROUTER_API_KEY`, `ANTHROPIC_API_KEY`, `GROQ_API_KEY`, `CUSTOM_LLM_API_KEY`,
`CUSTOM_LLM_BASE_URL`, `LLM_DEFAULT_PROVIDER`.

**Security and integrations**

| Name | Purpose |
|---|---|
| `INTEGRATIONS_ENCRYPTION_KEY` | Encrypts provider credentials and TOTP secrets. **If data is imported (f), this must be the same value as on the old deployment** or stored secrets cannot be decrypted |
| `TURNSTILE_SECRET_KEY`, `TURNSTILE_ALLOWED_HOSTNAMES` | Human check; hostnames `app.getanowa.com,console.getanowa.com` |
| `AUTH_OIDC_ISSUER`, `AUTH_OIDC_ID`, `AUTH_OIDC_SECRET`, `AUTH_OIDC_NAME` | Optional SSO; re-register the redirect URI `<new CONVEX_SITE_URL>/api/auth/callback/oidc` at the IdP |
| `AUTH_SESSION_TOTAL_DURATION_MS` | Optional session length |

**Files (Cloudflare R2, optional, [r2-storage.md](r2-storage.md))**: `R2_ACCOUNT_ID`,
`R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `R2_ENDPOINT`, `FILES_PROVIDER`.
Buckets are now named `anowa-prod` / `anowa-staging`; if data is imported and old
files live in the old bucket, either keep pointing at the old bucket or copy the
objects first (keys are unchanged).

**Billing and platform**: `BILLING_GRACE_DAYS`, `BILLING_PAYMENT_INSTRUCTIONS`.

**Monitoring**: `SENTRY_DSN`, `SENTRY_ENVIRONMENT`.

**Rollout flags** (copy the old values; unset = default): `WRITE_PERMISSION_MATRIX`,
`PRODUCTION_ENGINE_CUTOVER`.

6. First deploy: push to `main` after (c), or locally
   `CONVEX_DEPLOY_KEY=<prod key> npx convex deploy`. Then create the first platform
   admin if the database is empty:
   `npx convex run users:promoteToSuperAdmin '{"email":"…"}' --prod`.

## (b) Vercel: new project from `Hei-Tech-Inc/anowa`

1. Vercel → team for Hei-Tech-Inc → **Add New → Project** → import
   `Hei-Tech-Inc/anowa` (install the Vercel GitHub app on the org if asked).
   Framework Next.js, root `/`, build `npm run build`, production branch `main`.
2. Environment variables (Production; Preview points at staging if it exists):

| Name | Purpose |
|---|---|
| `NEXT_PUBLIC_CONVEX_URL` | `https://<new deployment>.convex.cloud` (required) |
| `NEXT_PUBLIC_CONVEX_SITE_URL` | `https://<new deployment>.convex.site` (required) |
| `NEXT_PUBLIC_PLATFORM_CONSOLE_HOST` | `console.getanowa.com` (this is also the code default) |
| `NEXT_PUBLIC_TENANT_APP_URL` | `https://app.getanowa.com` (console "act as" opens it) |
| `NEXT_PUBLIC_SUPPORT_EMAIL` | `hello@getanowa.com` (code default when unset) |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | Turnstile site key (pair of `TURNSTILE_SECRET_KEY`) |
| `NEXT_PUBLIC_AUTH_OIDC_NAME` | SSO button label, if SSO is on |
| `NEXT_PUBLIC_SENTRY_DSN`, `NEXT_PUBLIC_APP_ENV` | Optional browser monitoring |
| `GEMINI_API_KEY`, `OPENAI_API_KEY`, `OPENROUTER_API_KEY`, `ANTHROPIC_API_KEY`, `GROQ_API_KEY`, `CUSTOM_LLM_API_KEY`, `CUSTOM_LLM_BASE_URL`, `LLM_DEFAULT_PROVIDER`, `LLM_EXTRA_MODELS` | Server-side keys for `pages/api/llm/*` (in-app assistant) |
| `NEXT_PUBLIC_CUSTOM_LLM_BASE_URL` and `NEXT_PUBLIC_*_API_KEY` | Legacy browser-exposed fallbacks; leave unset |

`NEXT_PUBLIC_VERCEL_ENV`, `NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA` and `NODE_ENV` are set
by Vercel. `NEXT_PUBLIC_APP_NAME` is not read by the app.

3. Settings → **Domains**: add `app.getanowa.com` and `console.getanowa.com`, both on
   production (`main`). Vercel shows the CNAME target used in (d).
4. Confirm the plan (Pro for commercial use, CF-001).

## (c) GitHub Actions secrets (`Hei-Tech-Inc/anowa`)

Used by `.github/workflows/convex-deploy.yml` (`ci.yml` needs none):

| Secret | Where | Value |
|---|---|---|
| `CONVEX_DEPLOY_KEY` | Environment `production` (required reviewers = owner, branch `main`) | Production deploy key from (a) 3 |
| `CONVEX_DEPLOY_KEY_STAGING` | Environment `staging` (optional) | Staging deploy key; when unset the staging job is skipped |

Settings → Environments → create `production` and `staging`, then add the secrets.
Until `CONVEX_DEPLOY_KEY` exists, the production deploy job fails on purpose.

## (d) Cloudflare DNS (`getanowa.com` zone)

Cloudflare → `getanowa.com` → DNS → Records:

| Type | Name | Target | Proxy |
|---|---|---|---|
| CNAME | `app` | the target Vercel shows (usually `cname.vercel-dns.com`) | DNS only (grey) |
| CNAME | `console` | same | DNS only (grey) |

DNS only lets Vercel issue certificates. Wait for both domains to show **Valid** in
Vercel. Then follow [platform-console-dns.md](platform-console-dns.md) checks
(console 404s tenant routes, app 404s `/platform/**`). If Turnstile is on, both
hostnames must be in `TURNSTILE_ALLOWED_HOSTNAMES` and in the Turnstile widget's
hostname list. Optional: redirect the old `pbafarm.vercel.app` to
`https://app.getanowa.com` once users have moved.

## (e) Bot webhooks (point them at the new deployment)

The webhook host is the new Convex HTTP origin (`https://<new deployment>.convex.site`):

- **WhatsApp** (Meta app → WhatsApp → Configuration → Webhook): callback URL
  `https://<new>.convex.site/channels/whatsapp`, verify token = `WHATSAPP_VERIFY_TOKEN`;
  subscribe to `messages`. Only one callback per app: switch it at cutover time.
  Update the WhatsApp Business profile name/picture to Anowa if desired.
- **Telegram**: `curl -sS "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook" -H 'content-type: application/json' -d '{"url":"https://<new>.convex.site/channels/telegram","secret_token":"<TELEGRAM_WEBHOOK_SECRET>"}'`.
  Rename the bot in @BotFather (`/setname`, `/setuserpic`) to Anowa.
- **IoT ingest Worker** (`workers/iot-ingest`, now named `anowa-iot-ingest`): set
  `CONVEX_SITE_URL` in `wrangler.toml` to the new `.convex.site`, create a new
  `ingest:write` API key in the new app, `wrangler secret put CONVEX_INGEST_KEY`,
  then deploy. The old `pbafarm-iot-ingest` Worker can be deleted afterwards.
- **Partner integrations** (outbound webhooks, inbound webhooks, REST API
  `/api/v1/*`): partners must change the base URL to the new `.convex.site`.
  Signing headers stay `X-PBA-*`, so receivers need no code change.

## (f) Data from the old pbafarm deployment — **decision for the owner**

Options (all from [backup-restore.md](backup-restore.md); snapshots contain every
tenant's personal data, keep them in the agreed encrypted location):

1. **Fresh start**: no import. Existing PBA Farm users re-register on Anowa.
   Simplest, loses history.
2. **One-shot snapshot move (recommended if history matters)**: announce a freeze,
   then
   `npx convex export --deployment <old pbafarm deployment> --include-file-storage --path backups/pbafarm-final.zip`
   (or `SOURCE_DEPLOYMENT=<old> DRY_RUN=0 scripts/ops/convex-backup.sh`, which also
   writes counts), then import into the new, empty production deployment with its
   deploy key: `CONVEX_DEPLOY_KEY=<new prod key> npx convex import --replace-all backups/pbafarm-final.zip`.
   Read the target name back before confirming, then compare counts with
   `scripts/ops/snapshot-counts.mjs`.
   Requires the same `INTEGRATIONS_ENCRYPTION_KEY`; reuse `JWT_PRIVATE_KEY`/`JWKS`
   to keep sessions. Document ids are preserved. Rehearse on staging first.
3. **Run both for a while**: keep the old deployment read-only and import later.
   Not recommended: writes made on the old app after the snapshot are lost.

Browser data is unaffected by the domain move only if the origin stays the same.
`app.getanowa.com` is a new origin, so each device starts with an empty offline
cache and outbox: **ask field staff to sync pending entries on the old URL before
switching.**

## Smoke test after cutover

- `https://app.getanowa.com` shows the Anowa landing page; sign in, daily entry saves.
- Password reset / verification email arrives from the Anowa sender; SMS code arrives.
- `https://console.getanowa.com/platform` works for a platform admin with MFA.
- WhatsApp and Telegram bots reply ("This is the Anowa assistant").
- PWA install shows the Anowa icon and name.
