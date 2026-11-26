import type {
  MonthlyAllocationKindKey,
  MonthlyExpenseCategoryKey,
} from "./monthly-budget";
import {
  type EmergencyReserveScenario,
  roundMoney,
} from "./savings";

export interface ParsedSheetSavingsGoal {
  name: string;
  targetAmount: number | null;
  targetDate: string | null; // "YYYY-MM-DD"
  isEmergencyReserve: boolean;
  isClosed: boolean;
  sortOrder: number;
}

export interface ParsedSheetSavingsMovement {
  externalKey: string;
  goalName: string;
  vehicleName: string;
  date: string; // "YYYY-MM-DD"
  type: "DEPOSIT" | "WITHDRAWAL";
  signedAmount: number;
}

export interface ParsedInvestimentosGeral {
  goals: ParsedSheetSavingsGoal[];
  vehicles: string[];
  movements: ParsedSheetSavingsMovement[];
  reserveCalculator: {
    monthlyExpenseBRL: number;
    scenarios: EmergencyReserveScenario[];
  } | null;
}

export interface ParsedMonthlyBudgetSheet {
  year: number;
  month: number;
  reportDate: string; // "YYYY-MM-DD"
  checkingBalance: number;
  incomes: Array<{
    name: string;
    amount: number;
    isReceived: boolean;
    isRecurring: boolean;
    sortOrder: number;
  }>;
  expenses: Array<{
    name: string;
    category: MonthlyExpenseCategoryKey;
    amount: number;
    isUnexpected: boolean;
    isPaid: boolean;
    isRecurring: boolean;
    sortOrder: number;
  }>;
  allocations: Array<{
    kind: MonthlyAllocationKindKey;
    name: string;
    goalName: string | null;
    amount: number;
    isExecuted: boolean;
    isRecurring: boolean;
    sortOrder: number;
  }>;
}

export function parseCsvRows(csvText: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  const text = csvText.replace(/^\uFEFF/, "");

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field.trim());
      field = "";
    } else if (ch === "\n") {
      row.push(field.trim());
      rows.push(row);
      row = [];
      field = "";
    } else if (ch === "\r") {
      // ignore CR in CRLF
    } else {
      field += ch;
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field.trim());
    rows.push(row);
  }

  return rows;
}

export function parseBrMoney(raw: string | undefined | null): number | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed || /^n\/a$/i.test(trimmed) || trimmed === "-") return null;

  const isNegative =
    trimmed.includes("-") || (trimmed.startsWith("(") && trimmed.endsWith(")"));
  const cleaned = trimmed
    .replace(/R\$/gi, "")
    .replace(/[()%\s-]/g, "")
    .trim();
  if (!cleaned) return null;

  const hasComma = cleaned.includes(",");
  const hasDot = cleaned.includes(".");
  let normalized = cleaned;
  if (hasComma && hasDot) {
    normalized = cleaned.replace(/\./g, "").replace(",", ".");
  } else if (hasComma) {
    normalized = cleaned.replace(",", ".");
  } else if (hasDot && /^\d{1,3}(\.\d{3})+$/.test(cleaned)) {
    normalized = cleaned.replace(/\./g, "");
  }

  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) return null;
  const signed = isNegative ? -Math.abs(parsed) : parsed;
  return roundMoney(signed);
}

export function parseSheetDateToIso(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed || /^n\/a$/i.test(trimmed)) return null;

  const isoMatch = /^(\d{4})-(\d{2})-(\d{2})/.exec(trimmed);
  if (isoMatch) {
    return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
  }

  const brMatch = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(trimmed);
  if (brMatch) {
    const day = brMatch[1].padStart(2, "0");
    const month = brMatch[2].padStart(2, "0");
    const year = brMatch[3];
    return `${year}-${month}-${day}`;
  }

  return null;
}

function normalizeText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function mapExpenseCategory(raw: string | undefined): MonthlyExpenseCategoryKey {
  const norm = normalizeText(raw ?? "");
  if (norm.includes("variavel")) return "VARIABLE";
  if (norm.includes("investimento")) return "INVESTMENT";
  if (norm.includes("imposto")) return "TAX";
  return "BILL";
}

