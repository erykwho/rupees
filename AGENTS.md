# Rupees — Project Context, Invariants & Agent Instructions

Mobile-first personal investment tracker (**PWA**) for Brazilian equities & FIIs (B3), US stocks & REITs, Fixed Income, and Emergency Reserve — migrated from the **Rupees** Google Sheet and running in production with real financial data.

## Mandatory Language Rule

- **All documentation, commit messages, Pull Request titles/descriptions, and code comments MUST be written in English** — including `AGENTS.md`, `README.md`, `docs/*`, scripts/technical notes, commit messages, and PRs — regardless of the language used in the conversation with the user.
- **User-facing UI copy** remains in **Brazilian Portuguese (`pt-BR`)** for now (including page labels, validation/error messages shown to the user, and Error Boundaries).
- In conversation, reply in the language the user is speaking.

## Living Documentation Rule (Mandatory)

`AGENTS.md` is a **living specification** of Rupees' production invariants and business rules.
- Whenever a change introduces or modifies a **business rule**, **production invariant**, **Prisma schema model/migration rule**, **`localStorage` key/format**, or **API contract**, the agent MUST update the relevant section of `AGENTS.md` in the **same Pull Request**.
- Keep this file concise, declarative, and focused on current truth (not a verbose changelog). If it grows beyond ~250 lines, extract detailed domain specs into `docs/invariants.md` and link them here.
- Every critical invariant documented here should also be backed by an automated check (Vitest unit/API test, Prisma validation, ESLint, Playwright E2E, or GitHub Actions CI) whenever feasible.

## Production Invariants (Never Break)

1. **Strict Multi-Tenant Isolation & Zero IDOR:**
   - Every authenticated API route (`/api/assets/**`, `/api/transactions/**`, `/api/goals`, `/api/sector-goals/**`, `/api/portfolio`, `/api/evolution`, `/api/fixed-income`, `/api/contribution-plan`, `/api/events/**`, `/api/tickers/**`, `/api/security/**`) MUST validate the session (`requireUser()` or `requireAuthenticatedUserAllowLocked()` exclusively on unlock/status endpoints), return `401` when unauthenticated, validate inputs with Zod (`400`), and scope **every** read, update, delete, and cross-entity reference (e.g., `assetId` in `POST`/`PATCH /api/transactions`) by `userId`.
   - Only `/api/auth/**`, `/api/health`, `/login`, `/manifest.webmanifest`, `/icons/*`, and `/favicon.ico` are accessible without a valid Google session.
2. **Fail-Closed App Lock (`src/proxy.ts` + `src/lib/auth.ts`):**
   - When `appLockEnabled === true`, every page route redirects to `/unlock` and every protected API route returns `423` (`code: "APP_LOCKED"`) without a valid server-signed unlock cookie (`rupees_app_unlock`).
   - Only `/api/security/status`, `/api/security/unlock/pin`, and `/api/security/webauthn/auth/*` may use `requireAuthenticatedUserAllowLocked()`. Changing the PIN, updating timeout settings, or managing WebAuthn devices requires `requireUser()` (app unlocked).
   - Failed PIN attempts MUST enforce progressive rate-limiting/lockout (`429`).
3. **Zero-Downtime Database Migrations (Expand-and-Contract):**
   - Production database updates run exclusively via **Prisma Migrations** (`prisma migrate deploy` in `scripts/vercel-db-sync.mjs`, with one-time `P3005` baseline transition to `00000000000000_init`). **Never** re-enable `prisma db push` in production.
   - Never drop or rename an existing column, table, or enum value in a single deploy. Always use *expand-and-contract* (add nullable/default column first → deploy compatible app code → backfill/migrate → remove legacy column in a subsequent release) so 1-click Vercel rollbacks remain safe.
4. **Financial Integrity, Currencies & Emergency Reserve Separation:**
   - `EMERGENCY_RESERVE` (e.g., `SELIC`) MUST NEVER be included in total invested capital when computing `% Current`, `% Target`, or class rebalancing; it is displayed separately and added only in the **Total + Reserve** metric.
   - B3, Fixed Income, and Reserve assets are recorded in `BRL`; US assets (`US_STOCK`, `US_REIT`) are recorded in `USD` (average price in `USD`) and consolidated into `BRL` using the `USDBRL=X` exchange rate.
   - Fixed Income and Reserve operate with `priceMode = MANUAL` and `manualPrice = 1`; yield updates use `TransactionType.BALANCE_ADJUSTMENT` (which preserves positive/negative signs and forces `unitPrice = 1`).
