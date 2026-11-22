# Rupees

Mobile-first personal investment tracker (**PWA**) for Brazilian equities & REITs (B3), US stocks & REITs, Fixed Income, and Emergency Reserve — with automated Yahoo Finance quotes, **Google SSO**, optional **App Lock** (biometrics/PIN), and a smart **Contribution Planner**.

## Tech Stack

- **Framework:** Next.js 16 (App Router, TypeScript, Turbopack), React 19, Tailwind CSS v4, Recharts
- **Database:** Neon PostgreSQL + Prisma ORM (versioned Prisma Migrations)
- **Authentication & Security:** Auth.js v5 (Google OAuth 2.0 + email allowlist) + optional App Lock (6-digit PIN & WebAuthn biometrics)
- **Market Data:** `yahoo-finance2` (B3 `.SA`, US tickers, and `USDBRL=X`) with 15-minute PostgreSQL cache and fallback
- **Testing & CI:** Vitest (domain + API security tests), Playwright (mobile PWA E2E smoke suite), GitHub Actions
- **Hosting:** Vercel (continuous deployment from `master`)

## Local Setup

1. Install dependencies:

```bash
pnpm install
```

2. Copy the environment variables template:

```bash
cp .env.example .env
```

3. Fill in `.env`:
   - `DATABASE_URL`: PostgreSQL connection string from your [Neon](https://neon.tech) project.
   - `AUTH_SECRET`: generate with `openssl rand -base64 32`.
   - `AUTH_GOOGLE_ID` and `AUTH_GOOGLE_SECRET`: create an OAuth Client ID (*Web application*) in [Google Cloud Console](https://console.cloud.google.com/apis/credentials) with the redirect URIs:
     - Local: `http://localhost:3000/api/auth/callback/google`
     - Production: `https://your-app.vercel.app/api/auth/callback/google`
   - `ALLOWED_EMAILS`: comma-separated list of authorized Google account emails (e.g., `you@example.com`).

4. Apply Prisma migrations to PostgreSQL:

```bash
pnpm db:migrate
```

5. *(Optional)* Import data from exported Google Sheets CSVs (`ativos.csv` and `aportes.csv` in a local folder):

```bash
pnpm db:import --email you@example.com --dir ./path/to/csvs
```

6. Start the development server:

```bash
pnpm dev
```

## Deploying to Vercel

1. Connect the `erykwho/rupees` repository in [Vercel](https://vercel.com).
2. Configure the same environment variables from `.env` in your Vercel project settings.
3. In Google Cloud Console, add `https://<your-domain>.vercel.app/api/auth/callback/google` under **Authorized redirect URIs**.
4. Production builds automatically run `prisma migrate deploy` via `scripts/vercel-db-sync.mjs` when `VERCEL_ENV=production`.
5. After deploying, open the app on your phone and tap **"Add to Home Screen"** (iOS/Android) to install it as a PWA.

## Useful Scripts

- `pnpm dev` — start the local development server
- `pnpm build` — generate Prisma Client, run production DB migration sync (when `VERCEL_ENV=production`), and build Next.js
- `pnpm test` — run unit and API security tests (Vitest)
- `pnpm test:e2e` — run mobile PWA E2E smoke tests (Playwright, requires `pnpm build` first)
- `pnpm lint` — run ESLint checks
- `pnpm db:migrate` — create and apply a new Prisma migration locally
- `pnpm db:migrate:deploy` — apply pending Prisma migrations in staging/production
- `pnpm db:import` — import portfolio data from exported Google Sheets CSVs
