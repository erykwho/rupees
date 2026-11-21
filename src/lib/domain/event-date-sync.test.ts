import { describe, expect, it } from "vitest";
import {
  type AuditEventCandidate,
  matchAuditEventsWithSheet,
  parseAportesCsv,
} from "./event-date-sync";

const SAMPLE_CSV = [
  "Ativo,Qtd,Data,Classe,Valor na moeda,Preço médio na moeda,Cotação,Valor hoje,Transação",
  'IPCA,"799,95",07/02/2025,Renda Fixa,"799,95",1,1,"799,95",Compra',
  'FLRY3,51,07/02/2025,Ação,"593,64","11,64","R$ 21,51","R$ 1.097,01",Compra',
  'PORT3,-14,15/12/2025,Ação,-263,"18,78571429",Saiu da bolsa,-263,Venda',
  'VOO,"0,17637",07/03/2025,Stock,"$92,85","$526,45","R$ 3.781,15","R$ 666,88",Compra',
  "SELIC,500,31/03/2025,Reserva,500,1,1,500,Compra",
  "SELIC,500,04/11/2026,Reserva,500,1,1,500",
].join("\n");

describe("parseAportesCsv", () => {
  it("normaliza tickers, tipos, valores BR/USD e incrementa +1s por linha no mesmo dia", () => {
    const rows = parseAportesCsv(SAMPLE_CSV);
    expect(rows).toHaveLength(6);

    expect(rows[0]).toMatchObject({
      rowNumber: 2,
      ticker: "IPCA",
      type: "BUY",
      quantity: 799.95,
      totalAmount: 799.95,
      dateKey: "2025-02-07",
    });
    expect(rows[0].targetCreatedAt.toISOString()).toBe("2025-02-07T12:00:00.000Z");

    // Segunda linha no mesmo dia recebe +1s
    expect(rows[1].ticker).toBe("FLRY3");
    expect(rows[1].targetCreatedAt.toISOString()).toBe("2025-02-07T12:00:01.000Z");

    // Venda com quantidade negativa
    expect(rows[2]).toMatchObject({
      ticker: "PORT3",
      type: "SELL",
      quantity: 14,
      totalAmount: 263,
      dateKey: "2025-12-15",
    });

    // Ativo USD com $
    expect(rows[3]).toMatchObject({
      ticker: "VOO",
      type: "BUY",
      quantity: 0.17637,
      totalAmount: 92.85,
      dateKey: "2025-03-07",
    });

    // Linha sem coluna Transação preenchida assume BUY
    expect(rows[5]).toMatchObject({
      ticker: "SELIC",
      type: "BUY",
      quantity: 500,
      totalAmount: 500,
      dateKey: "2026-11-04",
    });
  });
});

describe("matchAuditEventsWithSheet", () => {
  it("desempata múltiplos SELIC 500 pela transactionDate e identifica sem match", () => {
    const rows = parseAportesCsv(SAMPLE_CSV);
    const importDate = new Date("2026-11-10T18:00:00.000Z");

    const events: AuditEventCandidate[] = [
      {
        id: "ev-selic-nov",
        entityId: "tx-selic-nov",
        entityLabel: "SELIC (Compra)",
        createdAt: importDate,
        ticker: "SELIC",
        type: "BUY",
        quantity: 500,
        totalAmount: 500,
        transactionDate: new Date("2026-11-04T12:00:00.000Z"),
      },
      {
        id: "ev-selic-mar",
        entityId: "tx-selic-mar",
        entityLabel: "SELIC (Compra)",
        createdAt: importDate,
        ticker: "SELIC",
        type: "BUY",
        quantity: 500,
        totalAmount: 500,
        transactionDate: new Date("2025-03-31T12:00:00.000Z"),
      },
      {
        id: "ev-ipca-already-synced",
        entityId: "tx-ipca",
        entityLabel: "IPCA (Compra)",
        createdAt: new Date("2025-02-07T12:00:00.000Z"),
        ticker: "IPCA",
        type: "BUY",
        quantity: 799.95,
        totalAmount: 799.95,
        transactionDate: new Date("2025-02-07T12:00:00.000Z"),
      },
      {
        id: "ev-app-only",
        entityId: "tx-app-only",
        entityLabel: "PETR4 (Compra)",
        createdAt: new Date("2026-11-20T15:30:00.000Z"),
        ticker: "PETR4",
        type: "BUY",
        quantity: 10,
        totalAmount: 380,
        transactionDate: new Date("2026-11-20T12:00:00.000Z"),
      },
    ];

    const plan = matchAuditEventsWithSheet(events, rows);

    const selicMarMatch = plan.matches.find((m) => m.eventId === "ev-selic-mar");
    const selicNovMatch = plan.matches.find((m) => m.eventId === "ev-selic-nov");
    const ipcaMatch = plan.matches.find((m) => m.eventId === "ev-ipca-already-synced");

    expect(selicMarMatch?.targetCreatedAt.toISOString()).toBe(
      "2025-03-31T12:00:00.000Z"
    );
    expect(selicMarMatch?.needsUpdate).toBe(true);

    expect(selicNovMatch?.targetCreatedAt.toISOString()).toBe(
      "2026-11-04T12:00:00.000Z"
    );
    expect(selicNovMatch?.needsUpdate).toBe(true);

    expect(ipcaMatch?.needsUpdate).toBe(false);

    // 3 linhas da planilha sem evento correspondente (FLRY3, PORT3, VOO)
    expect(plan.unmatchedSheetRows.map((r) => r.ticker)).toEqual([
      "FLRY3",
      "PORT3",
      "VOO",
    ]);

    // 1 evento do app fora da planilha (PETR4)
    expect(plan.unmatchedEvents.map((e) => e.id)).toEqual(["ev-app-only"]);
  });
});
