# Architecture 18 — Messaging channels, phone sign-in and two-step verification

Status: implemented in two PRs. INT-001 (messaging channels) ships first and is safe on its own; SEC-006 (phone sign-in) and SEC-007 (two-step verification) build on it. Decision D-018. Refines D-009 (doc 09 §3–5) for the first slice of integrations and D-017 (rate limiting). Supersedes the "MFA = TOTP in ENT" row of doc 10 §3 for SMS/WhatsApp codes; TOTP stays a later option.

## 1. Owner requirements

1. Each company chooses its own messaging providers (SMS, WhatsApp, email) in Settings.
2. The platform can offer a default channel that companies use until they add their own.
3. Staff can sign in with a one-time code sent to their phone, no password.
4. A company can require two-step verification (2FA) by SMS or WhatsApp, once that channel works.

## 2. Channels and providers

| Channel | Providers (adapter id) | Notes |
|---|---|---|
| SMS | Hubtel (`hubtel`), Africa's Talking (`africastalking`), Twilio (`twilio`) | Hubtel and Africa's Talking for Ghana and the region; Twilio elsewhere |
| WhatsApp | Meta WhatsApp Cloud API (`whatsapp_cloud`), Twilio WhatsApp (`twilio_whatsapp`) | Business-initiated messages need an approved template outside the 24-hour window, so codes go through an authentication template |
| Email | Resend (`resend`) | HTTPS API; the Convex runtime has no SMTP sockets |

One channel row per company and channel kind (`messagingChannels`, index `by_company_and_channel`). Status:

- `draft`: saved, not proven. Any change to provider, sender or settings, and any credential change, returns the channel to `draft`.
- `verified`: a test message was accepted by the provider. Only verified channels send sign-in codes.
- `disabled`: kept with its credentials, not used.

Adapters live in `convex/messaging/providers/*.ts` behind one interface:

```ts
send({ to, body, channel, subject?, otpCode? }, credentials, { senderId, settings }, fetch?)
  → { ok: true, providerMessageId? } | { ok: false, error, retryable }
```

`to` is E.164 for phones. Each adapter cites the official API page it was checked against (2026-11-18) and declares its credential fields (secret) and setting fields (not secret), which drive the settings form. Adapters never throw for provider failures and never include credentials in error text.

Request shapes (from the cited docs):

| Provider | Request |
|---|---|
| Hubtel | `POST https://sms.hubtel.com/v1/messages/send` (or `smsc.hubtel.com`), Basic `clientId:clientSecret`, JSON `{From, To, Content}`, number without `+`; a 201 with `status ≠ 0` is a failure |
| Africa's Talking | `POST https://api.africastalking.com/version1/messaging` (sandbox host for username `sandbox`), header `apiKey`, form `username,to,message,from`; per-recipient `statusCode` 100–102 = accepted. The docs site refused automated fetches, so this was checked against the official SDK; re-check before go-live |
| Twilio SMS / WhatsApp | `POST https://api.twilio.com/2010-04-01/Accounts/{sid}/Messages.json`, Basic `sid:token`, form `To, From | MessagingServiceSid, Body | ContentSid + ContentVariables`; WhatsApp addresses prefixed `whatsapp:` |
| WhatsApp Cloud | `POST https://graph.facebook.com/v27.0/{phoneNumberId}/messages`, Bearer token, `type: template` with the code as body parameter and as the copy-code button parameter |
| Resend | `POST https://api.resend.com/emails`, Bearer key, JSON `{from,to,subject,text}`, explicit `User-Agent` |

## 3. Credential custody

