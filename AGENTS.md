# Rupees — Contexto do Projeto, Invariantes & Instruções para Agentes

Aplicação web mobile-first (**PWA**) para controle pessoal de investimentos (B3, EUA, Renda Fixa e Reserva de Emergência), migrada da planilha Google Sheets **Rupees** — em produção com dados financeiros reais.

## Regra de Documentação Viva (Obrigatória)

`AGENTS.md` é a **especificação viva** das invariantes de produção e regras de negócio do Rupees.
- Sempre que uma alteração introduzir ou modificar uma **regra de negócio**, **invariante de produção**, **modelo/migração do schema Prisma**, **chave/formato de `localStorage`** ou **contrato de API**, o agente DEVE atualizar a seção correspondente deste `AGENTS.md` no **mesmo Pull Request**.
- Mantenha este arquivo conciso, declarativo e focado na verdade atual (não como changelog verboso). Se passar de ~250 linhas, extraia especificações detalhadas de domínio para `docs/invariants.md` e referencie-as aqui.
- Toda invariante crítica documentada aqui deve ser respaldada por verificação automatizada (teste unitário/API Vitest, validação Prisma, ESLint, Playwright E2E ou CI no GitHub Actions) sempre que viável.

## Invariantes de Produção (Nunca Quebrar)

1. **Isolamento Multi-Tenant Estrito & Zero IDOR:**
   - Toda rota de API autenticada (`/api/assets/**`, `/api/transactions/**`, `/api/goals`, `/api/sector-goals/**`, `/api/portfolio`, `/api/evolution`, `/api/fixed-income`, `/api/contribution-plan`, `/api/events/**`, `/api/tickers/**`, `/api/security/**`) DEVE validar a sessão (`requireUser()` ou `requireAuthenticatedUserAllowLocked()` exclusivamente em endpoints de desbloqueio/status), retornar `401` quando não autenticado, validar payloads com Zod (`400`) e escopar **toda** leitura, atualização, exclusão e referência cruzada (ex.: `assetId` em `POST`/`PATCH /api/transactions`) por `userId`.
   - Apenas `/api/auth/**`, `/api/health`, `/login`, `/manifest.webmanifest`, `/icons/*` e `/favicon.ico` são acessíveis sem sessão Google válida.
2. **App Lock Fail-Closed (`src/proxy.ts` + `src/lib/auth.ts`):**
   - Quando `appLockEnabled === true`, toda rota de página redireciona para `/unlock` e toda rota de API protegida retorna `423` (`code: "APP_LOCKED"`) sem um cookie de desbloqueio assinado e válido (`rupees_app_unlock`).
   - Apenas `/api/security/status`, `/api/security/unlock/pin` e `/api/security/webauthn/auth/*` podem usar `requireAuthenticatedUserAllowLocked()`. Alterar PIN, alterar configurações de timeout ou gerenciar dispositivos WebAuthn exige `requireUser()` (app desbloqueado).
   - Tentativas incorretas de PIN devem respeitar rate-limit/lockout progressivo (`429`).
3. **Migrações Zero-Downtime (Expand-and-Contract):**
   - Atualizações do banco de produção rodam exclusivamente via **Prisma Migrations** (`prisma migrate deploy` em `scripts/vercel-db-sync.mjs`, com baseline único `P3005` para `00000000000000_init`). **Nunca** reabilite `prisma db push` em produção.
   - Nunca remova ou renomeie uma coluna, tabela ou valor de enum existente em um único deploy. Use sempre *expand-and-contract* (adicionar coluna nullable/default → deploy do app compatível → backfill/migrar → remover coluna legada em release posterior) para preservar rollbacks seguros na Vercel.
