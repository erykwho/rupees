import { describe, expect, it } from "vitest";
import {
  formatExchangeLabel,
  isTickerFormatValid,
  matchesExpectedExchange,
  normalizeTicker,
  resolveValidationStatusTransition,
} from "./ticker-validation";

describe("normalizeTicker", () => {
  it("strips .SA suffix for BR variable income classes", () => {
    expect(normalizeTicker(" wege3.sa ", "BR_STOCK")).toBe("WEGE3");
    expect(normalizeTicker("hglg11.SA", "BR_FII")).toBe("HGLG11");
    expect(normalizeTicker("ITUB4", "BR_STOCK")).toBe("ITUB4");
  });

  it("uppercases and trims US and fixed income tickers without stripping suffixes", () => {
    expect(normalizeTicker(" voo ", "US_STOCK")).toBe("VOO");
    expect(normalizeTicker("brk-b", "US_STOCK")).toBe("BRK-B");
    expect(normalizeTicker("cdb inter 100%", "FIXED_INCOME")).toBe(
      "CDB INTER 100%"
    );
  });
});

describe("isTickerFormatValid", () => {
  it("always accepts fixed income and emergency reserve names", () => {
    expect(isTickerFormatValid("Tesouro IPCA+ 2035", "FIXED_INCOME")).toBe(true);
    expect(isTickerFormatValid("Reserva Selic", "EMERGENCY_RESERVE")).toBe(true);
  });

  it("validates BR ticker syntax", () => {
    expect(isTickerFormatValid("WEGE3", "BR_STOCK")).toBe(true);
    expect(isTickerFormatValid("WEGE3.SA", "BR_STOCK")).toBe(true);
    expect(isTickerFormatValid("HGLG11", "BR_FII")).toBe(true);
    expect(isTickerFormatValid("AB", "BR_STOCK")).toBe(false);
    expect(isTickerFormatValid("WEGE 3", "BR_STOCK")).toBe(false);
    expect(isTickerFormatValid("WEGE3!", "BR_STOCK")).toBe(false);
  });

  it("validates US ticker syntax", () => {
    expect(isTickerFormatValid("O", "US_REIT")).toBe(true);
    expect(isTickerFormatValid("VOO", "US_STOCK")).toBe(true);
    expect(isTickerFormatValid("BRK-B", "US_STOCK")).toBe(true);
    expect(isTickerFormatValid("BRK.B", "US_STOCK")).toBe(true);
    expect(isTickerFormatValid("", "US_STOCK")).toBe(false);
    expect(isTickerFormatValid("AAPL US", "US_STOCK")).toBe(false);
  });
});

describe("matchesExpectedExchange", () => {
  it("accepts B3 stocks, FIIs, units, and ETFs for BR classes", () => {
    expect(
      matchesExpectedExchange("BR_STOCK", {
        symbol: "WEGE3.SA",
        exchange: "SAO",
        currency: "BRL",
        quoteType: "EQUITY",
      })
    ).toBe(true);

    expect(
      matchesExpectedExchange("BR_FII", {
        symbol: "HGLG11.SA",
        exchange: "SAO",
        currency: "BRL",
        quoteType: "EQUITY",
      })
    ).toBe(true);

    expect(
      matchesExpectedExchange("BR_STOCK", {
        symbol: "BOVA11.SA",
        exchange: "SAO",
        currency: "BRL",
        quoteType: "ETF",
      })
    ).toBe(true);
  });

  it("rejects US or foreign tickers for BR classes", () => {
    expect(
      matchesExpectedExchange("BR_STOCK", {
        symbol: "AAPL",
        exchange: "NMS",
        currency: "USD",
        quoteType: "EQUITY",
      })
    ).toBe(false);
  });

  it("accepts US stocks, REITs, and ETFs on US exchanges", () => {
    expect(
      matchesExpectedExchange("US_STOCK", {
        symbol: "AAPL",
        exchange: "NMS",
        currency: "USD",
        quoteType: "EQUITY",
      })
    ).toBe(true);

    expect(
      matchesExpectedExchange("US_STOCK", {
        symbol: "VOO",
        exchange: "PCX",
        currency: "USD",
        quoteType: "ETF",
      })
    ).toBe(true);

    expect(
      matchesExpectedExchange("US_REIT", {
        symbol: "O",
        exchange: "NYQ",
        currency: "USD",
        quoteType: "EQUITY",
      })
    ).toBe(true);
  });

  it("rejects B3, crypto, indices, and foreign exchanges for US classes", () => {
    expect(
      matchesExpectedExchange("US_STOCK", {
        symbol: "WEGE3.SA",
        exchange: "SAO",
        currency: "BRL",
        quoteType: "EQUITY",
      })
    ).toBe(false);

    expect(
      matchesExpectedExchange("US_STOCK", {
        symbol: "BTC-USD",
        exchange: "CCC",
        currency: "USD",
        quoteType: "CRYPTOCURRENCY",
      })
    ).toBe(false);

    expect(
      matchesExpectedExchange("US_STOCK", {
        symbol: "^GSPC",
        exchange: "SNP",
        currency: "USD",
        quoteType: "INDEX",
      })
    ).toBe(false);

    expect(
      matchesExpectedExchange("US_STOCK", {
        symbol: "SHOP.TO",
        exchange: "TOR",
        currency: "CAD",
        quoteType: "EQUITY",
      })
    ).toBe(false);
  });
});

describe("resolveValidationStatusTransition", () => {
  it("promotes PENDING or INVALID to VERIFIED on VALID outcome", () => {
    expect(resolveValidationStatusTransition("PENDING", "VALID")).toBe(
      "VERIFIED"
    );
    expect(resolveValidationStatusTransition("INVALID", "VALID")).toBe(
      "VERIFIED"
    );
  });

  it("marks as INVALID on confirmed INVALID outcome", () => {
    expect(resolveValidationStatusTransition("VERIFIED", "INVALID")).toBe(
      "INVALID"
    );
    expect(resolveValidationStatusTransition("PENDING", "INVALID")).toBe(
      "INVALID"
    );
  });

  it("preserves current status on UNAVAILABLE outcome", () => {
    expect(resolveValidationStatusTransition("VERIFIED", "UNAVAILABLE")).toBe(
      "VERIFIED"
    );
    expect(resolveValidationStatusTransition("PENDING", "UNAVAILABLE")).toBe(
      "PENDING"
    );
    expect(resolveValidationStatusTransition("INVALID", "UNAVAILABLE")).toBe(
      "INVALID"
    );
  });
});

describe("formatExchangeLabel", () => {
  it("maps known exchange codes to readable labels", () => {
    expect(formatExchangeLabel("SAO")).toBe("B3");
    expect(formatExchangeLabel("NMS")).toBe("NASDAQ");
    expect(formatExchangeLabel("NYQ")).toBe("NYSE");
    expect(formatExchangeLabel("PCX")).toBe("NYSE Arca");
  });
});
