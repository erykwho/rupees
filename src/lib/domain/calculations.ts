import {
  ASSET_CLASS_LABELS,
  type AssetInput,
  type AssetPosition,
  type AssetSummary,
  type ClassSummary,
  type ContributionPlanResult,
  type ContributionSuggestion,
  type GoalInput,
  type HierarchyRow,
  INVESTMENT_CLASSES,
  type InvestmentClassKey,
  type PortfolioSummary,
  type SectorCoverageStatus,
  type SectorGoalInput,
  type SectorSummary,
  type TransactionInput,
  getYahooSymbol,
} from "./types";

const EPSILON = 1e-8;
const US_MIN_INVEST_USD = 5;

export function computeDerivedClassTargets(
  goal: GoalInput
): Record<InvestmentClassKey, number> {
  const fi = goal.fixedIncomePct;
  const vi = goal.variableIncomePct;
  const br = (vi * goal.brazilPct) / 100;
  const us = (vi * goal.usaPct) / 100;

  return {
    FIXED_INCOME: round2(fi),
    BR_STOCK: round2((br * goal.brStocksPct) / 100),
    BR_FII: round2((br * goal.brFiisPct) / 100),
    US_STOCK: round2((us * goal.usStocksPct) / 100),
    US_REIT: round2((us * goal.usReitsPct) / 100),
  };
}

export function computeAssetPosition(
  transactions: TransactionInput[]
): AssetPosition {
  const sorted = [...transactions].sort((a, b) => {
    const da = new Date(a.date).getTime();
    const db = new Date(b.date).getTime();
    if (da !== db) return da - db;
    return a.id.localeCompare(b.id);
  });

  let quantity = 0;
  let avgPrice = 0;

  for (const tx of sorted) {
    const qty = Math.abs(tx.quantity);
    const total = Math.abs(tx.totalAmount);

    if (tx.type === "BUY") {
      const nextQty = quantity + qty;
      if (nextQty > EPSILON) {
        avgPrice = (quantity * avgPrice + total) / nextQty;
      }
      quantity = nextQty;
    } else if (tx.type === "SELL") {
      quantity = Math.max(0, quantity - qty);
      if (quantity <= EPSILON) {
        quantity = 0;
        avgPrice = 0;
      }
    } else if (tx.type === "BALANCE_ADJUSTMENT") {
      // For Fixed Income / Reserve: adjusts balance/yield directly.
      // Positive quantity adds yield; negative subtracts.
      const nextQty = Math.max(0, quantity + tx.quantity);
      if (nextQty <= EPSILON) {
        quantity = 0;
        avgPrice = 0;
      } else {
        // Keep cost basis unchanged when recording yield, or set avgPrice = 1 if starting from 0
        if (quantity <= EPSILON) {
          avgPrice = 1;
        }
        quantity = nextQty;
      }
    }
  }

  return {
    quantity,
    avgPrice,
    investedCost: quantity * avgPrice,
  };
}

export interface QuoteMapEntry {
  price: number;
  updatedAt: string | null;
}