4. **Integridade Financeira, Moedas e Separação da Reserva:**
   - `EMERGENCY_RESERVE` (ex.: `SELIC`) NUNCA entra no total investido para cálculo de `% Atual`, `% Objetivo` ou rebalanceamento de classes; é exibida à parte e somada apenas no indicador **Total + Reserva**.
   - Ativos B3, Renda Fixa e Reserva são registrados em `BRL`; ativos dos EUA (`US_STOCK`, `US_REIT`) são registrados em `USD` (preço médio em `USD`) e consolidados em `BRL` pelo câmbio `USDBRL=X`.
   - Renda Fixa e Reserva operam com `priceMode = MANUAL` e `manualPrice = 1`; atualizações de rendimento usam `TransactionType.BALANCE_ADJUSTMENT` (que preserva sinal positivo/negativo e fixa `unitPrice = 1`).
5. **Trilha de Auditoria Transacional (`AuditEvent`):**
   - Toda mutação em `ASSET`, `TRANSACTION`, `GOAL` e `SECTOR_GOAL` (create, update, delete, revert) DEVE gravar o respectivo `AuditEvent` de forma atômica dentro da mesma `prisma.$transaction`.
6. **Armazenamento Local Retrocompatível:**
   - Leitores de `localStorage` (tema e modo privacidade) DEVEM lidar com valores ausentes, corrompidos ou de formatos antigos com defaults seguros — nunca lançar exceção no parse ou em ambientes sem `window`.
7. **Guardrails React 19 & Next.js 16:**
   - Usar `src/proxy.ts` (convenção do Next.js 16 no lugar de `middleware.ts`).
   - Não chamar `setState` de forma síncrona no corpo de `useEffect`; preferir `useSyncExternalStore`, `queueMicrotask` ou callbacks assíncronos.
   - Manter Error Boundaries amigáveis em PT-BR (`src/app/error.tsx` e `src/app/global-error.tsx`) e `/api/health` (`Cache-Control: no-store`, com `?db=1` opcional para checagem Neon).

## Regras de Negócio Essenciais

1. **Hierarquia de Objetivos (`AllocationGoal`, `/api/goals`):**
   - `Renda Fixa` + `Renda Variável` = 100%
   - Dentro de RV: `Brasil` + `EUA` = 100%
   - Dentro de Brasil: `Ações` + `FIIs` = 100%
   - Dentro de EUA: `Stocks` + `REITs` = 100%
   - O `% Objetivo` de cada ativo na carteira = `% da Classe * targetPctInClass`. Ativos ativos dentro de cada classe de investimento devem somar 100% (ativos com quantidade 0 são permitidos).
2. **Objetivos por Setor (`SectorGoal`, `/api/sector-goals`):**
   - Aplicam-se exclusivamente às classes de Renda Variável (`BR_STOCK`, `BR_FII`, `US_STOCK`, `US_REIT`).
   - Renomear um setor propaga o novo nome para os ativos vinculados do usuário na mesma transação.
   - Excluir um setor com ativos vinculados DEVE ser bloqueado com `409` listando os tickers afetados.
3. **Plano de Aporte (`computeContributionPlan`, `/api/contribution-plan`):**
   - Prioriza classes e ativos mais defasados em relação à meta, respeitando classes/tickers ignorados e limite `maxAssets`.
   - B3 (`BR_STOCK`, `BR_FII`): apenas quantidades inteiras (`FLOOR`).
   - EUA (`US_STOCK`, `US_REIT`): fracionável com aporte mínimo de US\$ 5 convertidos para BRL.
   - Renda Fixa: qualquer valor em BRL.
4. **Validação de Tickers & Cotações (`src/lib/quotes.ts`, `src/lib/ticker-validator.ts`):**
   - Cotações via `yahoo-finance2` cobrindo B3 (sufixo `.SA`), EUA (ticker direto) e câmbio `USDBRL=X`, com cache de 15 min em `QuoteCache` e fallback para a última cotação válida.
   - Ativos de RV são validados no Yahoo ao criar/alterar ticker ou classe (`422 INVALID_TICKER` quando inválido; `503 YAHOO_UNAVAILABLE` quando indisponível, salvo `allowUnverifiedOnUnavailable: true` que salva como `PENDING`).