| Concern | Design |
|---|---|
| Storage | `integrationSecrets` (companyId, channelId, ciphertext, iv, keyVersion). Separate table so no public query can return it by accident |
| Algorithm | AES-256-GCM via Web Crypto, 12-byte random IV per encryption, AAD `companyId:channelId` so a ciphertext moved to another row fails to decrypt |
| Key | Convex env `INTEGRATIONS_ENCRYPTION_KEY`, base64 of 32 random bytes (`openssl rand -base64 32`). Different per deployment |
| Missing key | Saving credentials is refused with a clear message; the settings page shows a banner; channels, preferences and everything else keep working |
| Write path | Public action `messaging.channels.saveCredentials` → authorizes through an internal query (caller identity propagates) → encrypts in the action → internal mutation `storeCredentials` re-checks the caller and writes. The plaintext is never written to a table, log or audit row |
| Read path | Only internal functions (`prepareTest`, `deliver.resolveRoute`) read the ciphertext, and only actions decrypt it, in memory |
| UI | Write-only password fields; the card shows "Configured · ends in 4F2a" from a non-secret `credentialHint` stored on the channel row |
| Rotation | `keyVersion` is 1. To rotate: add the next key under a new variable, re-encrypt rows in an internal batch job, then remove the old key (runbook item for INT-002) |
| Tests | A meta-test asserts only `messaging/channels.ts` and `messaging/deliver.ts` reference the table and that the functions returning secret material are internal; behaviour tests check no public result contains the secret, ciphertext or IV |

## 4. Settings

Admin-only page `/messaging-settings`, linked from Company settings and the sidebar. Per channel: provider, sender, provider settings, credentials (write-only), "Send test" (marks the channel verified on success), Disable, Remove. A defaults card sets the country used to read local numbers (`companies.settings.defaultCountryCode`, default `GH`) and whether to fall back to the platform channels (`companies.settings.messaging.usePlatformDefault*`, default on). `publishSettings` preserves these fields.

Every change is audited (`messaging_channel_create/update/disable/remove`, `messaging_credentials_set`, `messaging_channel_test`, `messaging_preferences_update`); audit rows hold provider, sender and outcome, never credentials. Test recipients are stored masked.

## 5. Phone numbers

Stored and sent in E.164. `normalizePhone(raw, country)` accepts `+233…`, `00233…`, `0244…` (trunk zero dropped) and bare national numbers, using the company's default country. Supported countries are listed in `convex/lib/phone.ts`.

## 6. Platform default

If the deployment sets a platform channel, companies without their own verified channel use it (unless they opt out):

```
PLATFORM_SMS_PROVIDER=hubtel            # or africastalking | twilio
PLATFORM_SMS_SENDER=PBAFarm
PLATFORM_HUBTEL_CLIENT_ID=…
PLATFORM_HUBTEL_CLIENT_SECRET=…
# Africa's Talking: PLATFORM_AT_USERNAME, PLATFORM_AT_API_KEY
# Twilio:           PLATFORM_TWILIO_ACCOUNT_SID, PLATFORM_TWILIO_AUTH_TOKEN (+ PLATFORM_TWILIO_MESSAGING_SERVICE_SID)
PLATFORM_WHATSAPP_PROVIDER=whatsapp_cloud   # optional; or twilio_whatsapp (+ PLATFORM_TWILIO_CONTENT_SID)
PLATFORM_META_ACCESS_TOKEN=…  PLATFORM_META_PHONE_NUMBER_ID=…  PLATFORM_META_OTP_TEMPLATE=…  PLATFORM_META_TEMPLATE_LANG=en_US
PLATFORM_EMAIL_PROVIDER=resend  PLATFORM_EMAIL_SENDER="PBA Farm <no-reply@…>"  PLATFORM_RESEND_API_KEY=…
```

The rule is `PLATFORM_<CHANNEL>_PROVIDER`, `PLATFORM_<CHANNEL>_SENDER`, and `PLATFORM_<FIELD>` for each adapter field. An incomplete configuration counts as absent. Platform credentials stay in the environment and are never stored in tables.

Routing (`messaging/deliver.ts`): verified company channel → platform default (if available and not opted out) → none.

## 7. Phone sign-in (SEC-006)

Flow: the login page's "Phone" tab asks for the number, then the code.

1. `signIn('phone-otp', { flow: 'send', phone })`. The server normalizes the number and always answers the same way ("If this number is registered, a code is on its way"). It sends a code only when all hold: a user has that phone and confirmed it themselves (`users.phoneVerificationTime`, see below), is active, belongs to an approved company that allows phone sign-in, the company's policy offers phone sign-in (see §8), a channel resolves (company verified channel or platform default), and the rate limits allow it. The send is scheduled from the mutation that stores the code, so the response time does not depend on whether a code was sent.
2. `signIn('phone-otp', { flow: 'verify', phone, code })`. Six digits, valid 10 minutes, single use, at most 5 wrong tries per code; the code row is deleted on success, after 5 failures and when replaced.

