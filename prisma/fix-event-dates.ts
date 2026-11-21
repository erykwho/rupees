/**
 * Corrige datas de eventos históricos em `AuditEvent` (e opcionalmente `Asset.createdAt`):
 *
 * 1. `--csv /caminho/aportes.csv`
 *    Cruza eventos `CREATE` de `TRANSACTION` com a coluna Data da aba "Aportes".
 * 2. `--bootstrap`
 *    Move eventos `CREATE` de `GOAL` e `ASSET` do lote inicial de importação
 *    (e `Asset.createdAt` correspondente) para 1 dia antes do primeiro aporte
 *    (12:00:00 UTC, +1s por registro). Pode ser combinado com `--before <ISO>`.
 *
 * Por padrão executa em modo `--dry-run` (sem alterar o banco).
 * Passe `--apply` para aplicar as atualizações em transação.
 *
 * Uso:
 *   pnpm db:fix-event-dates --csv /caminho/aportes.csv
 *   pnpm db:fix-event-dates --bootstrap
 *   pnpm db:fix-event-dates --bootstrap --apply
 *   pnpm db:fix-event-dates --csv /caminho/aportes.csv --bootstrap --apply
 */

import fs from "node:fs";
import { PrismaClient } from "@prisma/client";
import type { TransactionSnapshot } from "../src/lib/domain/audit";
import {
  type AuditEventCandidate,
  type BootstrapEventCandidate,
  computePreFirstContributionBaseDate,
  matchAuditEventsWithSheet,
  parseAportesCsv,
  planBootstrapDateUpdates,
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

async function syncTransactionsFromCsv(
  userId: string,
  csvPath: string,
  shouldApply: boolean
): Promise<Date[]> {
  if (!fs.existsSync(csvPath)) {
    throw new Error(`Arquivo CSV não encontrado: ${csvPath}`);
  }

  const csvContent = fs.readFileSync(csvPath, "utf-8");
  const sheetRows = parseAportesCsv(csvContent);

  const [auditEvents, transactions] = await Promise.all([
    prisma.auditEvent.findMany({
      where: {
        userId,
        entityType: "TRANSACTION",
        action: "CREATE",
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    }),
    prisma.transaction.findMany({
      where: { userId },
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

  console.log(`\n=== Lançamentos (aba Aportes) ===`);
  console.log(`Linhas válidas na aba Aportes: ${sheetRows.length}`);
  console.log(`Eventos CREATE de TRANSACTION no banco: ${candidates.length}`);
  console.log(`Casados com a planilha: ${plan.matches.length}`);
  console.log(`  - Precisam de atualização: ${toUpdate.length}`);
  console.log(`  - Já estavam corretos: ${alreadySynced}`);
  console.log(`Linhas da planilha sem match: ${plan.unmatchedSheetRows.length}`);
  console.log(`Eventos CREATE fora da planilha (mantidos intactos): ${plan.unmatchedEvents.length}`);

  if (toUpdate.length > 0) {
    console.log("\n--- Atualizações planejadas (TRANSACTION) ---");
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

  if (shouldApply && toUpdate.length > 0) {
    await prisma.$transaction(
      toUpdate.map((m) =>
        prisma.auditEvent.update({
          where: { id: m.eventId },
          data: { createdAt: m.targetCreatedAt },
        })
      )
    );
    console.log(`Atualizados ${toUpdate.length} evento(s) de TRANSACTION.`);
  }

  return sheetRows.map((r) => r.targetCreatedAt);
}

async function syncBootstrapEvents(
  userId: string,
  shouldApply: boolean,
  importedBefore?: Date,
  referenceDates?: Date[]
): Promise<void> {
  const [txDates, bootstrapEvents, assets] = await Promise.all([
    referenceDates && referenceDates.length > 0
      ? Promise.resolve(referenceDates)
      : prisma.transaction
          .findMany({ where: { userId }, select: { date: true } })
          .then((rows) => rows.map((r) => r.date)),
    prisma.auditEvent.findMany({
      where: {
        userId,
        entityType: { in: ["GOAL", "ASSET"] },
        action: "CREATE",
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    }),
    prisma.asset.findMany({
      where: { userId },
      select: { id: true, createdAt: true },
    }),
  ]);

  const baseDate = computePreFirstContributionBaseDate(txDates);
  if (!baseDate) {
    console.log("\nNenhum aporte encontrado para calcular a data base dos ativos/objetivos.");
    return;
  }

  const assetCreatedAtById = new Map<string, Date>(
    assets.map((a) => [a.id, a.createdAt])
  );

  const candidates: BootstrapEventCandidate[] = bootstrapEvents.map((ev) => ({
    id: ev.id,
    entityType: ev.entityType as "GOAL" | "ASSET",
    entityId: ev.entityId,
    entityLabel: ev.entityLabel,
    createdAt: ev.createdAt,
    assetCreatedAt:
      ev.entityType === "ASSET" ? (assetCreatedAtById.get(ev.entityId) ?? null) : null,
  }));

  const plan = planBootstrapDateUpdates({
    baseDate,
    events: candidates,
    importedBefore,
  });

  const eventsToUpdate = plan.updates.filter((u) => u.eventNeedsUpdate);
  const assetsToUpdate = plan.updates.filter((u) => u.assetNeedsUpdate);

  console.log(`\n=== Bootstrap inicial (GOAL e ASSET) ===`);
  console.log(`Data base calculada (1 dia antes do 1º aporte): ${plan.baseDate.toISOString()}`);
  console.log(`Eventos no lote inicial: ${plan.updates.length}`);
  console.log(`  - AuditEvent.createdAt a atualizar: ${eventsToUpdate.length}`);
  console.log(`  - Asset.createdAt a atualizar: ${assetsToUpdate.length}`);
  console.log(`Eventos fora do lote inicial (mantidos intactos): ${plan.skippedEvents.length}`);

  if (eventsToUpdate.length > 0 || assetsToUpdate.length > 0) {
    console.log("\n--- Atualizações planejadas (GOAL / ASSET) ---");
    for (const u of plan.updates) {
      if (!u.eventNeedsUpdate && !u.assetNeedsUpdate) continue;
      console.log(
        `${u.entityType.padEnd(5)} ${u.entityLabel.padEnd(22)} | event: ${u.currentEventCreatedAt.toISOString()} -> ${u.targetDate.toISOString()}${u.assetNeedsUpdate ? " (+ Asset.createdAt)" : ""}`
      );
    }
  }

  if (plan.skippedEvents.length > 0) {
    console.log("\n--- Eventos GOAL/ASSET mantidos intactos ---");
    for (const s of plan.skippedEvents) {
      console.log(
        `${s.entityType.padEnd(5)} ${s.entityLabel.padEnd(22)} | createdAt=${s.createdAt.toISOString()}`
      );
    }
  }

  if (shouldApply && (eventsToUpdate.length > 0 || assetsToUpdate.length > 0)) {
    await prisma.$transaction([
      ...eventsToUpdate.map((u) =>
        prisma.auditEvent.update({
          where: { id: u.eventId },
          data: { createdAt: u.targetDate },
        })
      ),
      ...assetsToUpdate.map((u) =>
        prisma.asset.update({
          where: { id: u.entityId },
          data: { createdAt: u.targetDate },
        })
      ),
    ]);
    console.log(
      `Atualizados ${eventsToUpdate.length} AuditEvent(s) e ${assetsToUpdate.length} Asset(s).`
    );
  }
}

async function main() {
  const csvPath = getArg("--csv");
  const emailArg = getArg("--email");
  const beforeArg = getArg("--before");
  const includeBootstrap = process.argv.includes("--bootstrap");
  const shouldApply = process.argv.includes("--apply");

  if (!csvPath && !includeBootstrap) {
    console.error(
      "Informe --csv /caminho/aportes.csv e/ou --bootstrap. Passe --apply para gravar no banco."
    );
    process.exit(1);
  }

  const importedBefore = beforeArg ? new Date(beforeArg) : undefined;
  if (importedBefore && Number.isNaN(importedBefore.getTime())) {
    console.error(`Data inválida em --before: ${beforeArg}`);
    process.exit(1);
  }

  const user = await resolveUser(emailArg);
  console.log(`Modo: ${shouldApply ? "APPLY (gravando no banco)" : "DRY-RUN (nenhuma alteração será feita)"}`);
  console.log(`Usuário: ${user.email}`);

  let referenceDates: Date[] | undefined;
  if (csvPath) {
    referenceDates = await syncTransactionsFromCsv(user.id, csvPath, shouldApply);
  }

  if (includeBootstrap) {
    await syncBootstrapEvents(user.id, shouldApply, importedBefore, referenceDates);
  }

  if (!shouldApply) {
    console.log("\nDry-run concluído. Execute novamente com --apply para gravar no banco.");
  }
}

main()
  .catch((err) => {
    console.error("Erro ao corrigir datas dos eventos:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
