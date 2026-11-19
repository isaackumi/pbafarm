# Anowa

**Anowa** is the operating system for fish farms: stocking to harvest, feed to
finance, across every site and every team. Built by **Hei-Tech-Inc**.

- App: https://app.getanowa.com · Platform console: https://console.getanowa.com
- Website: https://getanowa.com (repo [`Hei-Tech-Inc/anowa-website`](https://github.com/Hei-Tech-Inc/anowa-website))
- Contact: hello@getanowa.com
- Repo: [`Hei-Tech-Inc/anowa`](https://github.com/Hei-Tech-Inc/anowa) (continues `isaackumi/pbafarm`)

Next.js (Pages Router) web app and PWA on **Convex + Convex Auth**, with offline
daily entry, multi-tenant organizations, a platform console, WhatsApp/Telegram
farm bot and an AI assistant. Brand assets (Anowa "Pulse" logo) live in
`public/brand/` and `components/brand/AnowaLogo.js`; the Paper design file is
documented in `docs/design/paper-redesign/`.

## Local development

Everything runs on your machine. No Convex account is needed.

```bash
npm install
npm run dev:backend   # terminal 1: Convex local backend on http://127.0.0.1:3210
npm run dev           # terminal 2: Next.js on http://localhost:3000
```

### First-time setup (once per machine)

1. Create the local backend and write `.env.local`:

   ```bash
   CONVEX_AGENT_MODE=anonymous npx convex dev --once
   ```

   This saves `CONVEX_DEPLOYMENT`, `NEXT_PUBLIC_CONVEX_URL` and
   `NEXT_PUBLIC_CONVEX_SITE_URL` to `.env.local`. After that, plain
   `npm run dev:backend` reuses it.

2. Give the backend its sign-in keys (these live on the Convex backend, not in `.env.local`):

   ```bash
   node generateKeys.mjs        # prints JWT_PRIVATE_KEY and JWKS
   npx convex env set JWT_PRIVATE_KEY -- "<key printed above, without quotes>"
   npx convex env set JWKS -- '<jwks json printed above>'
   npx convex env set SITE_URL http://localhost:3000
   ```

3. Optional: add an assistant key to `.env.local` (`GEMINI_API_KEY=...`). See `.env.example`.

### First user / admin

1. Sign up at http://localhost:3000/signup
2. Promote yourself (this function is internal, so only the CLI can run it):

```bash
npx convex run users:promoteToSuperAdmin '{"email":"you@example.com"}'
```

3. Optional demo data (dev deployments only). `seed:seedDemo` is internal, so only
   the CLI can run it; name a user whose company gets the demo cages, feed and
   records (the company must have no cages yet):

```bash
npx convex run seed:seedDemo '{"email":"you@example.com"}'
```

### Phones on the same Wi-Fi

Run `npm run dev -- -H 0.0.0.0` and open `http://<your-mac-ip>:3000` on the phone.
The app installs to the home screen in production builds (`npm run build && npm start`);
the service worker is off in dev on purpose.

## Deploy

### Backend (Convex): automatic

`.github/workflows/convex-deploy.yml` runs `npx convex deploy` on every push to
`main` that touches `convex/` (and to staging on `release/**`). It uses the
`CONVEX_DEPLOY_KEY` secret of the `production` environment (and
`CONVEX_DEPLOY_KEY_STAGING` for `staging`); in `Hei-Tech-Inc/anowa` these still
have to be added, see [`docs/ops/anowa-cutover.md`](docs/ops/anowa-cutover.md) §c.

Locally, `npm run dev:backend` pushes every save to the deployment in
`.env.local`. Generate deploy keys in the Convex dashboard under the deployment's
Settings → Deploy keys.

### Frontend (Vercel)

1. Set `NEXT_PUBLIC_CONVEX_URL` (`https://<deployment>.convex.cloud`) and
   `NEXT_PUBLIC_CONVEX_SITE_URL` (`https://<deployment>.convex.site`) on Vercel.
2. Set JWT / JWKS / SITE_URL (`https://app.getanowa.com`) on the Convex deployment
   (`npx convex env set ...`).

Moving production to the Hei-Tech-Inc accounts (new Convex project, Vercel project,
GitHub secrets, `app.`/`console.getanowa.com` DNS, bot webhooks, data):
[`docs/ops/anowa-cutover.md`](docs/ops/anowa-cutover.md).

## Docs

- Architecture: `docs/architecture/`
- Operations runbooks: `docs/ops/`
- Design (Paper redesign coverage and changelog): `docs/design/paper-redesign/`
- Project tracking: `docs/project-management/`