export function parseInvestimentosGeralCsv(
  csvText: string
): ParsedInvestimentosGeral {
  const rows = parseCsvRows(csvText);
  const goalsByNormName = new Map<string, ParsedSheetSavingsGoal>();
  const vehiclesSet = new Set<string>();
  const movements: ParsedSheetSavingsMovement[] = [];

  // 1. Active goals table (Cols A..H, rows starting at index 1 until "Total")
  let sortOrder = 0;
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const name = (row[0] ?? "").trim();
    if (!name) continue;
    const norm = normalizeText(name);
    if (norm === "total" || norm.startsWith("planos de financiamento")) break;

    const targetAmount = parseBrMoney(row[1]);
    const targetDate = parseSheetDateToIso(row[2]);
    const isClosed = normalizeText(row[7] ?? "") === "true";
    const isEmergencyReserve = norm.includes("reserva de emergencia");

    goalsByNormName.set(norm, {
      name,
      targetAmount: targetAmount !== null && targetAmount > 0 ? targetAmount : null,
      targetDate,
      isEmergencyReserve,
      isClosed,
      sortOrder: sortOrder++,
    });
  }

  // 2. Movements ledger (Cols J..M => indices 9..12, rows >= 1)
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const goalName = (row[9] ?? "").trim();
    const vehicleName = (row[10] ?? "").trim();
    const dateIso = parseSheetDateToIso(row[11]);
    const amount = parseBrMoney(row[12]);

    if (!goalName || !vehicleName || !dateIso || amount === null || Math.abs(amount) < 0.005) {
      continue;
    }

    vehiclesSet.add(vehicleName);
    const normGoal = normalizeText(goalName);
    if (!goalsByNormName.has(normGoal)) {
      goalsByNormName.set(normGoal, {
        name: goalName,
        targetAmount: null,
        targetDate: null,
        isEmergencyReserve: normGoal.includes("reserva de emergencia"),
        isClosed: true,
        sortOrder: sortOrder++,
      });
    }

    const canonicalGoalName = goalsByNormName.get(normGoal)!.name;
    movements.push({
      externalKey: `sheet:investimentos-geral:row-${r + 1}`,
      goalName: canonicalGoalName,
      vehicleName,
      date: dateIso,
      type: amount >= 0 ? "DEPOSIT" : "WITHDRAWAL",
      signedAmount: amount,
    });
  }

  // 3. Emergency Reserve Calculator block (Cols D..E => indices 3..4)
  let monthlyExpenseBRL: number | null = null;
  const scenarios: EmergencyReserveScenario[] = [];
  let inReserveCalc = false;

  for (let r = 0; r < rows.length; r++) {
    const row = rows[r];
    const colD = (row[3] ?? "").trim();
    const colE = (row[4] ?? "").trim();
    const normD = normalizeText(colD);

    if (normD.includes("calculo de reserva de emergencia")) {
      inReserveCalc = true;
      continue;
    }
    if (!inReserveCalc) continue;
    if (normD.includes("valor maximo da reserva")) {
      break;
    }

    if (normD.includes("gasto mensal")) {
      monthlyExpenseBRL = parseBrMoney(colE) ?? 0;
      continue;
    }

    const amount = parseBrMoney(colE);
    if (colD && amount !== null && amount > 0) {
      const monthsMatch = /(\d+)\s*mes/i.exec(colD);
      if (monthsMatch && monthlyExpenseBRL && monthlyExpenseBRL > 0) {
        const months = Number(monthsMatch[1]);
        scenarios.push({
          id: `sheet-scenario-${scenarios.length + 1}`,
          label: colD.replace(/^\d+\)\s*/, "").trim(),
          mode: "MONTHS",
          months,
          fixedAmount: null,
        });
      } else {
        scenarios.push({
          id: `sheet-scenario-${scenarios.length + 1}`,
          label: colD.replace(/^\d+\)\s*/, "").trim(),
          mode: "FIXED",
          months: null,
          fixedAmount: amount,
        });
      }
    }
  }

  const reserveCalculator =
    monthlyExpenseBRL !== null && scenarios.length > 0
      ? { monthlyExpenseBRL, scenarios }
      : null;

  return {
    goals: [...goalsByNormName.values()],
    vehicles: [...vehiclesSet].sort((a, b) => a.localeCompare(b, "pt-BR")),
    movements,
    reserveCalculator,
  };
}

