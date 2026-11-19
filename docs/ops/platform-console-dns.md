# Platform console: domain, DNS and first run

Runbook for PLAT-101..113 (architecture: `docs/architecture/22-platform-console-billing.md`).

The platform console is the same Next.js deployment as the tenant app, served on its own hostname, `console.heitechinc.com`. `middleware.js` limits that host to `/platform/**`, sign-in pages and static files, and returns 404 for `/platform/**` on every other host. **The hostname is not the security boundary:** every console query and mutation requires a platform admin (`super_admin`) with a verified two-step session (`convex/platform/access.ts`).

## 1. DNS (Cloudflare, owner)

1. Cloudflare dashboard → `heitechinc.com` → DNS → Records → **Add record**.
2. Type `CNAME`, Name `console`, Target `cname.vercel-dns.com`, Proxy status **DNS only** (grey cloud), TTL Auto.
3. Save. Vercel issues the TLS certificate itself; a proxied (orange) record breaks certificate issuance and adds a second TLS hop.

## 2. Vercel (owner)

1. Vercel → the pbafarm project → Settings → **Domains** → Add `console.heitechinc.com` (production branch `main`).
2. Wait for "Valid Configuration". If Vercel shows a different CNAME target for this project, use the one it shows in step 1.2.
3. Settings → **Environment Variables** (Production, and Preview if you want previews to have a console):
   - `NEXT_PUBLIC_PLATFORM_CONSOLE_HOST=console.heitechinc.com` (comma-separate more hosts; add a preview host if needed).
   - `NEXT_PUBLIC_TENANT_APP_URL=https://<tenant app host>`: optional, opened after "Read-only act-as".
4. Redeploy: `NEXT_PUBLIC_*` values are baked in at build time.

## 3. Convex deployment env (owner or engineer)

```sh
npx convex env set BILLING_GRACE_DAYS 7
npx convex env set BILLING_PAYMENT_INSTRUCTIONS "Pay by MoMo to 024XXXXXXX or bank transfer to … quoting the invoice number."
```

If Turnstile is on (`TURNSTILE_ALLOWED_HOSTNAMES` set), add `console.heitechinc.com` to that list, or sign-in on the console fails the human check. SSO (OIDC) redirects to `SITE_URL`, the tenant app: platform admins sign in to the console with email + password and their authenticator app.

## 4. Platform admins

- Platform admins are users with role `super_admin`. They must set up an authenticator app (`/account`) and pass `/verify` on each session; the console refuses an unverified session (`MFA_REQUIRED`).
- Add or remove admins in the console under **Platform admins**. The last active admin cannot be removed, and nobody can remove themselves.

## 5. Billing first run

1. In the console → **Billing → Plans**, press **Create default plans** (Starter, Growth, Enterprise), then edit their prices. The seeded prices are placeholders.
2. Give existing organizations a subscription. Dry run first; it reports what it would do:
   ```sh
   npx convex run billing/lifecycle:backfillSubscriptions '{}'
   npx convex run billing/lifecycle:backfillSubscriptions '{"dryRun": false}'
   ```
   Default: every approved organization without a subscription gets the default plan as `active` for one period. Pass `"status": "trialing"` to start trials instead, or `"planCode": "growth"` for another plan. It is idempotent: organizations that already have a subscription are skipped.
3. From now on, newly approved organizations start a trial on the default plan automatically.

## 6. What runs daily

| Cron (UTC) | Function | Effect |
|---|---|---|
| 00:40 | `platform/usage:rollupYesterday` | One `platformUsageDaily` row per organization: records, active users, SMS/WhatsApp/email, AI calls/tokens/cost. |
| 05:00 | `billing/lifecycle:runDaily` | Trial or paid period ended unpaid → `past_due`, renewal invoice due in `BILLING_GRACE_DAYS`, owners notified. Grace over → subscription `suspended` and the organization suspended (members see `/suspended`; owners keep `/billing`). |

A payment that settles a renewal invoice in full renews the period and lifts a **billing** suspension. A suspension made by a platform admin is lifted only by **Reactivate**.

## 7. Checks after go-live

- `https://console.heitechinc.com/dashboard` redirects to `/platform`.
- `https://<tenant host>/platform` returns 404.
- A tenant admin signing in on the console sees "This console is for platform administrators" and every console call returns `FORBIDDEN`.
- Security headers (CSP, `X-Frame-Options: DENY`) are present on console responses (`curl -sI https://console.heitechinc.com/platform`).