export function computePortfolioSummary(params: {
  assets: AssetInput[];
  transactions: TransactionInput[];
  goal: GoalInput;
  sectorGoals?: SectorGoalInput[];
  quotes: Record<string, QuoteMapEntry>;
  usdBrl: number;
  usdBrlUpdatedAt?: string | null;
}): PortfolioSummary {
  const {
    assets,
    transactions,
    goal,
    sectorGoals = [],
    quotes,
    usdBrl,
    usdBrlUpdatedAt = null,
  } = params;

  const derivedTargets = computeDerivedClassTargets(goal);

  const txByAsset = new Map<string, TransactionInput[]>();
  for (const tx of transactions) {
    const list = txByAsset.get(tx.assetId);
    if (list) list.push(tx);
    else txByAsset.set(tx.assetId, [tx]);
  }

  // First pass: compute positions & current values in BRL
  const interim = assets.map((asset) => {
    const pos = computeAssetPosition(txByAsset.get(asset.id) ?? []);
    const yahooSymbol = getYahooSymbol(asset.ticker, asset.assetClass);
    const cachedQuote = yahooSymbol ? quotes[yahooSymbol] : undefined;

    let currentPriceNative = 1;
    let quoteUpdatedAt: string | null = null;

    if (asset.priceMode === "MANUAL") {
      currentPriceNative = asset.manualPrice ?? (pos.avgPrice || 1);
    } else if (cachedQuote && cachedQuote.price > 0) {
      currentPriceNative = cachedQuote.price;
      quoteUpdatedAt = cachedQuote.updatedAt;
    } else if (asset.manualPrice && asset.manualPrice > 0) {
      currentPriceNative = asset.manualPrice;
    } else if (pos.avgPrice > 0) {
      currentPriceNative = pos.avgPrice;
    } else {
      currentPriceNative = 0;
    }

    const fxRate = asset.currency === "USD" ? usdBrl : 1;
    const currentPriceBRL = currentPriceNative * fxRate;
    const currentValueBRL = pos.quantity * currentPriceBRL;
    const investedCostBRL = pos.investedCost * fxRate;
    const profitLossBRL = currentValueBRL - investedCostBRL;
    const profitLossPct =
      investedCostBRL > EPSILON ? (profitLossBRL / investedCostBRL) * 100 : 0;

    const globalTargetPct =
      asset.assetClass === "EMERGENCY_RESERVE" || !asset.isActive
        ? 0
        : (derivedTargets[asset.assetClass] * asset.targetPctInClass) / 100;

    return {
      asset,
      pos,
      currentPriceNative,
      currentPriceBRL,
      currentValueBRL,
      investedCostBRL,
      profitLossBRL,
      profitLossPct,
      globalTargetPct,
      quoteUpdatedAt,
    };
  });

  const totalInvestedValueBRL = interim
    .filter((i) => i.asset.assetClass !== "EMERGENCY_RESERVE")
    .reduce((sum, i) => sum + i.currentValueBRL, 0);

  const totalCostBasisBRL = interim
    .filter((i) => i.asset.assetClass !== "EMERGENCY_RESERVE")
    .reduce((sum, i) => sum + i.investedCostBRL, 0);

  const emergencyReserveBRL = interim
    .filter((i) => i.asset.assetClass === "EMERGENCY_RESERVE")
    .reduce((sum, i) => sum + i.currentValueBRL, 0);

  const totalProfitLossBRL = totalInvestedValueBRL - totalCostBasisBRL;
  const totalProfitLossPct =
    totalCostBasisBRL > EPSILON
      ? (totalProfitLossBRL / totalCostBasisBRL) * 100
      : 0;

  const assetSummaries: AssetSummary[] = interim.map((item) => {
    const isReserve = item.asset.assetClass === "EMERGENCY_RESERVE";
    const actualPct =
      !isReserve && totalInvestedValueBRL > EPSILON
        ? (item.currentValueBRL / totalInvestedValueBRL) * 100
        : 0;
    const diffPct = isReserve ? 0 : actualPct - item.globalTargetPct;
    const targetValueBRL =
      isReserve ? 0 : (item.globalTargetPct / 100) * totalInvestedValueBRL;
    const balanceNeededBRL = isReserve
      ? 0
      : targetValueBRL - item.currentValueBRL;

    const maturityIso =
      item.asset.maturityDate instanceof Date
        ? item.asset.maturityDate.toISOString().slice(0, 10)
        : typeof item.asset.maturityDate === "string" &&
            item.asset.maturityDate.length > 0
          ? item.asset.maturityDate.slice(0, 10)
          : null;

    return {
      id: item.asset.id,
      ticker: item.asset.ticker,
      assetClass: item.asset.assetClass,
      sector: item.asset.sector,
      currency: item.asset.currency,
      priceMode: item.asset.priceMode,
      manualPrice: item.asset.manualPrice,
      isActive: item.asset.isActive,
      fixedIncomeIndex: item.asset.fixedIncomeIndex ?? null,
      fixedIncomeRate: item.asset.fixedIncomeRate ?? null,
      maturityDate: maturityIso,
      taxExempt: Boolean(item.asset.taxExempt),
      targetPctInClass: item.asset.targetPctInClass,
      globalTargetPct: item.globalTargetPct,
      quantity: item.pos.quantity,
      avgPriceNative: item.pos.avgPrice,
      investedCostNative: item.pos.investedCost,
      investedCostBRL: item.investedCostBRL,
      currentPriceNative: item.currentPriceNative,
      currentPriceBRL: item.currentPriceBRL,
      currentValueBRL: item.currentValueBRL,
      profitLossBRL: item.profitLossBRL,
      profitLossPct: item.profitLossPct,
      actualPct,
      diffPct,
      balanceNeededBRL,
      quoteUpdatedAt: item.quoteUpdatedAt,
    };
  });

  const classes: ClassSummary[] = INVESTMENT_CLASSES.map((assetClass) => {
    const classAssets = assetSummaries.filter(
      (a) => a.assetClass === assetClass
    );
    const classSectorGoals = sectorGoals.filter(
      (sg) => sg.assetClass === assetClass
    );
    const currentValueBRL = classAssets.reduce(
      (sum, a) => sum + a.currentValueBRL,
      0
    );
    const investedCostBRL = classAssets.reduce(
      (sum, a) => sum + a.investedCostBRL,
      0
    );
    const targetPct = derivedTargets[assetClass];
    const actualPct =
      totalInvestedValueBRL > EPSILON
        ? (currentValueBRL / totalInvestedValueBRL) * 100
        : 0;
    const diffPct = actualPct - targetPct;
    const balanceNeededBRL =
      (targetPct / 100) * totalInvestedValueBRL - currentValueBRL;
    const targetSumInClass = classAssets
      .filter((a) => a.isActive)
      .reduce((sum, a) => sum + a.targetPctInClass, 0);
    const sectorGoalSumInClass = classSectorGoals.reduce(
      (sum, sg) => sum + sg.targetPct,
      0
    );

    return {
      assetClass,
      label: ASSET_CLASS_LABELS[assetClass],
      targetPct,
      actualPct,
      currentValueBRL,
      investedCostBRL,
      diffPct,
      balanceNeededBRL,
      targetSumInClass: round2(targetSumInClass),
      hasSectorGoals: classSectorGoals.length > 0,
      sectorGoalSumInClass: round2(sectorGoalSumInClass),
    };
  });

  const classMap = new Map(classes.map((c) => [c.assetClass, c]));
  const fiVal = classMap.get("FIXED_INCOME")?.currentValueBRL ?? 0;
  const brStockVal = classMap.get("BR_STOCK")?.currentValueBRL ?? 0;
  const brFiiVal = classMap.get("BR_FII")?.currentValueBRL ?? 0;
  const usStockVal = classMap.get("US_STOCK")?.currentValueBRL ?? 0;
  const usReitVal = classMap.get("US_REIT")?.currentValueBRL ?? 0;

  const viVal = brStockVal + brFiiVal + usStockVal + usReitVal;
  const brVal = brStockVal + brFiiVal;
  const usVal = usStockVal + usReitVal;

  const pctOf = (part: number, whole: number) =>
    whole > EPSILON ? (part / whole) * 100 : 0;

  const hierarchy: HierarchyRow[] = [
    {
      key: "FIXED_INCOME",
      label: "Renda Fixa",
      group: "MACRO",
      targetPct: goal.fixedIncomePct,
      actualPct: pctOf(fiVal, totalInvestedValueBRL),
      diffPct: pctOf(fiVal, totalInvestedValueBRL) - goal.fixedIncomePct,
    },
    {
      key: "VARIABLE_INCOME",
      label: "Renda Variável",
      group: "MACRO",
      targetPct: goal.variableIncomePct,
      actualPct: pctOf(viVal, totalInvestedValueBRL),
      diffPct: pctOf(viVal, totalInvestedValueBRL) - goal.variableIncomePct,
    },
    {
      key: "BRAZIL",
      label: "Brasil",
      group: "REGION",
      targetPct: goal.brazilPct,
      actualPct: pctOf(brVal, viVal),
      diffPct: pctOf(brVal, viVal) - goal.brazilPct,
    },
    {
      key: "USA",
      label: "EUA",
      group: "REGION",
      targetPct: goal.usaPct,
      actualPct: pctOf(usVal, viVal),
      diffPct: pctOf(usVal, viVal) - goal.usaPct,
    },
    {
      key: "BR_STOCK",
      label: "Ações",
      group: "BR",
      targetPct: goal.brStocksPct,
      actualPct: pctOf(brStockVal, brVal),
      diffPct: pctOf(brStockVal, brVal) - goal.brStocksPct,
    },
    {
      key: "BR_FII",
      label: "FIIs",
      group: "BR",
      targetPct: goal.brFiisPct,
      actualPct: pctOf(brFiiVal, brVal),
      diffPct: pctOf(brFiiVal, brVal) - goal.brFiisPct,
    },
    {
      key: "US_STOCK",
      label: "Stocks",
      group: "US",
      targetPct: goal.usStocksPct,
      actualPct: pctOf(usStockVal, usVal),
      diffPct: pctOf(usStockVal, usVal) - goal.usStocksPct,
    },
    {
      key: "US_REIT",
      label: "REITs",
      group: "US",
      targetPct: goal.usReitsPct,
      actualPct: pctOf(usReitVal, usVal),
      diffPct: pctOf(usReitVal, usVal) - goal.usReitsPct,
    },
  ];

  // Sector aggregation per investment class (seeded with explicit SectorGoals)
  const sectorMap = new Map<string, SectorSummary>();

  for (const sg of sectorGoals) {
    const key = `${sg.assetClass}::${sg.name}`;
    sectorMap.set(key, {
      id: sg.id,
      assetClass: sg.assetClass,
      sector: sg.name,
      currentValueBRL: 0,
      goalTargetPct: round2(sg.targetPct),
      targetPctInClass: 0,
      actualPctInClass: 0,
      activeAssetCount: 0,
      totalAssetCount: 0,
      assetTickers: [],
      diffFromGoalPct: null,
      status: "EXACT",
    });
  }

  for (const a of assetSummaries) {
    if (a.assetClass === "EMERGENCY_RESERVE") continue;
    const key = `${a.assetClass}::${a.sector}`;
    const existing = sectorMap.get(key);

    if (!existing && !a.isActive && a.currentValueBRL <= EPSILON) {
      continue;
    }

    const classTotal = classMap.get(a.assetClass)?.currentValueBRL ?? 0;

    if (existing) {
      existing.currentValueBRL += a.currentValueBRL;
      existing.totalAssetCount += 1;
      if (a.isActive) {
        existing.targetPctInClass += a.targetPctInClass;
        existing.activeAssetCount += 1;
        existing.assetTickers.push(a.ticker);
      }
      existing.actualPctInClass = pctOf(existing.currentValueBRL, classTotal);
    } else {
      sectorMap.set(key, {
        id: null,
        assetClass: a.assetClass,
        sector: a.sector,
        currentValueBRL: a.currentValueBRL,
        goalTargetPct: null,
        targetPctInClass: a.isActive ? a.targetPctInClass : 0,
        actualPctInClass: pctOf(a.currentValueBRL, classTotal),
        activeAssetCount: a.isActive ? 1 : 0,
        totalAssetCount: 1,
        assetTickers: a.isActive ? [a.ticker] : [],
        diffFromGoalPct: null,
        status: "UNTRACKED",
      });
    }
  }

  const sectors = Array.from(sectorMap.values())
    .map((s) => {
      const targetPctInClass = round2(s.targetPctInClass);
      let diffFromGoalPct: number | null = null;
      let status: SectorCoverageStatus = "UNTRACKED";

      if (s.goalTargetPct !== null) {
        diffFromGoalPct = round2(targetPctInClass - s.goalTargetPct);
        if (s.goalTargetPct > 0 && s.activeAssetCount === 0) {
          status = "UNCOVERED";
        } else if (Math.abs(diffFromGoalPct) <= 0.05) {
          status = "EXACT";
        } else if (diffFromGoalPct < 0) {
          status = "UNDER";
        } else {
          status = "OVER";
        }
      }

      return {
        ...s,
        targetPctInClass,
        diffFromGoalPct,
        status,
      };
    })
    .sort((a, b) => {
      if (Math.abs(b.currentValueBRL - a.currentValueBRL) > EPSILON) {
        return b.currentValueBRL - a.currentValueBRL;
      }
      const aGoal = a.goalTargetPct ?? 0;
      const bGoal = b.goalTargetPct ?? 0;
      if (Math.abs(bGoal - aGoal) > EPSILON) {
        return bGoal - aGoal;
      }
      return a.sector.localeCompare(b.sector, "pt-BR");
    });

  return {
    usdBrl,
    usdBrlUpdatedAt,
    totalInvestedValueBRL,
    totalCostBasisBRL,
    totalProfitLossBRL,
    totalProfitLossPct,
    emergencyReserveBRL,
    grandTotalBRL: totalInvestedValueBRL + emergencyReserveBRL,
    classes,
    hierarchy,
    assets: assetSummaries,
    sectors,
  };
}