5. **Evolução Patrimonial, Projeção RF & Projeção Longo Prazo (`src/lib/domain/evolution.ts`, `fixed-income.ts`, `long-term-projection.ts`):**
   - Série histórica reconstrói patrimônio, capital aportado, ganho nominal e retorno ponderado com cache de cotações históricas (`HistoricalQuoteCache` / `HistoricalQuoteSync`).
   - Projeção RF calcula rentabilidade projetada com benchmarks (CDI, Selic, IPCA, Prefixado) e incidência de IR / isenção (`taxExempt`).
   - Projeção de longo prazo considera aportes mensais, rentabilidade real/nominal e inflação.
6. **Segurança, App Lock & Modo Privacidade (`src/lib/domain/security.ts`, `src/lib/app-lock.ts`, `src/lib/privacy.ts`):**
   - Autenticação via Auth.js v5 (`next-auth@beta`, JWT) com Google OAuth 2.0 + allowlist `ALLOWED_EMAILS`.
   - Camada opcional de App Lock com PIN de 6 dígitos (hash com salt via scrypt) e biometria WebAuthn (`@simplewebauthn/server`), com janela deslizante de inatividade e bloqueio temporário após falhas consecutivas.

## Stack & Infraestrutura

- **Framework:** Next.js 16 (App Router, TypeScript, Turbopack), React 19, Tailwind CSS v4, Recharts, Lucide icons, Zod.
- **Package Manager:** `pnpm` (v12, com `pnpm-workspace.yaml` liberando `allowBuilds` para Prisma/esbuild).
- **Banco de Dados:** Neon PostgreSQL + Prisma v6 (`prisma/schema.prisma`, migrações versionadas em `prisma/migrations/`, sincronizadas automaticamente via `prisma migrate deploy` em `scripts/vercel-db-sync.mjs` quando `VERCEL_ENV=production`).
- **CI/CD & Hospedagem:** GitHub Actions (`.github/workflows/ci.yml` rodando `prisma validate`, `pnpm test`, `pnpm lint`, `pnpm build` e `pnpm test:e2e`) + Vercel (`https://rupees-two.vercel.app`, deploy contínuo a partir de `master`).

## Estrutura Principal

- `.github/workflows/ci.yml` — Pipeline CI do GitHub Actions (Prisma validate, Vitest, ESLint, Next.js build e Playwright E2E).
- `e2e/smoke.spec.ts` & `playwright.config.ts` — Testes E2E smoke mobile PWA (`/api/health`, redirecionamento para `/login`, APIs fail-closed `401`, persistência de tema e manifesto PWA).
- `prisma/schema.prisma` & `prisma/migrations/` — Modelos (`User`, `AllocationGoal`, `SectorGoal`, `Asset`, `Transaction`, `QuoteCache`, `HistoricalQuoteCache`, `HistoricalQuoteSync`, `AuditEvent`, `WebAuthnCredential`, `SecurityChallenge`) e migrações SQL versionadas.
- `prisma/import-sheets.ts`, `fix-event-dates.ts`, `cleanup-mar2025-reversals.ts` — Scripts idempotentes de importação e manutenção de dados.
- `scripts/vercel-db-sync.mjs` — Executor production-only de `prisma migrate deploy` (com baseline único `P3005`, sem fallback para `db push`).
- `src/lib/domain/` — Motores puros de domínio e testes Vitest (`calculations`, `evolution`, `fixed-income`, `long-term-projection`, `audit`, `security`, `ticker-validation`, `chart-zoom`, `event-date-sync`, `reversal-cleanup`, `types`).
- `src/lib/` — Loaders e serviços (`portfolio-loader`, `evolution-loader`, `fixed-income-loader`, `quotes`, `historical-quotes`, `fixed-income-rates`, `audit-service`, `app-lock`, `app-lock-token`, `webauthn`, `privacy`, `pull-to-refresh`, `auth`, `prisma`).
- `src/app/(dashboard)/` — Páginas autenticadas: `/` (Visão Geral), `/carteira`, `/lancamentos`, `/aporte`, `/objetivos`, `/evolucao`, `/eventos`, `/seguranca`.
- `src/app/api/` — Rotas REST protegidas + `/api/health` + suítes de testes de segurança/contrato (`routes.test.ts`, `route.test.ts`).
- `src/app/error.tsx` & `src/app/global-error.tsx` — Error Boundaries em PT-BR.

