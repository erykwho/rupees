import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  TransactionsManager,
  type SimpleAssetOption,
  type TransactionRow,
} from "@/components/transactions-manager";
import type {
  AssetClassKey,
  CurrencyCode,
  TransactionTypeKey,
} from "@/lib/domain/types";

export const dynamic = "force-dynamic";

export default async function LancamentosPage(props: {
  searchParams: Promise<{ novo?: string }>;
}) {
  const user = await requireUser();
  const searchParams = await props.searchParams;

  const [txRows, assetRows] = await Promise.all([
    prisma.transaction.findMany({
      where: { userId: user.id },
      include: {
        asset: {
          select: {
            id: true,
            ticker: true,
            assetClass: true,
            currency: true,
            sector: true,
            fixedIncomeIndex: true,
            fixedIncomeRate: true,
          },
        },
      },
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    }),
    prisma.asset.findMany({
      where: { userId: user.id },
      orderBy: [{ ticker: "asc" }],
      select: {
        id: true,
        ticker: true,
        assetClass: true,
        currency: true,
        fixedIncomeIndex: true,
        fixedIncomeRate: true,
      },
    }),
  ]);

  const initialTransactions: TransactionRow[] = txRows.map((t) => ({
    id: t.id,
    assetId: t.assetId,
    date: t.date.toISOString(),
    type: t.type as TransactionTypeKey,
    quantity: Number(t.quantity),
    unitPrice: Number(t.unitPrice),
    totalAmount: Number(t.totalAmount),
    fixedIncomeRate:
      t.fixedIncomeRate !== null ? Number(t.fixedIncomeRate) : null,
    notes: t.notes,
    asset: {
      id: t.asset.id,
      ticker: t.asset.ticker,
      assetClass: t.asset.assetClass as AssetClassKey,
      currency: t.asset.currency as CurrencyCode,
      sector: t.asset.sector,
      fixedIncomeIndex: t.asset.fixedIncomeIndex ?? null,
      fixedIncomeRate:
        t.asset.fixedIncomeRate !== null
          ? Number(t.asset.fixedIncomeRate)
          : null,
    },
  }));

  const assets: SimpleAssetOption[] = assetRows.map((a) => ({
    id: a.id,
    ticker: a.ticker,
    assetClass: a.assetClass as AssetClassKey,
    currency: a.currency as CurrencyCode,
    fixedIncomeIndex: a.fixedIncomeIndex ?? null,
    fixedIncomeRate:
      a.fixedIncomeRate !== null ? Number(a.fixedIncomeRate) : null,
  }));

  return (
    <TransactionsManager
      initialTransactions={initialTransactions}
      assets={assets}
      openNewByDefault={searchParams.novo === "1"}
    />
  );
}
