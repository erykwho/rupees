/**
 * Corrige `AuditEvent.createdAt` dos eventos `CREATE` de `TRANSACTION`
 * cruzando com a coluna Data da aba "Aportes" exportada em CSV.
 *
 * Por padrão executa em modo `--dry-run` (sem alterar o banco).
 * Passe `--apply` para aplicar as atualizações em transação.
 *
 * Uso:
 *   pnpm db:fix-event-dates --csv /caminho/aportes.csv
 *   pnpm db:fix-event-dates --csv /caminho/aportes.csv --apply
 *   pnpm db:fix-event-dates --csv /caminho/aportes.csv --email seu@email.com --apply
 */

import fs from "node:fs";
import { PrismaClient } from "@prisma/client";
import type { TransactionSnapshot } from "../src/lib/domain/audit";
import {
  type AuditEventCandidate,
  matchAuditEventsWithSheet,
  parseAportesCsv,
} from "../src/lib/domain/event-date-sync";

const prisma = new PrismaClient();

function getArg(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  if (idx !== -1 && process.argv[idx + 1] && !process.argv[idx + 1].startsWith("--")) {
    return process.argv[idx + 1];
  }
  return undefined;
}

function parseSnapshot(value: unknown): TransactionSnapshot | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const obj = value as Record<string, unknown>;
  if (typeof obj.assetTicker !== "string" || typeof obj.type !== "string") {
    return null;
  }
  return value as TransactionSnapshot;
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
  const csvPath = getArg("--csv");
  const emailArg = getArg("--email");
  const shouldApply = process.argv.includes("--apply");

  if (!csvPath) {
    console.error("Informe o caminho do CSV da aba Aportes via --csv /caminho/aportes.csv");
    process.exit(1);
  }
  if (!fs.existsSync(csvPath)) {
    console.error(`Arquivo CSV não encontrado: ${csvPath}`);
    process.exit(1);
  }

  const csvContent = fs.readFileSync(csvPath, "utf-8");
  const sheetRows = parseAportesCsv(csvContent);
  const user = await resolveUser(emailArg);

  const [auditEvents, transactions] = await Promise.all([
    prisma.auditEvent.findMany({
      where: {
        userId: user.id,
        entityType: "TRANSACTION",
        action: "CREATE",
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    }),
    prisma.transaction.findMany({
      where: { userId: user.id },
      select: { id: true, date: true },
    }),
  ]);

  const txDateById = new Map<string, Date>(transactions.map((t) => [t.id, t.date]));

  const candidates: AuditEventCandidate[] = [];
  for (const ev of auditEvents) {
    const snap = parseSnapshot(ev.afterState);
    if (!snap) continue;

    const txDate =
      txDateById.get(ev.entityId) ??
      (snap.date ? new Date(snap.date) : null);

    candidates.push({
      id: ev.id,
      entityId: ev.entityId,
      entityLabel: ev.entityLabel,
      createdAt: ev.createdAt,
      ticker: snap.assetTicker.toUpperCase(),
      type: snap.type,
      quantity: Number(snap.quantity),
      totalAmount: Number(snap.totalAmount),
      transactionDate: txDate,
    });
  }

  const plan = matchAuditEventsWithSheet(candidates, sheetRows);
  const toUpdate = plan.matches.filter((m) => m.needsUpdate);
  const alreadySynced = plan.matches.length - toUpdate.length;

  console.log(`Modo: ${shouldApply ? "APPLY (gravando no banco)" : "DRY-RUN (nenhuma alteração será feita)"}`);
  console.log(`Usuário: ${user.email}`);
  console.log(`Linhas válidas na aba Aportes: ${sheetRows.length}`);
  console.log(`Eventos CREATE de TRANSACTION no banco: ${candidates.length}`);
  console.log(`Casados com a planilha: ${plan.matches.length}`);
  console.log(`  - Precisam de atualização: ${toUpdate.length}`);
  console.log(`  - Já estavam corretos: ${alreadySynced}`);
  console.log(`Linhas da planilha sem match: ${plan.unmatchedSheetRows.length}`);
  console.log(`Eventos CREATE fora da planilha (mantidos intactos): ${plan.unmatchedEvents.length}`);

  if (toUpdate.length > 0) {
    console.log("\n--- Atualizações planejadas ---");
    for (const m of toUpdate) {
      console.log(
        `[Linha ${String(m.rowNumber).padStart(2, " ")}] ${m.ticker.padEnd(7)} ${m.type.padEnd(4)} qtd=${m.quantity} total=${m.totalAmount} | ${m.currentCreatedAt.toISOString()} -> ${m.targetCreatedAt.toISOString()} (planilha: ${m.rawDate})`
      );
    }
  }

  if (plan.unmatchedSheetRows.length > 0) {
    console.log("\n--- Linhas da planilha SEM match no banco ---");
    for (const r of plan.unmatchedSheetRows) {
      console.log(
        `[Linha ${String(r.rowNumber).padStart(2, " ")}] ${r.ticker.padEnd(7)} ${r.type.padEnd(4)} qtd=${r.quantity} total=${r.totalAmount} data=${r.rawDate}`
      );
    }
  }

  if (plan.unmatchedEvents.length > 0) {
    console.log("\n--- Eventos CREATE fora da planilha (mantidos intactos) ---");
    for (const e of plan.unmatchedEvents) {
      console.log(
        `${e.id} | ${e.ticker.padEnd(7)} ${e.type.padEnd(4)} qtd=${e.quantity} total=${e.totalAmount} createdAt=${e.createdAt.toISOString()} txDate=${e.transactionDate?.toISOString() ?? "n/a"}`
      );
    }
  }

  if (!shouldApply) {
    console.log("\nDry-run concluído. Execute novamente com --apply para gravar no banco.");
    return;
  }

  if (toUpdate.length === 0) {
    console.log("\nNenhuma atualização pendente.");
    return;
  }

  await prisma.$transaction(
    toUpdate.map((m) =>
      prisma.auditEvent.update({
        where: { id: m.eventId },
        data: { createdAt: m.targetCreatedAt },
      })
    )
  );

  console.log(`\nConcluído: ${toUpdate.length} evento(s) atualizado(s) com sucesso.`);
}

main()
  .catch((err) => {
    console.error("Erro ao corrigir datas dos eventos:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
