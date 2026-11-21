import { prisma } from "@/lib/prisma";
import { computePortfolioSummary } from "@/lib/domain/calculations";
import { getQuotesForAssets } from "@/lib/quotes";
import type {
  AssetClassKey,
  AssetInput,
  CurrencyCode,
  GoalInput,
  PortfolioSummary,
  PriceModeKey,
  TransactionInput,
  TransactionTypeKey,
} from "@/lib/domain/types";

export async function loadUserPortfolio(
  userId: string,
  options: { forceRefreshQuotes?: boolean } = {}
): Promise<{
  summary: PortfolioSummary;
  goal: GoalInput;
  refreshedQuotesCount: number;
}> {
  const [goalRow, assetRows, txRows] = await Promise.all([
    prisma.allocationGoal.upsert({
      where: { userId },
      update: {},
      create: { userId },
    }),
    prisma.asset.findMany({
      where: { userId },
      orderBy: [{ assetClass: "asc" }, { ticker: "asc" }],
    }),
    prisma.transaction.findMany({
      where: { userId },
      orderBy: [{ date: "asc" }, { createdAt: "asc" }],
    }),
  ]);

  const goal: GoalInput = {
    fixedIncomePct: Number(goalRow.fixedIncomePct),
    variableIncomePct: Number(goalRow.variableIncomePct),
    brazilPct: Number(goalRow.brazilPct),
    usaPct: Number(goalRow.usaPct),
    brStocksPct: Number(goalRow.brStocksPct),
    brFiisPct: Number(goalRow.brFiisPct),
    usStocksPct: Number(goalRow.usStocksPct),
    usReitsPct: Number(goalRow.usReitsPct),
  };

  const assets: AssetInput[] = assetRows.map((a) => ({
    id: a.id,
    ticker: a.ticker,
    assetClass: a.assetClass as AssetClassKey,
    sector: a.sector,
    currency: a.currency as CurrencyCode,
    targetPctInClass: Number(a.targetPctInClass),
    priceMode: a.priceMode as PriceModeKey,
    manualPrice: a.manualPrice !== null ? Number(a.manualPrice) : null,
    isActive: a.isActive,
    fixedIncomeIndex: a.fixedIncomeIndex ?? null,
    fixedIncomeRate:
      a.fixedIncomeRate !== null ? Number(a.fixedIncomeRate) : null,
    maturityDate: a.maturityDate ? a.maturityDate.toISOString().slice(0, 10) : null,
    taxExempt: a.taxExempt,
  }));

  const transactions: TransactionInput[] = txRows.map((t) => ({
    id: t.id,
    assetId: t.assetId,
    date: t.date,
    type: t.type as TransactionTypeKey,
    quantity: Number(t.quantity),
    unitPrice: Number(t.unitPrice),
    totalAmount: Number(t.totalAmount),
    fixedIncomeRate:
      t.fixedIncomeRate !== null ? Number(t.fixedIncomeRate) : null,
    notes: t.notes,
  }));

  const quoteResult = await getQuotesForAssets(
    assets.map((a) => ({
      ticker: a.ticker,
      assetClass: a.assetClass,
      priceMode: a.priceMode,
    })),
    { forceRefresh: options.forceRefreshQuotes }
  );

  const summary = computePortfolioSummary({
    assets,
    transactions,
    goal,
    quotes: quoteResult.quotes,
    usdBrl: quoteResult.usdBrl,
    usdBrlUpdatedAt: quoteResult.usdBrlUpdatedAt,
  });

  return {
    summary,
    goal,
    refreshedQuotesCount: quoteResult.refreshedCount,
  };
}
