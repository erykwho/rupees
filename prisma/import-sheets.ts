/**
 * Importa os dados da planilha Google Sheets "Rupees" (abas Ativos, Aportes e Geral)
 * exportadas em CSV para o banco PostgreSQL.
 *
 * Uso:
 *   pnpm db:import --email seu.email@gmail.com --dir /caminho/dos/csvs
 *
 * Espera encontrar na pasta: ativos.csv e aportes.csv (e opcionalmente geral.csv).
 */

import fs from "node:fs";
import path from "node:path";
import {
  AssetClass,
  Currency,
  PriceMode,
  PrismaClient,
  TransactionType,
} from "@prisma/client";

const prisma = new PrismaClient();

function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === "," && !inQuotes) {
      fields.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  fields.push(current.trim());
  return fields;
}

function parseBrNumber(raw: string | undefined): number {
  if (!raw) return 0;
  const cleaned = raw
    .replace(/R\$/gi, "")
    .replace(/\$/g, "")
    .replace(/%/g, "")
    .replace(/\s+/g, "")
    .trim();
  if (!cleaned) return 0;

  // Handle Brazilian format ("1.046,43") vs standard decimal ("1046.43")
  const hasComma = cleaned.includes(",");
  const hasDot = cleaned.includes(".");
  let normalized = cleaned;
  if (hasComma && hasDot) {
    normalized = cleaned.replace(/\./g, "").replace(",", ".");
  } else if (hasComma) {
    normalized = cleaned.replace(",", ".");
  }

  const num = Number(normalized);
  return Number.isFinite(num) ? num : 0;
}

