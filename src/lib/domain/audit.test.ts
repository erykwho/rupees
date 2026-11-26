import { describe, expect, it } from "vitest";
import {
  type AssetSnapshot,
  type GoalSnapshot,
  type TransactionSnapshot,
  buildEventSummary,
  buildRevertDescription,
  computeAuditDiffs,
  evaluateRevertEligibility,
} from "./audit";

const baseAsset: AssetSnapshot = {
  id: "asset-1",
  ticker: "PETR4",
  assetClass: "BR_STOCK",
  sector: "Petróleo",
  currency: "BRL",
  targetPctInClass: 10,
  priceMode: "AUTO_YAHOO",
  manualPrice: null,
  isActive: true,
};

const baseTx: TransactionSnapshot = {
  id: "tx-1",
  assetId: "asset-1",
  assetTicker: "PETR4",
  assetClass: "BR_STOCK",
  currency: "BRL",
  date: "2026-10-15T12:00:00.000Z",
  type: "BUY",
  quantity: 10,
  unitPrice: 35.5,
  totalAmount: 355,
  notes: "Aporte mensal",
};

const baseGoal: GoalSnapshot = {
  id: "goal-1",
  fixedIncomePct: 10,
  variableIncomePct: 90,
  brazilPct: 60,
  usaPct: 40,
  brStocksPct: 70,
  brFiisPct: 30,
  usStocksPct: 70,
  usReitsPct: 30,
};

describe("computeAuditDiffs", () => {
  it("retorna apenas os campos alterados na edição de um ativo", () => {
    const after: AssetSnapshot = {
      ...baseAsset,
      sector: "Energia",
      targetPctInClass: 15,
    };

    const diffs = computeAuditDiffs("ASSET", baseAsset, after);
    expect(diffs.map((d) => d.key)).toEqual(["sector", "targetPctInClass"]);
    expect(diffs[0]).toMatchObject({
      label: "Setor",
      before: "Petróleo",
      after: "Energia",
    });
    expect(diffs[1]).toMatchObject({
      label: "Meta na classe",
      before: "10,0%",
      after: "15,0%",
    });
  });

  it("inclui contagem de lançamentos em cascata ao excluir um ativo", () => {
    const deletedAsset: AssetSnapshot = {
      ...baseAsset,
      cascadeTransactions: [baseTx],
    };

    const diffs = computeAuditDiffs("ASSET", deletedAsset, null);
    const cascadeField = diffs.find((d) => d.key === "cascadeTransactions");
    expect(cascadeField).toMatchObject({
      label: "Lançamentos vinculados",
      before: "1 lançamento",
      after: null,
    });
  });

  it("mascara campos sensíveis de lançamento quando isPrivate é true", () => {
    const diffs = computeAuditDiffs("TRANSACTION", null, baseTx, {
      isPrivate: true,
    });

    const qty = diffs.find((d) => d.key === "quantity");
    const total = diffs.find((d) => d.key === "totalAmount");
    const ticker = diffs.find((d) => d.key === "assetTicker");

    expect(qty?.after).toBe("••••");
    expect(total?.after).toBe("R$ •••••");
    expect(ticker?.after).toBe("PETR4");
  });

  it("retorna apenas percentuais alterados na edição de objetivos", () => {
    const afterGoal: GoalSnapshot = {
      ...baseGoal,
      fixedIncomePct: 20,
      variableIncomePct: 80,
    };

    const diffs = computeAuditDiffs("GOAL", baseGoal, afterGoal);
    expect(diffs.map((d) => d.key)).toEqual([
      "fixedIncomePct",
      "variableIncomePct",
    ]);
    expect(diffs[0]).toMatchObject({
      label: "Renda Fixa",
      before: "10,0%",
      after: "20,0%",
    });
  });
});

describe("buildEventSummary & buildRevertDescription", () => {
  it("gera resumo legível respeitando modo privacidade", () => {
    const visible = buildEventSummary(
      "TRANSACTION",
      "CREATE",
      "PETR4",
      null,
      baseTx,
      false
    );
    const hidden = buildEventSummary(
      "TRANSACTION",
      "CREATE",
      "PETR4",
      null,
      baseTx,
      true
    );

    expect(visible).toContain("Compra");
    expect(visible).toContain("PETR4");
    expect(visible).toContain("355,00");
    expect(hidden).toContain("••••");
    expect(hidden).not.toContain("355,00");
  });

  it("descreve restauração em cascata ao reverter exclusão de ativo", () => {
    const desc = buildRevertDescription(
      "ASSET",
      { ...baseAsset, cascadeTransactions: [baseTx, { ...baseTx, id: "tx-2" }] },
      null
    );
    expect(desc).toContain("Restaurar o ativo PETR4");
    expect(desc).toContain("2 lançamentos");
  });
});

