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
- `pnpm db:fix-event-dates` — script idempotente (`prisma/fix-event-dates.ts`) com `--dry-run` padrão e `--apply`, aceitando `--csv` (aba Aportes) e/ou `--bootstrap` (`GOAL` e `ASSET` iniciais).
- **Integração com o banco Neon PostgreSQL:**
  - Quando uma tarefa exigir consulta ou manutenção direta no banco de produção e `DATABASE_URL` não estiver configurada no ambiente, solicitar ao usuário uma **Neon API Key** (preferencialmente **Project-scoped** para o projeto `snowy-sound-74057301`) ou a `DATABASE_URL` temporária.
  - **Sempre fornecer ao usuário o link direto para gerar a chave no Neon Console:**
    - Chave com escopo de projeto (**recomendada**, permissão Editor restrita a um único projeto): abrir o [Neon Console](https://console.neon.tech) → selecionar a organização → **Settings > API keys > Create new > Project-scoped** (projeto `snowy-sound-74057301`).
    - Atalho direto para chaves pessoais: `https://console.neon.tech/app/settings/api-keys` (**Account settings > API keys**).
    - Referências oficiais do Neon: gerenciamento de chaves (`https://neon.com/docs/manage/api-keys`) e setup de agentes com Neon CLI/skills/MCP (`https://neon.com/prompts/agent-setup.md`, lembrando que `neon login` exige autenticação interativa no navegador do usuário).
  - Projeto Neon: ID `snowy-sound-74057301` (branch primária `production`, database `neondb`, role `neondb_owner`).
  - Com a API Key, obter a `connection_uri` pela Neon API v2 (`GET https://console.neon.tech/api/v2/projects/snowy-sound-74057301/connection_uri?branch_id=<branch_id>&database_name=neondb&role_name=neondb_owner`, listando branches em `/branches` quando necessário). Atenção: chaves com escopo de projeto retornam `404` em `GET /api/v2/projects` — acessar diretamente `/projects/snowy-sound-74057301/...`.
  - **Segurança e operação obrigatórias:**
    - Nunca imprimir a API Key ou a `DATABASE_URL` em logs/saídas nem salvar em arquivos versionados; passar a URI apenas via variável de ambiente em memória (ou remover qualquer temporário imediatamente após o uso).
    - Sempre executar scripts de escrita primeiro em modo `--dry-run`, apresentar o resumo ao usuário, aplicar (`--apply`) somente após confirmação e re-validar a idempotência em seguida.
    - Ao concluir a tarefa, lembrar o usuário de revogar/rotacionar a Neon API Key temporária enviando novamente o link do Neon Console (`https://console.neon.tech` → organização → **Settings > API keys**, ou `https://console.neon.tech/app/settings/api-keys` para chave pessoal).
- **Autor de commits Git (obrigatório para Vercel Hobby):** antes de criar qualquer commit, garantir `git config user.name "Eryk Humberto Oliveira Alves"` e `git config user.email "erykwho@gmail.com"` para que o Vercel não bloqueie o deploy por colaborador não autorizado em repositório privado.
- **Fluxo de Pull Request (PR):** para mudanças importantes (novas funcionalidades, alterações de regra de negócio, refatorações relevantes ou mudanças de UI), sempre trabalhar em uma branch dedicada e abrir um **Pull Request** contra `master` via `gh pr create` (validando `pnpm test`, `pnpm lint` e `pnpm build` antes), em vez de fazer push direto em `master`. Antes de fazer novos commits ou push na mesma branch durante uma conversa, sempre verificar o status do PR anterior (ex: `gh pr view --json state`); se o PR já estiver fechado (`CLOSED`) ou mergeado (`MERGED`), fazer `git fetch origin`, criar uma **nova branch** a partir de `origin/master` e abrir um **novo PR** em vez de reutilizar a branch antiga.
- Idioma da interface e comunicação com o usuário: **Português (pt-BR)**.
- **Roadmap V2 planejado:** Relatório anual de Imposto de Renda (aba `Informe` da planilha), controle de dividendos/proventos e gráfico histórico de evolução patrimonial.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