5. **Transactional Audit Trail (`AuditEvent`):**
   - Every mutation on `ASSET`, `TRANSACTION`, `GOAL`, and `SECTOR_GOAL` (create, update, delete, revert) MUST atomically record its corresponding `AuditEvent` inside the same `prisma.$transaction`.
6. **Backward-Compatible Client Storage:**
   - `localStorage` readers (theme and privacy mode) MUST gracefully handle missing, corrupted, or legacy shapes with safe defaults — never throw on parse or when `window` is undefined.
7. **React 19 & Next.js 16 Guardrails:**
   - Use `src/proxy.ts` (Next.js 16 convention instead of `middleware.ts`).
   - Do not call `setState` synchronously inside a `useEffect` body; use `useSyncExternalStore`, `queueMicrotask`, or async callbacks.
   - Keep friendly `pt-BR` Error Boundaries (`src/app/error.tsx` and `src/app/global-error.tsx`) and `/api/health` (`Cache-Control: no-store`, with optional `?db=1` Neon connectivity check).

## Core Domain Business Rules

1. **Allocation Goal Hierarchy (`AllocationGoal`, `/api/goals`):**
   - `Fixed Income` + `Variable Income` = 100%
   - Within Variable Income: `Brazil` + `USA` = 100%
   - Within Brazil: `Stocks` + `FIIs` = 100%
   - Within USA: `Stocks` + `REITs` = 100%
   - Each asset's portfolio target `%` = `Class Target % * targetPctInClass`. Active assets within each investment class should sum to 100% (zero-quantity active assets are allowed).
2. **Sector Goals (`SectorGoal`, `/api/sector-goals`):**
   - Apply exclusively to Variable Income classes (`BR_STOCK`, `BR_FII`, `US_STOCK`, `US_REIT`).
   - Renaming a sector propagates the new name to the user's linked assets in the same transaction.
   - Deleting a sector with linked assets MUST be blocked with `409`, listing the affected tickers.
3. **Contribution Planner (`computeContributionPlan`, `/api/contribution-plan`):**
   - Prioritizes the most underweight classes and assets relative to targets while respecting ignored classes/tickers and `maxAssets`.
   - B3 (`BR_STOCK`, `BR_FII`): integer share quantities only (`FLOOR`).
   - USA (`US_STOCK`, `US_REIT`): fractional shares allowed with a minimum US\$ 5 contribution converted to BRL.
   - Fixed Income: any BRL amount.
4. **Ticker Validation & Market Quotes (`src/lib/quotes.ts`, `src/lib/ticker-validator.ts`):**
   - Quotes via `yahoo-finance2` covering B3 (`.SA` suffix), US tickers, and `USDBRL=X`, with a 15-minute `QuoteCache` and fallback to the last valid quote.
   - Variable Income assets are validated on Yahoo when creating or changing ticker/class (`422 INVALID_TICKER` when invalid; `503 YAHOO_UNAVAILABLE` when unavailable, unless `allowUnverifiedOnUnavailable: true` is passed to save as `PENDING`).
5. **Portfolio Evolution, Fixed Income & Long-Term Projections (`src/lib/domain/evolution.ts`, `fixed-income.ts`, `long-term-projection.ts`):**
   - Historical series reconstructs equity value, invested capital, nominal gain, and weighted return backed by `HistoricalQuoteCache` / `HistoricalQuoteSync`.
   - Fixed Income projection computes projected yields using benchmarks (CDI, Selic, IPCA, Prefixed) and tax rules (`taxExempt` vs progressive IR).
   - Long-term projection models monthly contributions, real/nominal returns, and inflation.