Implementation choice: the provider is a Convex Auth `ConvexCredentials` provider with id `phone-otp`, not the library's `Phone` provider. In `@convex-dev/auth` 0.0.94 the `Phone` provider creates (or links) a user and an `authAccounts` row *before* sending the code (`createVerificationCode` → `upsertUserAndAccount`). For an unknown number that either creates a user or, if refused in `createOrUpdateUser`, returns an error the client can tell apart: both break the requirements (never create users, never reveal which numbers exist). With `ConvexCredentials` the `authorize` step looks up an existing user and returns only that user's id, so phone sign-in can never create a user, and the answer for unknown numbers is identical. Codes are generated and hashed (SHA-256 over purpose, phone or session, and code) in actions, so queries and mutations need neither randomness nor Web Crypto; `phoneLoginCodes` and `mfaSessions` hold only hashes. The plaintext exists only in the action and the scheduled send's arguments.

Confirmed numbers only (audit A, 2026-11-19). A phone is an account-wide sign-in identifier, so a number someone else typed in must not sign in. `users.phoneVerificationTime` is set only by a code entered in the user's own session: phone enrolment and verification at `/verify` (§8), or `mfa.startPhoneConfirmation` / `mfa.confirmPhone` from the "Confirm your phone number" card on `/account` (codes in `phoneConfirmCodes`, hashed and bound to the session). An admin setting or changing a number (`users.setPhone`, `users.update`) clears it and drops pending codes for the account. Phone sign-in itself no longer sets it. Admins also cannot change the number of someone who belongs to another organization (FORBIDDEN); people change their own, and super_admins are exempt. Existing data: numbers admins entered before this change have no `phoneVerificationTime` and stop working for phone sign-in until their owner confirms them once (they sign in with email and password, which every account has). Numbers already used for phone sign-in or verified at `/verify` keep it.

Company settings (`companies.settings.security`): `allowPhoneLogin` (default off) and `phoneLoginChannel` (`sms` | `whatsapp`, default `sms`). Enabling requires that channel to resolve.

## 8. Two-step verification (SEC-007)

Company settings: `require2fa` (default off), `twoFactorChannel` (`sms` | `whatsapp`), `phoneLoginSatisfies2fa` (default off). Enabling 2FA is refused unless the chosen channel resolves for the company (a verified company channel or the platform default) and the admin enabling it has a phone number.

The admin who turns 2FA on keeps the session they did it from (recorded as `method: 'policy_enable'`), so they can switch it off again if codes do not arrive; every other session, including their next sign-in, must verify. Enforcement is per session: table `mfaSessions` (userId, sessionId, codeHash, channel, purpose, pendingPhone, expiresAt, attempts, lastSentAt, verifiedAt, method). When the user's company requires 2FA and the current session has no verified row, `requireUser` throws `MFA_REQUIRED: …` (the authErrors prefix pattern). Exempt: `users.current` (exposes `mfaRequired`, `mfaPolicy`, `hasPhone`, `maskedPhone`, `mfaChannels`), the 2FA start/verify functions, phone enrolment, and sign-out (library function). Super-admins always verify, with or without a company and whatever their company's policy (audit B, 2026-11-19): one without an authenticator app is sent to `/verify`, which opens authenticator-app enrolment when no phone channel applies; enrolling verifies that session. `mfaPolicy` in `users.current` is true whenever the session must verify (company policy, an authenticator app, or super_admin).

Client: AuthWrapper sends a session with `mfaRequired` to `/verify`. With a phone: choose channel, send code, enter code, resend after a 30-second cooldown. Without a phone: enter a number, receive a code on it, and on success the number is saved (normalized, audited) and the session is verified.

