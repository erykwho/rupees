/**
 * Remove do banco os pares anômalos de compra (03/03/2025) e estorno (06/03/2025)
 * de VOO (US_STOCK) e VNQ (US_REIT), bem como os registros de AuditEvent associados.
 *
 * Esses lançamentos foram originalmente digitados com valor em BRL (500) na coluna
 * em USD e estornados 3 dias depois, causando distorção de ~-83% a -90% na
 * rentabilidade acumulada entre 03/03/2025 e 05/03/2025.
 *
 * Por padrão executa em modo `--dry-run` (sem alterar o banco).
 * Passe `--apply` para executar as remoções em transação.
 *
 * Uso:
 *   pnpm db:cleanup-mar2025-reversals
 *   pnpm db:cleanup-mar2025-reversals --apply
 *   pnpm db:cleanup-mar2025-reversals --email seu@email.com --apply
 */

import { PrismaClient } from "@prisma/client";
import { toISODate } from "../src/lib/domain/evolution";
import {
  type CleanupAuditEventCandidate,
  type CleanupTransactionCandidate,
  MAR_2025_US_REVERSAL_TARGETS,
  planMar2025ReversalCleanup,
} from "../src/lib/domain/reversal-cleanup";
import type { TransactionTypeKey } from "../src/lib/domain/types";

const prisma = new PrismaClient();

function getArg(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  if (
    idx !== -1 &&
    process.argv[idx + 1] &&
    !process.argv[idx + 1].startsWith("--")
  ) {
    return process.argv[idx + 1];
  }
  return undefined;
}

function extractAuditSnapshot(
  value: unknown
): CleanupAuditEventCandidate["snapshot"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const obj = value as Record<string, unknown>;
  if (typeof obj.assetTicker !== "string" || typeof obj.type !== "string") {
    return null;
  }
  const dateISO =
    typeof obj.date === "string" || obj.date instanceof Date
      ? toISODate(obj.date)
      : null;

  return {
    ticker: obj.assetTicker.toUpperCase(),
    type: obj.type as TransactionTypeKey,
    dateISO,
    quantity: Number(obj.quantity),
    totalAmount: Number(obj.totalAmount),
  };
}

async function resolveUser(emailArg?: string) {
  if (emailArg) {
    const user = await prisma.user.findUnique({
      where: { email: emailArg.toLowerCase() },
      select: { id: true, email: true },
    });
    if (!user) {
      throw new Error(`Usuário não encontrado para o e-mail: ${emailArg}`);
    }
    return user;
  }

  const users = await prisma.user.findMany({
    select: { id: true, email: true },
    orderBy: { createdAt: "asc" },
  });
  if (users.length === 0) {
    throw new Error("Nenhum usuário encontrado no banco.");
  }
  if (users.length > 1) {
    throw new Error(
      `Encontrados ${users.length} usuários (${users.map((u) => u.email).join(", ")}). Informe --email.`
    );
  }
  return users[0];
}