## Comandos & Convenções

- `pnpm test` — Executa testes unitários e de segurança/contrato de APIs (Vitest). Sempre adicionar/atualizar testes ao alterar `src/lib/domain/` ou `src/app/api/`.
- `pnpm test:e2e` — Executa testes E2E smoke mobile PWA (Playwright) contra o servidor de produção (`pnpm build` antes).
- `pnpm lint` — Validação ESLint.
- `pnpm build` — Roda `prisma generate && node scripts/vercel-db-sync.mjs && next build`.
- `pnpm db:migrate` — Cria e aplica nova migração Prisma localmente (`prisma migrate dev`). Sempre commitar os arquivos gerados em `prisma/migrations/`.
- `pnpm db:migrate:deploy` — Aplica migrações pendentes em produção/staging.
- `pnpm db:fix-event-dates` — Script idempotente (`prisma/fix-event-dates.ts`) com `--dry-run` padrão e `--apply`, aceitando `--csv` (aba Aportes) e/ou `--bootstrap` (`GOAL` e `ASSET` iniciais).
- **Verificação Pré-PR:** Sempre validar `prisma validate`, `pnpm test`, `pnpm lint`, `pnpm build` e `pnpm test:e2e` antes de abrir um PR.
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
- **Fluxo de Pull Request (PR):** para mudanças importantes (novas funcionalidades, alterações de regra de negócio, refatorações relevantes ou mudanças de UI), sempre trabalhar em uma branch dedicada e abrir um **Pull Request** contra `master` via `gh pr create` (validando `prisma validate`, `pnpm test`, `pnpm lint`, `pnpm build` e `pnpm test:e2e` antes), em vez de fazer push direto em `master`. Antes de fazer novos commits ou push na mesma branch durante uma conversa, sempre verificar o status do PR anterior (ex: `gh pr view --json state`); se o PR já estiver fechado (`CLOSED`) ou mergeado (`MERGED`), fazer `git fetch origin`, criar uma **nova branch** a partir de `origin/master` e abrir um **novo PR** em vez de reutilizar a branch antiga.
- **UI Mobile-First e Densidade Vertical:** o Rupees é usado prioritariamente como PWA no celular (~360–414px de largura). Ao criar ou alterar abas, barras de filtros, controles segmentados e cabeçalhos de gráficos:
  - Evitar que abas, filtros ou seletores quebrem em múltiplas linhas (`flex-wrap`) no mobile consumindo grande fração da tela.
  - Preferir rótulos enxutos e claros (ex.: `Projeção RF`, `Patrimônio | Ganho (R$) | Retorno (%)`, `Dia / Mês`), layouts de linha única (`grid-cols-3` + `whitespace-nowrap`) e controles compactos no mobile (como barra única com bottom sheet para multi-seleção e `<select>` nativo para seleções simples), preservando chips expandidos em telas maiores (`sm:`/`md:`) quando fizer sentido.
  - Priorizar que o conteúdo principal (KPIs, tabelas e gráficos) apareça logo acima da dobra no celular.
- Idioma da interface e comunicação com o usuário: **Português (pt-BR)**.
- **Roadmap V2 planejado:** Relatório anual de Imposto de Renda (aba `Informe` da planilha) e controle de dividendos/proventos.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
