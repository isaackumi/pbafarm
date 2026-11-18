# Fish Farm App (PBA Farm)

Next.js Pages Router ops app on **Convex + Convex Auth**, with the **Tide Chart** UI theme.

Supabase has been fully removed.

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

3. Optional demo cages:

```bash
npx convex run seed:seedDemo
```

### Phones on the same Wi-Fi

Run `npm run dev -- -H 0.0.0.0` and open `http://<your-mac-ip>:3000` on the phone.
The app installs to the home screen in production builds (`npm run build && npm start`);
the service worker is off in dev on purpose.

## Deploy

### Backend (Convex): automatic

`.github/workflows/convex-deploy.yml` runs `npx convex deploy` on every push to
`main` that touches `convex/`. It uses the `CONVEX_DEPLOY_KEY` repository secret
(Settings → Secrets and variables → Actions). The secret is currently a **dev** key
for `vibrant-stork-860`; replace it with a `prod:` key when production is ready.

Locally, `.env.local` holds the same dev key as `CONVEX_DEPLOY_KEY`, so
`npm run dev:backend` pushes every save to `vibrant-stork-860`. Generate keys in the
Convex dashboard under the deployment's Settings → Deploy keys.

### Frontend (Vercel)

1. Set `NEXT_PUBLIC_CONVEX_URL` (`https://<deployment>.convex.cloud`) and
   `NEXT_PUBLIC_CONVEX_SITE_URL` (`https://<deployment>.convex.site`) on Vercel.
2. Set JWT / JWKS / SITE_URL on the Convex deployment (`npx convex env set ...`).
## Migration plan

See `docs/plans/2026-07-24-convex-migration-and-ui-theme.md`.
