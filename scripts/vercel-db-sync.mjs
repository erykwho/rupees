import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

const BASELINE_MIGRATION = "00000000000000_init";

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
if (!existsSync(migrationsDir)) {
  console.error(
    "[db-sync] Diretório prisma/migrations ausente. Recusando executar db push destrutivo em produção."
  );
  process.exit(1);
}

function runPrisma(args) {
  console.log(`[db-sync] Executando: pnpm exec prisma ${args.join(" ")}`);
  const result = spawnSync("pnpm", ["exec", "prisma", ...args], {
    encoding: "utf8",
    stdio: "pipe",
  });

  if (result.stdout) {
    process.stdout.write(result.stdout);
  }
  if (result.stderr) {
    process.stderr.write(result.stderr);
  }

  return result;
}

const deployResult = runPrisma(["migrate", "deploy"]);

if (deployResult.status === 0) {
  process.exit(0);
}

const combinedOutput = `${deployResult.stdout ?? ""}\n${deployResult.stderr ?? ""}`;
const isNonEmptySchemaError = combinedOutput.includes("P3005");
const baselinePath = path.join(migrationsDir, BASELINE_MIGRATION);

if (isNonEmptySchemaError && existsSync(baselinePath)) {
  console.log(
    `[db-sync] Schema existente detectado sem _prisma_migrations (P3005). Aplicando baseline ${BASELINE_MIGRATION}...`
  );
  const resolveResult = runPrisma([
    "migrate",
    "resolve",
    "--applied",
    BASELINE_MIGRATION,
  ]);

  if (resolveResult.status !== 0) {
    process.exit(resolveResult.status ?? 1);
  }

  const retryDeployResult = runPrisma(["migrate", "deploy"]);
  process.exit(retryDeployResult.status ?? 1);
}

process.exit(deployResult.status ?? 1);