export function computeContributionPlan(params: {
  summary: PortfolioSummary;
  amountBRL: number;
  maxAssets: number;
  ignoredClasses?: InvestmentClassKey[];
  ignoredTickers?: string[];
}): ContributionPlanResult {
  const {
    summary,
    amountBRL,
    maxAssets,
    ignoredClasses = [],
    ignoredTickers = [],
  } = params;

  const safeAmount = Math.max(0, amountBRL);
  const safeMax = Math.max(1, Math.min(20, Math.floor(maxAssets)));
  const ignoredClassSet = new Set<string>(ignoredClasses);
  const ignoredTickerSet = new Set(
    ignoredTickers.map((t) => t.trim().toUpperCase())
  );

  // Target value after injecting the new contribution
  const futureTotalBRL = summary.totalInvestedValueBRL + safeAmount;

  const classNeedMap = new Map<InvestmentClassKey, number>();
  for (const c of summary.classes) {
    const futureClassTarget = (c.targetPct / 100) * futureTotalBRL;
    classNeedMap.set(c.assetClass, futureClassTarget - c.currentValueBRL);
  }

  // Eligible active investment assets with a valid price and positive target
  const candidates = summary.assets
    .filter((a): a is AssetSummary & { assetClass: InvestmentClassKey } => {
      if (a.assetClass === "EMERGENCY_RESERVE") return false;
      if (!a.isActive) return false;
      if (a.globalTargetPct <= 0) return false;
      if (a.currentPriceBRL <= 0) return false;
      if (ignoredClassSet.has(a.assetClass)) return false;
      if (ignoredTickerSet.has(a.ticker.toUpperCase())) return false;
      return true;
    })
    .map((a) => {
      const futureAssetTarget = (a.globalTargetPct / 100) * futureTotalBRL;
      const neededBRL = futureAssetTarget - a.currentValueBRL;
      const classNeed = classNeedMap.get(a.assetClass) ?? 0;
      return {
        asset: a,
        neededBRL,
        classNeed,
      };
    })
    .filter((item) => item.neededBRL > 0);

  // Prioritize classes that are most under-allocated, then assets most under-allocated
  candidates.sort((a, b) => {
    const aClassDeficit = a.classNeed > 0 ? 1 : 0;
    const bClassDeficit = b.classNeed > 0 ? 1 : 0;
    if (aClassDeficit !== bClassDeficit) return bClassDeficit - aClassDeficit;
    if (Math.abs(b.classNeed - a.classNeed) > 1) {
      return b.classNeed - a.classNeed;
    }
    return b.neededBRL - a.neededBRL;
  });

  // Select up to maxAssets, ensuring we don't starve other under-allocated classes
  const selected = candidates.slice(0, safeMax);

  let bucket = safeAmount;
  const suggestions: ContributionSuggestion[] = [];

  for (let i = 0; i < selected.length; i++) {
    const { asset, neededBRL } = selected[i];
    const isFractional =
      asset.assetClass === "US_STOCK" ||
      asset.assetClass === "US_REIT" ||
      asset.assetClass === "FIXED_INCOME";

    const unitPriceBRL = asset.currentPriceBRL;
    const minAmountBRL =
      asset.assetClass === "US_STOCK" || asset.assetClass === "US_REIT"
        ? US_MIN_INVEST_USD * summary.usdBrl
        : asset.assetClass === "FIXED_INCOME"
          ? 1
          : unitPriceBRL;

    let investBRL = 0;

    if (bucket >= minAmountBRL) {
      const remainingCount = selected.length - i;
      const targetForAsset = isFractional
        ? Math.max(neededBRL, minAmountBRL)
        : Math.max(Math.floor(neededBRL / unitPriceBRL) * unitPriceBRL, unitPriceBRL);

      if (bucket >= targetForAsset) {
        // Also distribute surplus proportionally if this is one of the last items
        const remainingNeededSum = selected
          .slice(i + 1)
          .reduce((sum, s) => sum + Math.max(0, s.neededBRL), 0);
        const surplus = Math.max(0, bucket - targetForAsset - remainingNeededSum);
        const extraShare = surplus / remainingCount;

        if (isFractional) {
          investBRL = Math.min(bucket, targetForAsset + extraShare);
        } else {
          const extraUnits = Math.floor(extraShare / unitPriceBRL);
          investBRL = Math.min(
            bucket,
            targetForAsset + extraUnits * unitPriceBRL
          );
          investBRL = Math.floor(investBRL / unitPriceBRL) * unitPriceBRL;
        }
      } else {
        investBRL = isFractional
          ? bucket
          : Math.floor(bucket / unitPriceBRL) * unitPriceBRL;
      }
    }

    // Round neatly
    if (isFractional) {
      investBRL = round2(investBRL);
    } else {
      investBRL = round2(Math.floor(investBRL / unitPriceBRL) * unitPriceBRL);
    }

    bucket = Math.max(0, round2(bucket - investBRL));

    const suggestedQty =
      unitPriceBRL > EPSILON
        ? isFractional
          ? Number((investBRL / unitPriceBRL).toFixed(6))
          : Math.round(investBRL / unitPriceBRL)
        : 0;

    const investUSD =
      summary.usdBrl > EPSILON ? round2(investBRL / summary.usdBrl) : 0;

    suggestions.push({
      assetId: asset.id,
      ticker: asset.ticker,
      assetClass: asset.assetClass,
      currency: asset.currency,
      neededBRL: round2(neededBRL),
      unitPriceBRL: round2(unitPriceBRL),
      unitPriceNative: asset.currentPriceNative,
      investBRL,
      investUSD,
      suggestedQty,
      isFractional,
    });
  }

  const totalAllocatedBRL = round2(
    suggestions.reduce((sum, s) => sum + s.investBRL, 0)
  );

  return {
    amountBRL: round2(safeAmount),
    totalAllocatedBRL,
    remainingBRL: round2(Math.max(0, safeAmount - totalAllocatedBRL)),
    usdBrl: summary.usdBrl,
    suggestions,
  };
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
