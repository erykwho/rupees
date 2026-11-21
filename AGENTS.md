# Rupees — Contexto do Projeto

Aplicação web mobile-first (**PWA**) para controle pessoal de investimentos (B3, EUA, Renda Fixa e Reserva de Emergência), migrada da planilha Google Sheets **Rupees**.

## Stack & Infraestrutura

- **Framework:** Next.js 16 (App Router, TypeScript, Turbopack), React 19, Tailwind CSS v4, Recharts, Lucide icons.
- **Package Manager:** `pnpm` (v12, com `pnpm-workspace.yaml` liberando `allowBuilds` para Prisma/esbuild).
- **Banco de Dados:** Neon PostgreSQL (`prisma/schema.prisma`, Prisma v6).
- **Autenticação:** Auth.js v5 (`next-auth@beta`, JWT session) com **Google OAuth 2.0** + allowlist por variável de ambiente `ALLOWED_EMAILS`. Proteção de rotas via `src/proxy.ts` (convenção do Next.js 16 no lugar de `middleware.ts`).
- **Cotações:** `yahoo-finance2` no servidor (`src/lib/quotes.ts`) cobrindo B3 (sufixo `.SA`), EUA (ticker direto) e câmbio `USDBRL=X`, com cache de 15 min na tabela `QuoteCache`, fallback para última cotação válida e suporte a preço manual/fixo.
- **Hospedagem:** Vercel (`https://rupees-two.vercel.app`, deploy contínuo a partir de `master`).

## Regras de Negócio Essenciais

1. **Hierarquia de Objetivos (`AllocationGoal`):**
   - `Renda Fixa` + `Renda Variável` = 100%
   - Dentro de RV: `Brasil` + `EUA` = 100%
   - Dentro de Brasil: `Ações` + `FIIs` = 100%
   - Dentro de EUA: `Stocks` + `REITs` = 100%
   - O `% Objetivo` de cada ativo na carteira = `% da Classe * targetPctInClass`. Ativos ativos dentro de cada classe de investimento devem somar 100% (ativos com quantidade 0 são permitidos).
2. **Reserva de Emergência (`EMERGENCY_RESERVE`, ex: `SELIC`):**
   - Sempre mantida separada do total investido para fins de alocação e rebalanceamento; exibida à parte e somada no card **Total + Reserva**.
3. **Moedas:**
   - Ativos da B3, Renda Fixa e Reserva são registrados em `BRL`.
   - Ativos dos EUA (`US_STOCK`, `US_REIT`) são registrados em `USD` (preço médio exibido em `USD`), mas consolidados em `BRL` pelo câmbio `USDBRL=X` atual.
4. **Renda Fixa e Reserva:**
   - Operam com `priceMode = MANUAL` e `manualPrice = 1`.
   - Atualização de rendimento usa transações do tipo `BALANCE_ADJUSTMENT`.
5. **Plano de Aporte (`computeContributionPlan`):**
   - Prioriza classes e ativos mais defasados em relação à meta.
   - B3 (`BR_STOCK`, `BR_FII`): apenas quantidades inteiras (`FLOOR`).
   - EUA (`US_STOCK`, `US_REIT`): fracionável com aporte mínimo de US\$ 5 convertidos para BRL.
   - Renda Fixa: qualquer valor em BRL.

## Estrutura Principal

- `prisma/schema.prisma` — modelos `User`, `AllocationGoal`, `Asset`, `Transaction`, `QuoteCache`.
- `prisma/import-sheets.ts` — importador de CSVs (`ativos.csv` e `aportes.csv`) exportados do Google Sheets.
- `src/lib/domain/types.ts` — tipos, labels PT-BR, cores, formatadores e mapeamento de tickers Yahoo.
- `src/lib/domain/calculations.ts` + `calculations.test.ts` — motor puro de cálculos e testes Vitest.
- `src/lib/quotes.ts` — busca e cache de cotações no Yahoo Finance.
- `src/lib/portfolio-loader.ts` — agrega dados do Prisma + cotações para as páginas e APIs.
- `src/app/(dashboard)/` — páginas autenticadas: `/` (Visão Geral), `/carteira`, `/lancamentos`, `/aporte`, `/objetivos`.
- `src/app/api/` — rotas REST protegidas por `requireUser()` (`portfolio`, `assets`, `transactions`, `goals`, `contribution-plan`).

## Comandos & Convenções

- `pnpm test` — executa testes unitários (Vitest). Sempre adicionar/atualizar testes ao alterar `src/lib/domain/`.
- `pnpm lint` — validação ESLint.
- `pnpm build` — roda `prisma generate && node scripts/vercel-db-sync.mjs && next build` (validar antes de abrir PR; sincroniza o schema automaticamente no deploy de produção da Vercel quando `VERCEL_ENV=production`).
- `pnpm db:push` — aplica alterações do schema Prisma manualmente no PostgreSQL.
- Idioma da interface e comunicação com o usuário: **Português (pt-BR)**.
- **Roadmap V2 planejado:** Relatório anual de Imposto de Renda (aba `Informe` da planilha), controle de dividendos/proventos e gráfico histórico de evolução patrimonial.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
