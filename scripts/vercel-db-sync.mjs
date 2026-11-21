import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

const isVercelProduction = process.env.VERCEL_ENV === "production";
const hasDatabaseUrl = Boolean(process.env.DATABASE_URL?.trim());

if (!isVercelProduction) {
  console.log(
    `[db-sync] Pulando sincronização do banco (VERCEL_ENV=${process.env.VERCEL_ENV ?? "local"}).`
  );
  process.exit(0);
}

if (!hasDatabaseUrl) {
  console.error(
    "[db-sync] DATABASE_URL não configurada no ambiente de produção."
  );
  process.exit(1);
}

const migrationsDir = path.join(process.cwd(), "prisma", "migrations");
const command = existsSync(migrationsDir)
  ? "pnpm exec prisma migrate deploy"
  : "pnpm exec prisma db push --skip-generate";

console.log(`[db-sync] Executando: ${command}`);
execSync(command, { stdio: "inherit" });