A verified session row records the organization whose policy accepted it (`mfaSessions.companyId`; absent for a company-less account such as a platform super_admin, where only codes from the user's own app or phone count). After `memberships.switchActive`, `requireUser` re-checks it against the new active organization (`mfaRowCountsFor` in `convex/lib/authz.ts`): codes from the user's own phone or authenticator app count anywhere; a phone sign-in counts only where that organization also offers phone sign-in as the second step; `policy_enable` counts only in its own organization. Otherwise the session verifies again for the new organization, and the new row replaces the old one.

Phone sign-in sessions count as verified only when `phoneLoginSatisfies2fa` is true. When 2FA is required and that flag is false, phone sign-in is not offered (no code is sent), because the "second" factor would be the same phone.

Offline (MOBILE-001): the cached user snapshot records whether the company requires 2FA and which session verified it; a session that is not that verified session never starts offline, and an unverified session's snapshot is removed.

Recovery: if a company's only 2FA channel breaks, admins cannot change the channel while 2FA depends on it (the server refuses to disable, remove or reconfigure a channel the policy relies on). The platform operator can clear the policy with `npx convex run security:clearPolicyForCompany '{"companyId":"…"}'` (internal, audited).

## 9. Threat model

| Threat | Control |
|---|---|
| Enumerating staff phone numbers through sign-in | Identical response and timing for known and unknown numbers; sends scheduled; per-number and global limits |
| Brute-forcing a code | 6 digits, 10 minutes, 5 tries per code, codes replaced on resend, sends limited per number |
| SMS pumping / cost abuse (sending to premium or many numbers) | Codes only go to numbers already registered by an admin; per-number, per-company and global send limits; test sends limited per company |
| Stolen session token bypassing 2FA | 2FA state is per session; a new session starts unverified |
| SIM swap / SS7 interception | Accepted residual risk of SMS; WhatsApp is end-to-end encrypted; TOTP/passkeys remain the stronger later option |
| Admin of company A reading or overwriting B's credentials | Every function derives the company from the caller; foreign channel ids answer "not found"; AAD binds ciphertext to the row |
| Credential leak through API, logs, audit, dashboard | Separate table; write-only UI; only hints shown; ciphertext at rest; key only in env; audit stores outcomes only |
| Phone takeover by an admin | Phone changes are admin-only, audited, and unique across accounts; an admin-set number does not sign in until its owner confirms it; admins cannot change the number of a member of another organization; a session verified under one organization's policy is re-checked after switching organization |
| Shared phone (offline shell) | Unverified sessions never render offline |

## 10. Rate limits (`@convex-dev/rate-limiter`, `convex/lib/rateLimits.ts`)

| Limit | Key | Value |
|---|---|---|
| Test messages | company | 10 per hour |
| Sign-in code sends | phone number | 3 per 15 minutes, 10 per day |
| Sign-in code sends | company | 100 per hour |
| Sign-in code sends | global | 500 per hour |
| 2FA / enrolment code sends | user | 5 per 15 minutes, plus 30-second resend cooldown |
| Wrong codes | per code | 5, then the code is void |

## 11. Failure modes

| Failure | Behaviour |
|---|---|
| Encryption key missing | Credentials cannot be saved; sends from company channels fail with "credentials cannot be read"; platform default still works |
| Provider down or rejects | Test shows the provider's short error; sign-in shows the generic message (the code never arrives); 2FA start shows "Could not send the code" with the reason class |
| Channel disabled while policy relies on it | Refused by the server |
| Platform default env removed | Companies relying on it lose code delivery; documented in the deploy notes |
| Rate limited | Clear "try again in N minutes" for admins and signed-in users; generic response on the sign-in page |

## 12. Costs

Each code is one paid message. Indicative prices (check the provider): Ghana SMS through Hubtel or Africa's Talking about GHS 0.03–0.05 per message; Twilio SMS to Ghana several times that; WhatsApp authentication conversations are billed per template message by Meta at a per-country rate. With 2FA required on every new session (30-day sessions), a 20-person farm sends on the order of 20–60 codes a month. The platform default is paid by the platform operator; company channels by the company.

## 13. Deferred

- Delivery status webhooks (doc 09 §6) and a `messageDeliveries` log with retries (INT-002).
- Alerts and notifications over SMS/WhatsApp/email (AUTO-003).
- Key rotation job; per-company monthly budget caps.
- TOTP or passkeys as a second factor; remembered devices.