6. **Security, App Lock & Privacy Mode (`src/lib/domain/security.ts`, `src/lib/app-lock.ts`, `src/lib/privacy.ts`):**
   - Authentication via Auth.js v5 (`next-auth@beta`, JWT) with Google OAuth 2.0 + `ALLOWED_EMAILS` allowlist.
   - Optional App Lock with 6-digit PIN (salted scrypt hash) and WebAuthn biometrics (`@simplewebauthn/server`), sliding inactivity window, and temporary lockout after consecutive failures.

## Stack & Infrastructure

- **Framework:** Next.js 16 (App Router, TypeScript, Turbopack), React 19, Tailwind CSS v4, Recharts, Lucide icons, Zod.
- **Package Manager:** `pnpm` (v12, with `pnpm-workspace.yaml` enabling `allowBuilds` for Prisma/esbuild).
- **Database:** Neon PostgreSQL + Prisma v6 (`prisma/schema.prisma`, versioned `prisma/migrations/`, synced automatically via `prisma migrate deploy` in `scripts/vercel-db-sync.mjs` when `VERCEL_ENV=production`).
- **CI/CD & Hosting:** GitHub Actions (`.github/workflows/ci.yml` running `prisma validate`, `pnpm test`, `pnpm lint`, `pnpm build`, and `pnpm test:e2e`) + Vercel (`https://rupees-two.vercel.app`, continuous deployment from `master`).

## Directory Structure

- `.github/workflows/ci.yml` — GitHub Actions CI pipeline (Prisma validate, Vitest, ESLint, Next.js build, and Playwright E2E).
- `e2e/smoke.spec.ts` & `playwright.config.ts` — Mobile PWA Playwright E2E smoke tests (`/api/health`, `/login` redirects, fail-closed `401` APIs, theme persistence, and PWA manifest).
- `prisma/schema.prisma` & `prisma/migrations/` — Data models (`User`, `AllocationGoal`, `SectorGoal`, `Asset`, `Transaction`, `QuoteCache`, `HistoricalQuoteCache`, `HistoricalQuoteSync`, `AuditEvent`, `WebAuthnCredential`, `SecurityChallenge`) and versioned SQL migrations.
- `prisma/import-sheets.ts`, `fix-event-dates.ts`, `cleanup-mar2025-reversals.ts` — Idempotent import and data maintenance scripts.
- `scripts/vercel-db-sync.mjs` — Production-only `prisma migrate deploy` runner (with one-time `P3005` baseline and no `db push` fallback).
- `src/lib/domain/` — Pure domain engines and Vitest suites (`calculations`, `evolution`, `fixed-income`, `long-term-projection`, `audit`, `security`, `ticker-validation`, `chart-zoom`, `event-date-sync`, `reversal-cleanup`, `types`).
- `src/lib/` — Loaders and services (`portfolio-loader`, `evolution-loader`, `fixed-income-loader`, `quotes`, `historical-quotes`, `fixed-income-rates`, `audit-service`, `app-lock`, `app-lock-token`, `webauthn`, `privacy`, `pull-to-refresh`, `auth`, `prisma`).
- `src/app/(dashboard)/` — Authenticated pages: `/` (Overview), `/carteira` (Portfolio), `/lancamentos` (Transactions), `/aporte` (Contribution Planner), `/objetivos` (Goals), `/evolucao` (Evolution), `/eventos` (Audit Events), `/seguranca` (Security).
- `src/app/api/` — Protected REST routes + `/api/health` + security/contract Vitest suites (`routes.test.ts`, `route.test.ts`).
- `src/app/error.tsx` & `src/app/global-error.tsx` — `pt-BR` Error Boundaries.

## Commands & Conventions

