import { describe, expect, it } from "vitest";
import {
  parseBrMoney,
  parseInvestimentosGeralCsv,
  parseMonthlyBudgetCsv,
  parseSheetDateToIso,
} from "./financial-sheet-import";

describe("financial-sheet-import CSV parsers", () => {
  it("parses Brazilian money formats and dates safely", () => {
    expect(parseBrMoney("R$ 24.000,00")).toBe(24000);
    expect(parseBrMoney("-R$ 7.000,00")).toBe(-7000);
    expect(parseBrMoney("R$ -1.234,56")).toBe(-1234.56);
    expect(parseBrMoney("n/a")).toBeNull();
    expect(parseSheetDateToIso("01/07/2028")).toBe("2028-07-01");
    expect(parseSheetDateToIso("2026-11-10")).toBe("2026-11-10");
    expect(parseSheetDateToIso("n/a")).toBeNull();
  });

  it("parses Investimentos - Geral goals, closed ledger goals, vehicles, movements, and reserve calculator", () => {
    const csv = [
      "Objetivo,Valor,Data,Quantos meses falta,Quanto já tem,Quanto falta,Valor por mês,Fechado?,,Objetivo,Investimento,Data,Aporte",
      'Reserva de Emergência,"R$ 100.000,00",01/07/2028,19,"R$ 10.000,00","R$ 90.000,00","R$ 4.736,84",FALSE,,Reserva de Emergência,Tesouro Selic 2031,10/01/2026,"R$ 10.000,00"',
      'Fundo Livre,n/a,n/a,,"R$ 500,00",,,FALSE,,Fundo Livre,CDB Inter,15/02/2026,"R$ 500,00"',
      'Total,,,,"R$ 10.500,00","R$ 90.000,00","R$ 4.736,84",,,Meta Antiga,CDB Inter,01/01/2025,"R$ 2.000,00"',
      ',,,,,,,,,Meta Antiga,CDB Inter,01/06/2025,"-R$ 2.000,00"',
      ",,,Cálculo de reserva de emergência,,,,,,,,,",
      ',,,Gasto mensal,"R$ 10.000,00",,,,,,,,',
      ',,,1) Desemprego: 6 meses sem renda,"R$ 60.000,00",,,,,,,,',
      ',,,2) Emergências médicas,"R$ 80.000,00",,,,,,,,',
      ',,,Valor máximo da reserva,"R$ 80.000,00",,,,,,,,',
    ].join("\n");

    const parsed = parseInvestimentosGeralCsv(csv);
    expect(parsed.goals).toHaveLength(3);
    expect(parsed.goals[0]).toMatchObject({
      name: "Reserva de Emergência",
      targetAmount: 100000,
      targetDate: "2028-07-01",
      isEmergencyReserve: true,
      isClosed: false,
    });
    expect(parsed.goals[1]).toMatchObject({
      name: "Fundo Livre",
      targetAmount: null,
      targetDate: null,
      isClosed: false,
    });
    expect(parsed.goals[2]).toMatchObject({
      name: "Meta Antiga",
      isClosed: true,
    });
    expect(parsed.vehicles).toEqual(["CDB Inter", "Tesouro Selic 2031"]);
    expect(parsed.movements).toHaveLength(4);
    expect(parsed.movements[3]).toMatchObject({
      type: "WITHDRAWAL",
      signedAmount: -2000,
    });
    expect(parsed.reserveCalculator).toMatchObject({
      monthlyExpenseBRL: 10000,
      scenarios: [
        { mode: "MONTHS", months: 6 },
        { mode: "FIXED", fixedAmount: 80000 },
      ],
    });
  });

  it("parses monthly tab with received inference, unexpected expenses, paid matching, and withdrawals", () => {
    const csv = [
      "Data do relatório,2026-10-30,,,,,,,,,,,",
      'Conta corrente,"R$ 1.000,00",,,,,,,,,,,',
      "Receitas,,,Despesas,,,,,Objetivos e Investimentos,,,Totais,",
      ',,,Aluguel,Conta,"R$ 3.000,00",50%,,Longo prazo,"R$ 500,00",,Total Receita,"R$ 10.000,00"',
      'Remuneração meio mes,"R$ 4.000,00",,DARF,Imposto,"R$ 1.000,00",16%,,Reserva de Emergência,"R$ 500,00",,Total Receita Líquida,"R$ 9.000,00"',
      'Remuneração fim do mês,"R$ 6.000,00",,,,,,,,,,Na conta + para receber,"R$ 7.000,00"',
      ',,,,,,,,,,,Para sacar de objetivos,"R$ 2.000,00"',
      ",,,Outros / Inesperados,,,,,,,,,Já investido,\"R$ 0,00\"",
      ',,,Reforma extra,Conta,"R$ 2.000,00",,,,,,,',
      ",,,Já pago,,,,,,,,,",
      ',,,Reforma extra,Conta,"R$ 2.000,00",,,,,,,',
    ].join("\n");

    const parsed = parseMonthlyBudgetCsv(csv, 2026, 10);
    expect(parsed.reportDate).toBe("2026-10-30");
    expect(parsed.checkingBalance).toBe(1000);
    expect(parsed.incomes).toHaveLength(2);
    // checking(1000) + 4000 + 6000 = 11000, sheet says 7000 -> first income (4000) already received!
    expect(parsed.incomes[0].isReceived).toBe(true);
    expect(parsed.incomes[1].isReceived).toBe(false);

    expect(parsed.expenses).toHaveLength(3);
    expect(parsed.expenses[1].category).toBe("TAX");
    expect(parsed.expenses[2]).toMatchObject({
      name: "Reforma extra",
      isUnexpected: true,
      isPaid: true,
    });

    expect(parsed.allocations).toHaveLength(3);
    expect(parsed.allocations[0].kind).toBe("LONG_TERM_DEPOSIT");
    expect(parsed.allocations[1].kind).toBe("SAVINGS_DEPOSIT");
    expect(parsed.allocations[2]).toMatchObject({
      kind: "SAVINGS_WITHDRAWAL",
      amount: 2000,
    });
  });
});
