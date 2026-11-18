# Cloudflare and hosting: recorded position and owner actions

> CF-001, CF-002, CF-007, CF-009, CF-010: **Documented — owner action
> required.** No Cloudflare, Vercel or DNS setting was changed. Sources and
> reasoning: `docs/architecture/14-…`, `15-…`, `17-…`; decisions D-014,
> D-015, D-016 (`docs/project-management/DECISION-LOG.md`).

## CF-001 — Position, Vercel plan, Next version

**Position (D-014, D-015):** Convex stays the system of record (data,
functions, auth, files). Cloudflare is adopted service by service only when a
recorded trigger fires (doc 17 §1). The frontend stays on Vercel (Pro).

| Check | Result | Owner action |
|---|---|---|
| D-014 / D-015 logged | ✅ in DECISION-LOG | — |
| Next ≥ 15.5.29 (OpenNext floor, CVE line) | ✅ `package.json` pins `next` 15.5.29 on `main` | Keep within 15.5.x patches (OPS-003) |
| Vercel plan | ❓ unknown | Vercel → Team → Settings → Billing. If **Hobby**: upgrade to **Pro** (Hobby is personal/non-commercial only). Record plan + date in the table below. |

| Vercel plan | Checked on | By |
|---|---|---|
| _TBD_ | _TBD_ | _TBD_ |

## CF-002 — Production DNS on Cloudflare (DNS-only)

Do this when the production domain is chosen/moved (OPS-001 cutover or
SEC-005 email). Steps:

1. Cloudflare dashboard → Add a domain → `<domain>` → Free plan. Cloudflare
   imports existing records; compare them with the current DNS provider's
   zone export and save that export in the password manager / `docs/ops/`
   (no secrets in it).
2. Lower TTLs at the current provider to 300 s a day before.
3. Records for Vercel: `A @ 76.76.21.21` and/or `CNAME www cname.vercel-dns.com`
   (use the exact values Vercel shows under Project → Domains). **Proxy
   status: DNS only (grey cloud).** Vercel requires this; proxying breaks
   its certificates and caching.
4. Email: add SPF, DKIM (from the email provider chosen in SEC-005/INT-002)
   and `_dmarc` (`v=DMARC1; p=none; rua=mailto:<owner>`), all DNS only.
5. Convex custom domains (Pro only, optional): CNAMEs as Convex shows them,
   DNS only at this stage.
6. QR label host (doc 13 Q4) must resolve to the same URL as before.
7. At the registrar, change nameservers to the two Cloudflare gives. Wait
   for "Active". Turn on DNSSEC (Cloudflare → DNS → Settings) and add the DS
   record at the registrar.
8. Verify: app loads with a valid certificate, email auth passes
   (mail-tester), QR URLs open. Raise TTLs back.
9. Rollback: set the old nameservers at the registrar (old zone kept).

## CF-007 — Cloudflare Access on the staging frontend

Trigger fired: OPS-004 loads staging with a copy of **real** data.
Prerequisite: the zone is on Cloudflare (CF-002) and staging has a hostname
in it (e.g. `staging.<domain>` → Vercel preview domain, DNS only).

1. Cloudflare → Zero Trust → (create the team, Free up to 50 users).
2. Settings → Authentication → add One-time PIN (email) and/or Google.
3. Access → Applications → Add → Self-hosted: domain `staging.<domain>`,
   session 24 h.
4. Policy "Staff": Action Allow, Include = Emails (named people) or Emails
   ending in `@<company domain>`. Nothing else is allowed (deny by default).
5. Test from a private window: an unlisted email is refused; a listed email
   gets a PIN and reaches the app login.
6. Rollback: delete the application.

Limit (documented in doc 14 §2.9): Access protects the **frontend hostname
only**. The staging Convex deployment (`*.convex.cloud`) stays reachable
directly; its data is protected by the app's own sign-in and tenant checks,
exactly like production. Doc 17 Stage 5 assumed synthetic staging data;
OPS-004 deliberately uses a live copy, so: limit staging Convex team access
to people who may see production, never share staging deploy keys, and
reset staging (or wipe it) when a rehearsal ends if the owner prefers.
If no Cloudflare zone yet: use Vercel Deployment Protection on Preview
(Project → Settings → Deployment Protection; plan-dependent).

## CF-009 — WAF in front of Convex: evaluation

**Decision: not now (revisit at enterprise scale, doc 14 §2.8).** The attack
surface is Convex (`*.convex.cloud` / `*.convex.site`); a WAF only helps if
Convex is reached through **proxied custom domains** (Convex Pro) with the
default hostnames disabled by Convex support. That changes the auth issuer,
`CONVEX_SITE_URL` and client URLs and needs a WebSocket soak on staging.
Meanwhile: rate limiting inside Convex, Turnstile on public forms (CF-003),
Vercel's built-in DDoS/WAF for the frontend.

Triggers to start it: an enterprise customer's security review requires a
WAF on all endpoints, or an abuse/volumetric incident against Convex.
Steps when triggered: doc 17 Stage 7 (custom domains → proxied → Pro/Business
managed rules → per-IP rate rules → Bot Fight Mode off for API/ingest hosts →
staging soak → ask Convex to disable default hostnames).

## CF-010 — Hosting re-evaluation

**Decision: stay on Vercel Pro (D-015).** Re-run doc 14 §3 only when one of:
Vercel cost for this app > ~$100/month; a data-residency requirement applies
to the frontend host; the owner standardizes products on Cloudflare.
Readiness already met: Next 15.5.29 (OpenNext floor). Still open before any
move: LLM API routes moved into Convex (INT-009), `getServerSideProps`
redirect stubs replaced by host redirects.

Owner action: check Vercel usage monthly (Usage tab) and record it below.

| Month | Vercel cost | Trigger fired? |
|---|---|---|
| _TBD_ | _TBD_ | _TBD_ |
