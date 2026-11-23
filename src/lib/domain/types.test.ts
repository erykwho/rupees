import { describe, expect, it } from "vitest";
import {
  ALL_ASSET_CLASSES,
  ASSET_CLASS_COLORS,
  ASSET_CLASS_COLORS_DARK,
  getAssetClassColor,
} from "./types";

describe("getAssetClassColor", () => {
  it("returns light palette colors when isDark is false", () => {
    for (const assetClass of ALL_ASSET_CLASSES) {
      expect(getAssetClassColor(assetClass, false)).toBe(
        ASSET_CLASS_COLORS[assetClass]
      );
    }
  });

  it("returns muted Café & Pedra dark palette colors when isDark is true", () => {
    for (const assetClass of ALL_ASSET_CLASSES) {
      const darkColor = getAssetClassColor(assetClass, true);
      expect(darkColor).toBe(ASSET_CLASS_COLORS_DARK[assetClass]);
      expect(darkColor).toMatch(/^#[0-9a-f]{6}$/i);
      expect(darkColor).not.toBe(ASSET_CLASS_COLORS[assetClass]);
    }
  });
});