function parseBrDate(raw: string): Date {
  const parts = raw.trim().split("/");
  if (parts.length === 3) {
    const [day, month, year] = parts.map(Number);
    return new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  }
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

function mapAssetClass(raw: string): AssetClass {
  const normalized = raw.trim().toLowerCase();
  if (normalized.includes("renda fixa")) return AssetClass.FIXED_INCOME;
  if (normalized.includes("reserva")) return AssetClass.EMERGENCY_RESERVE;
  if (normalized.includes("fii")) return AssetClass.BR_FII;
  if (normalized.includes("reit")) return AssetClass.US_REIT;
  if (normalized.includes("stock")) return AssetClass.US_STOCK;
  return AssetClass.BR_STOCK;
}

function getArg(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  if (idx !== -1 && process.argv[idx + 1]) {
    return process.argv[idx + 1];
  }
  return undefined;
}

async function main() {
  const emailArg =
    getArg("--email") ??
    process.env.ALLOWED_EMAILS?.split(",")[0]?.trim();
  const dirArg = getArg("--dir") ?? "/tmp/rupees-sheets";
  const resetTransactions = process.argv.includes("--reset");

  if (!emailArg) {
    console.error(
      "Informe o e-mail do usuário via --email seu.email@gmail.com ou variável ALLOWED_EMAILS."
    );
    process.exit(1);
  }

  const email = emailArg.toLowerCase();
  const ativosPath = path.join(dirArg, "ativos.csv");
  const aportesPath = path.join(dirArg, "aportes.csv");

  if (!fs.existsSync(ativosPath) || !fs.existsSync(aportesPath)) {
    console.error(
      `Arquivos ativos.csv e aportes.csv não encontrados em: ${dirArg}`
    );
    process.exit(1);
  }

  console.log(`Importando planilha Rupees para ${email}...`);

  const user = await prisma.user.upsert({
    where: { email },
    update: {},
    create: { email, name: email.split("@")[0] },
  });

  // 1. Default goals matching Geral tab (10/90, 60/40, 70/30, 70/30)
  await prisma.allocationGoal.upsert({
    where: { userId: user.id },
    update: {
      fixedIncomePct: 10,
      variableIncomePct: 90,
      brazilPct: 60,
      usaPct: 40,
      brStocksPct: 70,
      brFiisPct: 30,
      usStocksPct: 70,
      usReitsPct: 30,
    },
    create: {
      userId: user.id,
      fixedIncomePct: 10,
      variableIncomePct: 90,
      brazilPct: 60,
      usaPct: 40,
      brStocksPct: 70,
      brFiisPct: 30,
      usStocksPct: 70,
      usReitsPct: 30,
    },
  });

  // 2. Import Ativos
  const ativosLines = fs
    .readFileSync(ativosPath, "utf-8")
    .split(/\r?\n/)
    .slice(1)
    .filter((l) => l.trim().length > 0);

  const assetMap = new Map<string, string>(); // ticker -> assetId

  for (const line of ativosLines) {
    const cols = parseCsvLine(line);
    const ticker = cols[0]?.trim().toUpperCase();
    const sector = cols[1]?.trim() || "Outros";
    const targetPct = parseBrNumber(cols[2]);
    const rawClass = cols[3]?.trim();
    if (!ticker || !rawClass) continue;

    const assetClass = mapAssetClass(rawClass);
    const currency =
      assetClass === AssetClass.US_STOCK || assetClass === AssetClass.US_REIT
        ? Currency.USD
        : Currency.BRL;

    const asset = await prisma.asset.upsert({
      where: { userId_ticker: { userId: user.id, ticker } },
      update: {
        assetClass,
        sector,
        currency,
        targetPctInClass: targetPct,
        priceMode: PriceMode.AUTO_YAHOO,
        isActive: true,
      },
      create: {
        userId: user.id,
        ticker,
        assetClass,
        sector,
        currency,
        targetPctInClass: targetPct,
        priceMode: PriceMode.AUTO_YAHOO,
        isActive: true,
      },
    });
    assetMap.set(ticker, asset.id);
  }

  // Ensure IPCA (Fixed Income) and SELIC (Reserve) exist
  const fixedDefaults = [
    {
      ticker: "IPCA",
      assetClass: AssetClass.FIXED_INCOME,
      sector: "Tesouro Direto",
      targetPctInClass: 100,
    },
    {
      ticker: "SELIC",
      assetClass: AssetClass.EMERGENCY_RESERVE,
      sector: "Reserva de Emergência",
      targetPctInClass: 100,
    },
  ];

  for (const def of fixedDefaults) {
    const asset = await prisma.asset.upsert({
      where: { userId_ticker: { userId: user.id, ticker: def.ticker } },
      update: {},
      create: {
        userId: user.id,
        ticker: def.ticker,
        assetClass: def.assetClass,
        sector: def.sector,
        currency: Currency.BRL,
        targetPctInClass: def.targetPctInClass,
        priceMode: PriceMode.MANUAL,
        manualPrice: 1,
        isActive: true,
      },
    });
    assetMap.set(def.ticker, asset.id);
  }

  // 3. Import Aportes (Transactions)
  if (resetTransactions) {
    await prisma.transaction.deleteMany({ where: { userId: user.id } });
  }

  const existingCount = await prisma.transaction.count({
    where: { userId: user.id },
  });
  if (existingCount > 0 && !resetTransactions) {
    console.log(
      `Usuário já possui ${existingCount} lançamentos. Passe --reset para reimportar todos os lançamentos.`
    );
    return;
  }

  const aportesLines = fs
    .readFileSync(aportesPath, "utf-8")
    .split(/\r?\n/)
    .slice(1)
    .filter((l) => l.trim().length > 0);

  let imported = 0;
  for (const line of aportesLines) {
    const cols = parseCsvLine(line);
    const ticker = cols[0]?.trim().toUpperCase();
    if (!ticker) continue;

    const rawQty = parseBrNumber(cols[1]);
    if (rawQty === 0) continue;

    const date = parseBrDate(cols[2]);
    const rawClass = cols[3] ?? "";
    const rawTotal = parseBrNumber(cols[4]);
    const rawUnit = parseBrNumber(cols[5]);
    const rawQuote = cols[6] ?? "";
    const rawType = (cols[8] ?? "").trim().toLowerCase();

    let assetId = assetMap.get(ticker);
    if (!assetId) {
      const assetClass = mapAssetClass(rawClass);
      const isDelisted = rawQuote.toLowerCase().includes("saiu");
      const created = await prisma.asset.upsert({
        where: { userId_ticker: { userId: user.id, ticker } },
        update: {},
        create: {
          userId: user.id,
          ticker,
          assetClass,
          sector: "Outros",
          currency:
            assetClass === AssetClass.US_STOCK || assetClass === AssetClass.US_REIT
              ? Currency.USD
              : Currency.BRL,
          targetPctInClass: 0,
          priceMode:
            isDelisted ||
            assetClass === AssetClass.FIXED_INCOME ||
            assetClass === AssetClass.EMERGENCY_RESERVE
              ? PriceMode.MANUAL
              : PriceMode.AUTO_YAHOO,
          manualPrice: isDelisted ? Math.abs(rawUnit) || 1 : 1,
          isActive: !isDelisted,
        },
      });
      assetId = created.id;
      assetMap.set(ticker, assetId);
    }

    const type: TransactionType =
      rawType.includes("venda") || rawQty < 0
        ? TransactionType.SELL
        : TransactionType.BUY;

    const quantity = Math.abs(rawQty);
    const totalAmount = Math.abs(rawTotal) || quantity * Math.abs(rawUnit);
    const unitPrice =
      Math.abs(rawUnit) || (quantity > 0 ? totalAmount / quantity : 0);

    await prisma.transaction.create({
      data: {
        userId: user.id,
        assetId,
        date,
        type,
        quantity,
        unitPrice,
        totalAmount,
      },
    });
    imported++;
  }

  console.log(
    `Importação concluída: ${assetMap.size} ativos e ${imported} lançamentos importados.`
  );
}

main()
  .catch((err) => {
    console.error("Erro na importação:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
