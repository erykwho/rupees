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

  it("parses Era 1 legacy tabs (2024-09..2025-01) with bare $ balances, Pago checkboxes, and notes", () => {
    const csv = [
      "Data do relatório,2024-09-27",
      "",
      "Receita,,,Pago,Despesas",
      'Saldo hoje (27/sep)," $ 5.646,11 ",,FALSE,Aluguel," R$  (6.000,00)"',
      'Salário dia 30," $ 5.085,84 ",,TRUE,Parcela Apto Mooca," R$  (2.635,00)"',
      ',,,TRUE,DARF," R$  (1.000,00)"',
      ',,,FALSE,Cartão de Crédito," R$  (9.623,38)"',
      'Total Receita," $ 10.731,95 ",,,Total Despesa," R$  (19.258,38)"',
      'Total," $ (8.526,43)"',
      'Ação," Vender R$ 10000 em GSUs "',
    ].join("\n");

    const parsed = parseMonthlyBudgetCsv(csv, 2024, 9);
    expect(parsed.checkingBalance).toBe(5646.11);
    expect(parsed.notes).toBe("Vender R$ 10000 em GSUs");
    expect(parsed.incomes).toEqual([
      {
        name: "Salário dia 30",
        amount: 5085.84,
        isReceived: false,
        isRecurring: true,
        sortOrder: 0,
      },
    ]);
    expect(parsed.expenses).toMatchObject([
      { name: "Aluguel", category: "BILL", amount: 6000, isPaid: false },
      { name: "Parcela Apto Mooca", category: "INVESTMENT", amount: 2635, isPaid: true },
      { name: "DARF", category: "TAX", amount: 1000, isPaid: true },
      { name: "Cartão de Crédito", category: "VARIABLE", amount: 9623.38, isPaid: false },
    ]);
  });

  it("parses Era 2 transitional tab (2025-02) and solves non-greedy received subset + shortened paid names", () => {
    const feb2025Csv = [
      "Data do relatório,2025-02-28",
      "",
      "Receitas,,,Despesas,,,,,Objetivos e Investimentos,,,Totais",
      'Conta corrente,"R$ 8.348,35",,Aluguel," Conta "," R$  6.101,93 ","23,76%",,Longo prazo,"R$ 1.000,00",,Total Receita,"R$ 28.203,18"',
      'Remuneração fim do mês,"R$ 5.054,83",,Compra de celular," Variável ","R$ 4.800,00","18%",,Reserva de Emergência,"R$ 1.000,00",,Total Despesa,"R$ 6.101,93"',
      'Venda ações fim do mês,"R$ 14.800,00",,,,,,,,,,',
      ",,,Já pago,,,,,,,,,",
      ',,,Celular,,"R$ 4.800,00",,,,,,,',
    ].join("\n");

    const febParsed = parseMonthlyBudgetCsv(feb2025Csv, 2025, 2);
    expect(febParsed.checkingBalance).toBe(8348.35);
    expect(febParsed.incomes).toHaveLength(2);
    expect(febParsed.expenses[1]).toMatchObject({
      name: "Compra de celular",
      isPaid: true,
    });

    // Non-greedy subset-sum test (like june/2026): received = 9415.38 + 23000 + 1000 = 33415.38
    const juneCsv = [
      "Data do relatório,2026-06-22,,,,,,,,,,,",
      'Conta corrente,"R$ 24.009,57",,,,,,,,,,,',
      "Receitas,,,Despesas,,,,,Objetivos e Investimentos,,,Totais,",
      'Remuneração meio mes,"R$ 9.415,38",,,,,,,,,,Total Receita,"R$ 64.472,60"',
      'Remuneração fim do mês,"R$ 6.057,22",,,,,,,,,,Na conta + para receber,"R$ 55.066,79"',
      'Venda ações fim do mês,"R$ 25.000,00",,,,,,,,,,',
      'Título de Capitalização,"R$ 23.000,00",,,,,,,,,,',
      'Reembolso Laura,"R$ 1.000,00",,,,,,,,,,',
    ].join("\n");

    const juneParsed = parseMonthlyBudgetCsv(juneCsv, 2026, 6);
    expect(juneParsed.incomes.map((i) => i.isReceived)).toEqual([
      true,
      false,
      false,
      true,
      true,
    ]);
  });
});