- `pnpm test` — Run unit and API security/contract tests (Vitest). Always add or update tests when changing `src/lib/domain/` or `src/app/api/`.
- `pnpm test:e2e` — Run mobile PWA E2E smoke tests (Playwright) against the production Next.js server (`pnpm build` first).
- `pnpm lint` — Run ESLint checks.
- `pnpm build` — Run `prisma generate && node scripts/vercel-db-sync.mjs && next build`.
- `pnpm db:migrate` — Create and apply a new Prisma migration locally (`prisma migrate dev`). Always commit generated files under `prisma/migrations/`.
- `pnpm db:migrate:deploy` — Apply pending migrations in staging/production environments.
- `pnpm db:fix-event-dates` — Idempotent script (`prisma/fix-event-dates.ts`) with `--dry-run` default and `--apply`, accepting `--csv` (Aportes tab) and/or `--bootstrap` (initial `GOAL` and `ASSET` events).
- **Pre-PR Verification:** Always validate `prisma validate`, `pnpm test`, `pnpm lint`, `pnpm build`, and `pnpm test:e2e` before opening a PR.
- **Neon PostgreSQL Direct Operations:**
  - When a task requires direct inspection or maintenance on the production database and `DATABASE_URL` is not configured in the environment, request a **Neon API Key** (preferably **Project-scoped** for project `snowy-sound-74057301`) or a temporary `DATABASE_URL` from the user.
  - **Always provide the direct Neon Console link to generate the key:**
    - Project-scoped key (**recommended**, Editor permissions restricted to a single project): open [Neon Console](https://console.neon.tech) → select the organization → **Settings > API keys > Create new > Project-scoped** (project `snowy-sound-74057301`).
    - Direct shortcut for personal keys: `https://console.neon.tech/app/settings/api-keys` (**Account settings > API keys**).
    - Official Neon references: key management (`https://neon.com/docs/manage/api-keys`) and agent setup (`https://neon.com/prompts/agent-setup.md`; note that `neon login` requires interactive browser auth).
  - Neon project: ID `snowy-sound-74057301` (primary branch `production`, database `neondb`, role `neondb_owner`).
  - With the API Key, fetch `connection_uri` via Neon API v2 (`GET https://console.neon.tech/api/v2/projects/snowy-sound-74057301/connection_uri?branch_id=<branch_id>&database_name=neondb&role_name=neondb_owner`, listing branches at `/branches` if needed). Note: project-scoped keys return `404` on `GET /api/v2/projects` — call `/projects/snowy-sound-74057301/...` directly.
  - **Mandatory security & operational rules:**
    - Never print the API Key or `DATABASE_URL` in logs/output or save them to versioned files; pass the URI strictly via in-memory environment variables (and remove any temporary files immediately after use).
    - Always run write scripts in `--dry-run` mode first, present the summary to the user, apply (`--apply`) only after confirmation, and re-verify idempotency afterward.
    - When finished, remind the user to revoke/rotate the temporary Neon API Key and provide the Neon Console link again (`https://console.neon.tech` → organization → **Settings > API keys**, or `https://console.neon.tech/app/settings/api-keys` for personal keys).
- **Git Commit Author (required for Vercel Hobby):** Before creating any commit, ensure:
  - `git config user.name "Eryk Humberto Oliveira Alves"`
  - `git config user.email "erykwho@gmail.com"`
- **Pull Request Workflow:** Always work on a dedicated feature branch and open a Pull Request against `master` via `gh pr create` instead of pushing directly to `master` (validating `prisma validate`, `pnpm test`, `pnpm lint`, `pnpm build`, and `pnpm test:e2e` first). Before pushing new commits to an existing branch in an ongoing conversation, check the PR state (`gh pr view --json state`); if `CLOSED` or `MERGED`, run `git fetch origin`, create a **new branch** from `origin/master`, and open a **new PR**.
- **UI Mobile-First & Vertical Density:** Rupees is used primarily as a mobile PWA (~360–414px width). When building or updating tabs, filter bars, segmented controls, and chart headers:
  - Avoid wrapping tabs, filters, or selectors onto multiple lines (`flex-wrap`) on mobile.
  - Prefer concise labels (e.g., `Projeção RF`, `Patrimônio | Ganho (R$) | Retorno (%)`, `Dia / Mês`), single-row layouts (`grid-cols-3` + `whitespace-nowrap`), and compact mobile controls (single-row bar + bottom sheet for multi-select, native `<select>` for single-select), keeping expanded chips on larger screens (`sm:`/`md:`) where appropriate.
  - Prioritize keeping primary content (KPIs, tables, and charts) comfortably above the fold on mobile.
- **Planned V2 Roadmap:** Annual Brazilian Income Tax report (`Informe` tab from the spreadsheet) and dividends/distributions tracking.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
