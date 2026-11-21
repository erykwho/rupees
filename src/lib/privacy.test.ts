import { describe, expect, it } from "vitest";
import {
  MASKED_BRL,
  MASKED_QTY,
  MASKED_USD,
  maskBRL,
  maskCurrency,
  maskQty,
  maskSignedBRL,
  maskUSD,
} from "./privacy";
import { formatBRL, formatQty, formatUSD } from "./domain/types";

describe("privacy masking helpers", () => {
  it("masks BRL values when privacy mode is enabled", () => {
    expect(maskBRL(12345.67, true)).toBe(MASKED_BRL);
    expect(maskBRL(12345.67, false)).toBe(formatBRL(12345.67));
  });

  it("masks signed BRL values without leaking sign when private", () => {
    expect(maskSignedBRL(500, true)).toBe(MASKED_BRL);
    expect(maskSignedBRL(-500, true)).toBe(MASKED_BRL);
    expect(maskSignedBRL(500, false)).toBe(`+${formatBRL(500)}`);
    expect(maskSignedBRL(-500, false)).toBe(formatBRL(-500));
  });

  it("masks USD and multi-currency values appropriately", () => {
    expect(maskUSD(99.5, true)).toBe(MASKED_USD);
    expect(maskUSD(99.5, false)).toBe(formatUSD(99.5));

    expect(maskCurrency(100, "BRL", true)).toBe(MASKED_BRL);
    expect(maskCurrency(100, "USD", true)).toBe(MASKED_USD);
    expect(maskCurrency(100, "BRL", false)).toBe(formatBRL(100));
    expect(maskCurrency(100, "USD", false)).toBe(formatUSD(100));
  });

  it("masks quantities when privacy mode is enabled", () => {
    expect(maskQty(150, true, "BR_STOCK")).toBe(MASKED_QTY);
    expect(maskQty(150, false, "BR_STOCK")).toBe(formatQty(150, "BR_STOCK"));
    expect(maskQty(1.2345, false, "US_STOCK")).toBe(
      formatQty(1.2345, "US_STOCK")
    );
  });
});
