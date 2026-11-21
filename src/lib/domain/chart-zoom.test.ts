import { describe, expect, it } from "vitest";
import {
  clampZoomWindow,
  createFullZoomWindow,
  getVisibleSliceBounds,
  isZoomedWindow,
  panZoomWindow,
  resolveTouchPanAxis,
  zoomWindowAroundAnchor,
} from "./chart-zoom";

describe("chart-zoom domain helpers", () => {
  it("creates full zoom windows safely for empty, single, and multi-point series", () => {
    expect(createFullZoomWindow(0)).toEqual({ start: 0, end: 0 });
    expect(createFullZoomWindow(1)).toEqual({ start: 0, end: 0 });
    expect(createFullZoomWindow(100)).toEqual({ start: 0, end: 99 });
  });

  it("zooms in around the anchor point while keeping the anchor index fixed", () => {
    const full = createFullZoomWindow(101); // 0..100
    // Anchor at 50% (index 50), scale 0.5 -> span 50 -> [25, 75]
    const zoomed = zoomWindowAroundAnchor(full, 101, 0.5, 0.5, 5);
    expect(zoomed.start).toBeCloseTo(25, 6);
    expect(zoomed.end).toBeCloseTo(75, 6);
    expect(isZoomedWindow(zoomed, 101)).toBe(true);

    // Anchor at right edge (1.0, index 100), scale 0.5 -> [50, 100]
    const zoomedRight = zoomWindowAroundAnchor(full, 101, 0.5, 1, 5);
    expect(zoomedRight.start).toBeCloseTo(50, 6);
    expect(zoomedRight.end).toBeCloseTo(100, 6);

    // Anchor at left edge (0.0, index 0), scale 0.2 -> [0, 20]
    const zoomedLeft = zoomWindowAroundAnchor(full, 101, 0.2, 0, 5);
    expect(zoomedLeft.start).toBeCloseTo(0, 6);
    expect(zoomedLeft.end).toBeCloseTo(20, 6);
  });

  it("respects minimum visible points when zooming in aggressively", () => {
    const full = createFullZoomWindow(100);
    const zoomed = zoomWindowAroundAnchor(full, 100, 0.001, 0.5, 5);
    expect(zoomed.end - zoomed.start).toBeCloseTo(4, 6); // 5 points => span 4
    const bounds = getVisibleSliceBounds(zoomed, 100);
    expect(bounds.endIndex - bounds.startIndex + 1).toBeGreaterThanOrEqual(5);
  });

  it("snaps cleanly back to full window when zooming all the way out", () => {
    const zoomed = { start: 20, end: 60 };
    const full = zoomWindowAroundAnchor(zoomed, 100, 3, 0.5, 5);
    expect(full).toEqual({ start: 0, end: 99 });
    expect(isZoomedWindow(full, 100)).toBe(false);
  });

  it("pans forward and backward while preserving exact span and clamping at edges", () => {
    const win = { start: 30, end: 50 }; // span 20
    const forward = panZoomWindow(win, 100, 15);
    expect(forward).toEqual({ start: 45, end: 65 });

    const clampedRight = panZoomWindow(win, 100, 200);
    expect(clampedRight).toEqual({ start: 79, end: 99 });
    expect(clampedRight.end - clampedRight.start).toBeCloseTo(20, 6);

    const clampedLeft = panZoomWindow(win, 100, -100);
    expect(clampedLeft).toEqual({ start: 0, end: 20 });
    expect(clampedLeft.end - clampedLeft.start).toBeCloseTo(20, 6);
  });

  it("does not pan when already viewing the full series", () => {
    const full = createFullZoomWindow(50);
    expect(panZoomWindow(full, 50, 10)).toEqual({ start: 0, end: 49 });
    expect(panZoomWindow(full, 50, -10)).toEqual({ start: 0, end: 49 });
  });

  it("clamps invalid or inverted windows gracefully", () => {
    expect(clampZoomWindow({ start: 40, end: 20 }, 100, 5)).toEqual({
      start: 20,
      end: 40,
    });
    expect(clampZoomWindow({ start: -10, end: 10 }, 100, 5)).toEqual({
      start: 0,
      end: 20,
    });
    expect(clampZoomWindow({ start: 95, end: 110 }, 100, 5)).toEqual({
      start: 84,
      end: 99,
    });
  });

  it("computes integer slice bounds cleanly", () => {
    expect(getVisibleSliceBounds({ start: 0, end: 99 }, 100)).toEqual({
      startIndex: 0,
      endIndex: 99,
    });
    expect(getVisibleSliceBounds({ start: 10.2, end: 25.8 }, 100)).toEqual({
      startIndex: 10,
      endIndex: 26,
    });
    expect(getVisibleSliceBounds({ start: 0, end: 0 }, 0)).toEqual({
      startIndex: 0,
      endIndex: -1,
    });
  });

  it("classifies horizontal, diagonal-horizontal, vertical, and tiny touch movements", () => {
    // Tiny jitter stays undecided (preserves tap)
    expect(resolveTouchPanAxis(2, 3)).toBe("undecided");
    expect(resolveTouchPanAxis(3, 8)).toBe("undecided");

    // Horizontal and slightly diagonal thumb swipes lock to horizontal pan
    expect(resolveTouchPanAxis(5, 0)).toBe("horizontal");
    expect(resolveTouchPanAxis(-6, 8)).toBe("horizontal");
    expect(resolveTouchPanAxis(10, -14)).toBe("horizontal");

    // Clearly vertical swipes lock to vertical page scroll
    expect(resolveTouchPanAxis(2, 14)).toBe("vertical");
    expect(resolveTouchPanAxis(-5, -20)).toBe("vertical");
  });
});