describe("evaluateRevertEligibility", () => {
  it("bloqueia evento já revertido", () => {
    const res = evaluateRevertEligibility({
      entityType: "ASSET",
      action: "UPDATE",
      beforeState: baseAsset,
      afterState: { ...baseAsset, targetPctInClass: 20 },
      isLatestForEntity: false,
      isReverted: true,
      currentEntityExists: true,
    });
    expect(res.canRevert).toBe(false);
    expect(res.reason).toContain("já foi revertido");
  });

  it("bloqueia quando existe alteração mais recente no mesmo item", () => {
    const res = evaluateRevertEligibility({
      entityType: "ASSET",
      action: "UPDATE",
      beforeState: baseAsset,
      afterState: { ...baseAsset, targetPctInClass: 20 },
      isLatestForEntity: false,
      isReverted: false,
      currentEntityExists: true,
    });
    expect(res.canRevert).toBe(false);
    expect(res.reason).toContain("mais recente");
  });

  it("bloqueia reversão da criação inicial de objetivos", () => {
    const res = evaluateRevertEligibility({
      entityType: "GOAL",
      action: "CREATE",
      beforeState: null,
      afterState: baseGoal,
      isLatestForEntity: true,
      isReverted: false,
      currentEntityExists: true,
    });
    expect(res.canRevert).toBe(false);
    expect(res.reason).toContain("objetivo inicial");
  });

  it("bloqueia reversão de criação de ativo quando há lançamentos vinculados", () => {
    const res = evaluateRevertEligibility({
      entityType: "ASSET",
      action: "CREATE",
      beforeState: null,
      afterState: baseAsset,
      isLatestForEntity: true,
      isReverted: false,
      currentEntityExists: true,
      currentAssetTransactionIds: ["tx-1"],
    });
    expect(res.canRevert).toBe(false);
    expect(res.reason).toContain("lançamentos vinculados");
  });

  it("permite desfazer uma restauração de ativo quando os lançamentos são os mesmos restaurados", () => {
    const res = evaluateRevertEligibility({
      entityType: "ASSET",
      action: "REVERT",
      beforeState: null,
      afterState: { ...baseAsset, cascadeTransactions: [baseTx] },
      isLatestForEntity: true,
      isReverted: false,
      currentEntityExists: true,
      currentAssetTransactionIds: ["tx-1"],
    });
    expect(res.canRevert).toBe(true);
  });

  it("bloqueia desfazer restauração de ativo se novo lançamento foi adicionado depois", () => {
    const res = evaluateRevertEligibility({
      entityType: "ASSET",
      action: "REVERT",
      beforeState: null,
      afterState: { ...baseAsset, cascadeTransactions: [baseTx] },
      isLatestForEntity: true,
      isReverted: false,
      currentEntityExists: true,
      currentAssetTransactionIds: ["tx-1", "tx-2"],
    });
    expect(res.canRevert).toBe(false);
    expect(res.reason).toContain("lançamentos vinculados");
  });

  it("bloqueia restaurar ativo excluído quando há conflito de ticker", () => {
    const res = evaluateRevertEligibility({
      entityType: "ASSET",
      action: "DELETE",
      beforeState: baseAsset,
      afterState: null,
      isLatestForEntity: true,
      isReverted: false,
      currentEntityExists: false,
      tickerConflictExists: true,
    });
    expect(res.canRevert).toBe(false);
    expect(res.reason).toContain("PETR4");
  });

  it("bloqueia restaurar lançamento excluído quando ativo pai não existe", () => {
    const res = evaluateRevertEligibility({
      entityType: "TRANSACTION",
      action: "DELETE",
      beforeState: baseTx,
      afterState: null,
      isLatestForEntity: true,
      isReverted: false,
      currentEntityExists: false,
      parentAssetExists: false,
    });
    expect(res.canRevert).toBe(false);
    expect(res.reason).toContain("não existe mais");
  });

  it("permite reverter exclusão de lançamento quando ativo pai existe", () => {
    const res = evaluateRevertEligibility({
      entityType: "TRANSACTION",
      action: "DELETE",
      beforeState: baseTx,
      afterState: null,
      isLatestForEntity: true,
      isReverted: false,
      currentEntityExists: false,
      parentAssetExists: true,
    });
    expect(res.canRevert).toBe(true);
  });

  it("calcula diffs e bloqueia reversão de SECTOR_GOAL com ativos vinculados ou conflito de nome", () => {
    const beforeSector = {
      id: "sg1",
      assetClass: "BR_STOCK" as const,
      name: "Energia",
      targetPct: 7,
    };
    const afterSector = {
      id: "sg1",
      assetClass: "BR_STOCK" as const,
      name: "Energia Elétrica",
      targetPct: 10,
    };

    const diffs = computeAuditDiffs("SECTOR_GOAL", beforeSector, afterSector);
    expect(diffs.map((d) => d.key)).toEqual(["name", "targetPct"]);

    const summary = buildEventSummary(
      "SECTOR_GOAL",
      "CREATE",
      "Energia (Ação)",
      null,
      beforeSector
    );
    expect(summary).toContain("Novo setor: Energia");

    const blockedDeleteCreate = evaluateRevertEligibility({
      entityType: "SECTOR_GOAL",
      action: "CREATE",
      beforeState: null,
      afterState: beforeSector,
      isLatestForEntity: true,
      isReverted: false,
      currentEntityExists: true,
      sectorHasLinkedAssets: true,
    });
    expect(blockedDeleteCreate.canRevert).toBe(false);
    expect(blockedDeleteCreate.reason).toContain("ativos vinculados");

    const blockedConflict = evaluateRevertEligibility({
      entityType: "SECTOR_GOAL",
      action: "DELETE",
      beforeState: beforeSector,
      afterState: null,
      isLatestForEntity: true,
      isReverted: false,
      currentEntityExists: false,
      sectorNameConflictExists: true,
    });
    expect(blockedConflict.canRevert).toBe(false);
    expect(blockedConflict.reason).toContain("Energia");

    const allowedUpdateRevert = evaluateRevertEligibility({
      entityType: "SECTOR_GOAL",
      action: "UPDATE",
      beforeState: beforeSector,
      afterState: afterSector,
      isLatestForEntity: true,
      isReverted: false,
      currentEntityExists: true,
      sectorNameConflictExists: false,
    });
    expect(allowedUpdateRevert.canRevert).toBe(true);
  });

  it("gera diffs, resumos mascarados e regras de reversão para SAVINGS_GOAL e SAVINGS_MOVEMENT (incluindo transferência)", () => {
    const goalBefore = {
      id: "sg-1",
      name: "Reserva de Emergência",
      targetAmount: 100000,
      targetDate: "2028-07-01",
      isEmergencyReserve: true,
      isClosed: false,
      sortOrder: 0,
    };
    const goalAfter = {
      ...goalBefore,
      targetAmount: 120000,
      isClosed: false,
    };

    const goalDiffs = computeAuditDiffs("SAVINGS_GOAL", goalBefore, goalAfter, {
      isPrivate: true,
    });
    expect(goalDiffs).toHaveLength(1);
    expect(goalDiffs[0]).toMatchObject({
      key: "targetAmount",
      before: "R$ •••••",
      after: "R$ •••••",
      sensitive: true,
    });

    const blockedGoalCreateRevert = evaluateRevertEligibility({
      entityType: "SAVINGS_GOAL",
      action: "CREATE",
      beforeState: null,
      afterState: goalAfter,
      isLatestForEntity: true,
      isReverted: false,
      currentEntityExists: true,
      savingsGoalHasMovements: true,
    });
    expect(blockedGoalCreateRevert.canRevert).toBe(false);
    expect(blockedGoalCreateRevert.reason).toContain("movimentações");

    const transferSnap = {
      id: "mov-out",
      goalId: "sg-1",
      goalName: "Fundo Gatos",
      vehicleId: "v-1",
      vehicleName: "Tesouro Selic 2031",
      date: "2026-10-01T12:00:00.000Z",
      type: "TRANSFER_OUT" as const,
      signedAmount: -500,
      transferGroupId: "tr-1",
      notes: "Remanejamento",
      counterpart: {
        id: "mov-in",
        goalId: "sg-2",
        goalName: "Fundo reforma",
        vehicleId: "v-1",
        vehicleName: "Tesouro Selic 2031",
        date: "2026-10-01T12:00:00.000Z",
        type: "TRANSFER_IN" as const,
        signedAmount: 500,
        transferGroupId: "tr-1",
        notes: "Remanejamento",
      },
    };

    const summary = buildEventSummary(
      "SAVINGS_MOVEMENT",
      "CREATE",
      "Fundo Gatos → Fundo reforma",
      null,
      transferSnap
    );
    expect(summary).toContain("Transferência: Fundo Gatos → Fundo reforma");

    const desc = buildRevertDescription("SAVINGS_MOVEMENT", null, transferSnap);
    expect(desc).toContain("Fundo Gatos");
    expect(desc).toContain("Fundo reforma");

    const blockedRestoreMissingParent = evaluateRevertEligibility({
      entityType: "SAVINGS_MOVEMENT",
      action: "DELETE",
      beforeState: transferSnap,
      afterState: null,
      isLatestForEntity: true,
      isReverted: false,
      currentEntityExists: false,
      savingsParentsExist: false,
    });
    expect(blockedRestoreMissingParent.canRevert).toBe(false);
  });
});

