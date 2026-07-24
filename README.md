# Fish Farm App (PBA Farm)

Next.js Pages Router ops app on **Convex + Convex Auth**, with the **Tide Chart** UI theme.

Supabase has been fully removed.

## Local development

```bash
npm install
npm run dev:backend   # terminal 1 — Convex local backend
npm run dev           # terminal 2 — Next.js on http://localhost:3000
```

### Env (`.env.local`)

```bash
NEXT_PUBLIC_CONVEX_URL=http://127.0.0.1:3210
NEXT_PUBLIC_CONVEX_SITE_URL=http://127.0.0.1:3211
NEXT_PUBLIC_APP_NAME=Fish Farm Management
```

### First user / admin

1. Sign up at `/signup`
2. Promote yourself:

```bash
npx convex run users:promoteToSuperAdmin '{"email":"you@example.com"}'
```

3. Optional demo cages:

```bash
npx convex run seed:seedDemo
```

### Auth JWT secrets (new Convex cloud project)

```bash
node generateKeys.mjs
npx convex env set JWT_PRIVATE_KEY -- "<key>"
npx convex env set JWKS '<jwks json>'
npx convex env set SITE_URL http://localhost:3000
```

## Deploy (Vercel)

1. `npx convex deploy` (production)
2. Set `NEXT_PUBLIC_CONVEX_URL` and `NEXT_PUBLIC_CONVEX_SITE_URL` on Vercel to the production deployment
3. Set JWT / JWKS / SITE_URL on the Convex production deployment

## Migration plan

See `docs/plans/2026-07-24-convex-migration-and-ui-theme.md`.
