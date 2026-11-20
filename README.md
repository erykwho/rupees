# Rupees

Aplicação web mobile-first (**PWA**) para controle pessoal de investimentos (B3, EUA, Renda Fixa e Reserva de Emergência), com cotações automáticas via Yahoo Finance, login via **Google SSO** e **Plano de Aporte** inteligente.

## Stack

- **Framework:** Next.js (App Router, TypeScript) + Tailwind CSS + Recharts
- **Banco de Dados:** Neon PostgreSQL + Prisma ORM
- **Autenticação:** Auth.js v5 (Google OAuth 2.0 + allowlist de e-mails)
- **Cotações:** `yahoo-finance2` (B3 `.SA`, EUA e `USDBRL=X`) com cache de 15 min no PostgreSQL + fallback
- **Deploy:** Vercel (free tier)

## Configuração Local

1. Instale as dependências:

```bash
pnpm install
```

2. Copie o arquivo de exemplo de variáveis de ambiente:

```bash
cp .env.example .env
```

3. Preencha o `.env`:
   - `DATABASE_URL`: connection string do seu projeto gratuito no [Neon](https://neon.tech).
   - `AUTH_SECRET`: gere com `openssl rand -base64 32`.
   - `AUTH_GOOGLE_ID` e `AUTH_GOOGLE_SECRET`: crie um OAuth Client ID (tipo *Web application*) no [Google Cloud Console](https://console.cloud.google.com/apis/credentials) com as URIs de redirecionamento:
     - Local: `http://localhost:3000/api/auth/callback/google`
     - Produção: `https://seu-app.vercel.app/api/auth/callback/google`
   - `ALLOWED_EMAILS`: seu e-mail Google autorizado (ex: `seu.email@gmail.com`).

4. Crie as tabelas no PostgreSQL:

```bash
pnpm db:push
```

5. (Opcional) Importe os dados da sua planilha Google Sheets (exportando as abas `Ativos` e `Aportes` como `ativos.csv` e `aportes.csv` em uma pasta):

```bash
pnpm db:import --email seu.email@gmail.com --dir ./caminho/dos/csvs
```

6. Rode em desenvolvimento:

```bash
pnpm dev
```

## Deploy na Vercel

1. Conecte o repositório `erykwho/rupees` na [Vercel](https://vercel.com).
2. Configure as mesmas variáveis de ambiente do `.env` nas configurações do projeto na Vercel.
3. No Google Cloud Console, adicione `https://<seu-dominio>.vercel.app/api/auth/callback/google` em **Authorized redirect URIs**.
4. Após o deploy, acesse pelo celular e toque em **"Adicionar à tela inicial"** (iOS/Android) para instalar como PWA.

## Scripts Úteis

- `pnpm dev` — inicia o servidor de desenvolvimento
- `pnpm build` — gera o Prisma Client e faz o build de produção
- `pnpm test` — executa os testes unitários do motor de cálculos
- `pnpm lint` — valida o código com ESLint
- `pnpm db:push` — sincroniza o schema Prisma com o banco PostgreSQL
- `pnpm db:import` — importa dados de CSVs exportados do Google Sheets