async function main() {
  const emailArg = getArg("--email");
  const shouldApply = process.argv.includes("--apply");
  const forcePartial = process.argv.includes("--force");

  const user = await resolveUser(emailArg);

  const targetTickers = Array.from(
    new Set(MAR_2025_US_REVERSAL_TARGETS.map((t) => t.ticker))
  );

  const [txRows, auditRows] = await Promise.all([
    prisma.transaction.findMany({
      where: {
        userId: user.id,
        asset: { ticker: { in: targetTickers } },
      },
      include: {
        asset: { select: { ticker: true } },
      },
      orderBy: [{ date: "asc" }, { createdAt: "asc" }, { id: "asc" }],
    }),
    prisma.auditEvent.findMany({
      where: {
        userId: user.id,
        entityType: "TRANSACTION",
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    }),
  ]);

  const txCandidates: CleanupTransactionCandidate[] = txRows.map((tx) => ({
    id: tx.id,
    assetId: tx.assetId,
    ticker: tx.asset.ticker.toUpperCase(),
    date: tx.date,
    type: tx.type as TransactionTypeKey,
    quantity: Number(tx.quantity),
    unitPrice: Number(tx.unitPrice),
    totalAmount: Number(tx.totalAmount),
  }));

  const auditCandidates: CleanupAuditEventCandidate[] = auditRows.map((ev) => ({
    id: ev.id,
    entityId: ev.entityId,
    entityLabel: ev.entityLabel,
    action: ev.action,
    createdAt: ev.createdAt,
    snapshot:
      extractAuditSnapshot(ev.afterState) ??
      extractAuditSnapshot(ev.beforeState),
  }));

  const plan = planMar2025ReversalCleanup({
    transactions: txCandidates,
    auditEvents: auditCandidates,
  });

  console.log(
    `Modo: ${shouldApply ? "APPLY (gravando no banco)" : "DRY-RUN (nenhuma alteração será feita)"}`
  );
  console.log(`Usuário: ${user.email}`);
  console.log(
    `Alvos esperados: ${MAR_2025_US_REVERSAL_TARGETS.length} lançamentos (pares VOO e VNQ em 03/03 e 06/03/2025)`
  );
  console.log(
    `Transações encontradas para remoção: ${plan.matchedTransactions.length}`
  );
  console.log(
    `Registros de AuditEvent encontrados para remoção: ${plan.matchedAuditEvents.length}`
  );
  console.log(
    `Alvos ausentes (já removidos ou inexistentes): ${plan.missingTargets.length}`
  );

  if (plan.matchedTransactions.length > 0) {
    console.log("\n--- Transações a remover ---");
    for (const { target, transaction: tx } of plan.matchedTransactions) {
      console.log(
        `${tx.id} | ${tx.ticker.padEnd(4)} ${tx.type.padEnd(4)} data=${toISODate(tx.date)} qtd=${tx.quantity} total=${tx.totalAmount} unit=${tx.unitPrice} (${target.reason})`
      );
    }
  }

  if (plan.matchedAuditEvents.length > 0) {
    console.log("\n--- AuditEvents a remover ---");
    for (const ev of plan.matchedAuditEvents) {
      console.log(
        `${ev.id} | ${ev.action.padEnd(6)} entityId=${ev.entityId} label="${ev.entityLabel}" createdAt=${new Date(ev.createdAt).toISOString()}`
      );
    }
  }

  if (plan.missingTargets.length > 0) {
    console.log("\n--- Alvos não encontrados no banco ---");
    for (const t of plan.missingTargets) {
      console.log(
        `${t.ticker.padEnd(4)} ${t.type.padEnd(4)} data=${t.dateISO} qtd=${t.quantity} total=${t.totalAmount}`
      );
    }
  }

  if (plan.warnings.length > 0) {
    console.log("\n--- Avisos ---");
    for (const w of plan.warnings) {
      console.warn(`⚠️  ${w}`);
    }
  }

  if (!shouldApply) {
    console.log(
      "\nDry-run concluído. Execute novamente com --apply para remover do banco."
    );
    return;
  }

  if (plan.partialPairs.length > 0 && !forcePartial) {
    console.error(
      `\nAbortado: par(es) incompleto(s) detectado(s) (${plan.partialPairs.join(", ")}). ` +
        "Passe --force apenas se tiver certeza de que deseja remover sem o par completo."
    );
    process.exit(1);
  }

  if (
    plan.matchedTransactions.length === 0 &&
    plan.matchedAuditEvents.length === 0
  ) {
    console.log("\nNada a remover. O banco já está limpo.");
    return;
  }

  const txIds = plan.matchedTransactions.map((m) => m.transaction.id);
  const auditIds = plan.matchedAuditEvents.map((e) => e.id);

  const [deletedAudit, deletedTx] = await prisma.$transaction([
    prisma.auditEvent.deleteMany({
      where: {
        userId: user.id,
        id: { in: auditIds },
      },
    }),
    prisma.transaction.deleteMany({
      where: {
        userId: user.id,
        id: { in: txIds },
      },
    }),
  ]);

  console.log(
    `\nConcluído: ${deletedTx.count} transação(ões) e ${deletedAudit.count} registro(s) de AuditEvent removido(s) com sucesso.`
  );
}

main()
  .catch((err) => {
    console.error("Erro ao limpar lançamentos anômalos de março/2025:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