export function parseMonthlyBudgetCsv(
  csvText: string,
  year: number,
  month: number
): ParsedMonthlyBudgetSheet {
  const rows = parseCsvRows(csvText);

  const reportDate =
    parseSheetDateToIso(rows[0]?.[1]) ??
    `${year}-${String(month).padStart(2, "0")}-01`;
  const checkingBalance = parseBrMoney(rows[1]?.[1]) ?? 0;

  // Read summary checkpoints from Cols L..M (indices 11..12)
  let cashPlusPendingFromSheet: number | null = null;
  let withdrawFromGoalsAmount = 0;
  let alreadyInvestedFromSheet = 0;

  for (let r = 0; r < rows.length; r++) {
    const label = normalizeText(rows[r]?.[11] ?? "");
    const value = parseBrMoney(rows[r]?.[12]);
    if (label.includes("na conta + para receber") && value !== null) {
      cashPlusPendingFromSheet = value;
    } else if (label.includes("para sacar de objetivos") && value !== null) {
      withdrawFromGoalsAmount = Math.max(0, value);
    } else if (label === "ja investido" && value !== null) {
      alreadyInvestedFromSheet = Math.max(0, value);
    }
  }

  // 1. Incomes (Cols A..B => indices 0..1, rows >= 3)
  const incomes: ParsedMonthlyBudgetSheet["incomes"] = [];
  for (let r = 3; r < rows.length; r++) {
    const name = (rows[r]?.[0] ?? "").trim();
    const amount = parseBrMoney(rows[r]?.[1]);
    if (!name || amount === null) continue;
    const norm = normalizeText(name);
    const isRecurring =
      norm.includes("remuneracao") || norm.includes("venda acoes");
    incomes.push({
      name,
      amount: Math.max(0, amount),
      isReceived: false,
      isRecurring,
      sortOrder: incomes.length,
    });
  }

  // Infer received incomes if cashPlusPendingFromSheet is lower than checking + all incomes
  if (cashPlusPendingFromSheet !== null) {
    const totalIncome = roundMoney(incomes.reduce((s, i) => s + i.amount, 0));
    const expectedIfAllPending = roundMoney(checkingBalance + totalIncome);
    let alreadyReceivedDelta = roundMoney(
      expectedIfAllPending - cashPlusPendingFromSheet
    );
    if (alreadyReceivedDelta > 0.01) {
      for (const inc of incomes) {
        if (inc.amount > 0 && inc.amount <= alreadyReceivedDelta + 0.01) {
          inc.isReceived = true;
          alreadyReceivedDelta = roundMoney(alreadyReceivedDelta - inc.amount);
        }
      }
    }
  }

  // 2. Expenses (Cols D..F => indices 3..5, rows >= 3)
  const regularExpenses: ParsedMonthlyBudgetSheet["expenses"] = [];
  const unexpectedExpenses: ParsedMonthlyBudgetSheet["expenses"] = [];
  const paidLookup = new Map<string, number>(); // normName::amount -> count

  let section: "REGULAR" | "UNEXPECTED" | "PAID" = "REGULAR";
  for (let r = 3; r < rows.length; r++) {
    const name = (rows[r]?.[3] ?? "").trim();
    const catRaw = (rows[r]?.[4] ?? "").trim();
    const amount = parseBrMoney(rows[r]?.[5]);
    const normName = normalizeText(name);

    if (normName.includes("outros / inesperados")) {
      section = "UNEXPECTED";
      continue;
    }
    if (normName === "ja pago") {
      section = "PAID";
      continue;
    }
    if (!name || amount === null) continue;

    if (section === "PAID") {
      const key = `${normName}::${roundMoney(amount)}`;
      paidLookup.set(key, (paidLookup.get(key) ?? 0) + 1);
      continue;
    }

    const item = {
      name,
      category: mapExpenseCategory(catRaw),
      amount: Math.max(0, amount),
      isUnexpected: section === "UNEXPECTED",
      isPaid: false,
      isRecurring: section === "REGULAR",
      sortOrder: 0,
    };

    if (section === "REGULAR") {
      regularExpenses.push(item);
    } else {
      unexpectedExpenses.push(item);
    }
  }

  const expenses = [...regularExpenses, ...unexpectedExpenses].map((exp, idx) => {
    const key = `${normalizeText(exp.name)}::${roundMoney(exp.amount)}`;
    const remaining = paidLookup.get(key) ?? 0;
    if (remaining > 0) {
      paidLookup.set(key, remaining - 1);
      return { ...exp, isPaid: true, sortOrder: idx };
    }
    return { ...exp, sortOrder: idx };
  });

  // 3. Allocations (Cols I..J => indices 8..9, rows >= 3)
  const allocations: ParsedMonthlyBudgetSheet["allocations"] = [];
  let remainingAlreadyInvested = alreadyInvestedFromSheet;
  for (let r = 3; r < rows.length; r++) {
    const name = (rows[r]?.[8] ?? "").trim();
    const amount = parseBrMoney(rows[r]?.[9]);
    if (!name || amount === null) continue;

    const norm = normalizeText(name);
    const isLongTerm = norm.includes("longo prazo");
    let isExecuted = false;
    if (amount > 0 && remainingAlreadyInvested >= amount - 0.01) {
      isExecuted = true;
      remainingAlreadyInvested = roundMoney(remainingAlreadyInvested - amount);
    }

    allocations.push({
      kind: isLongTerm ? "LONG_TERM_DEPOSIT" : "SAVINGS_DEPOSIT",
      name,
      goalName: isLongTerm ? null : name,
      amount: Math.max(0, amount),
      isExecuted,
      isRecurring: true,
      sortOrder: allocations.length,
    });
  }

  if (withdrawFromGoalsAmount > 0) {
    allocations.push({
      kind: "SAVINGS_WITHDRAWAL",
      name: "Para sacar de objetivos",
      goalName: null,
      amount: withdrawFromGoalsAmount,
      isExecuted: false,
      isRecurring: false,
      sortOrder: allocations.length,
    });
  }

  return {
    year,
    month,
    reportDate,
    checkingBalance,
    incomes,
    expenses,
    allocations,
  };
}
