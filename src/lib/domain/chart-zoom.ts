export interface ChartZoomWindow {
  /** Fractional inclusive start index in [0, totalPoints - 1] */
  start: number;
  /** Fractional inclusive end index in [0, totalPoints - 1] */
  end: number;
}

export interface VisibleSliceBounds {
  startIndex: number;
  endIndex: number;
}

const DEFAULT_MIN_VISIBLE_POINTS = 5;
const FULL_WINDOW_EPSILON = 0.05;

function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

export function createFullZoomWindow(totalPoints: number): ChartZoomWindow {
  if (totalPoints <= 1) {
    return { start: 0, end: 0 };
  }
  return { start: 0, end: totalPoints - 1 };
}

export function getEffectiveMinSpan(
  totalPoints: number,
  minVisiblePoints = DEFAULT_MIN_VISIBLE_POINTS
): number {
  if (totalPoints <= 1) return 0;
  const clampedMinPoints = Math.min(
    totalPoints,
    Math.max(2, Math.floor(minVisiblePoints))
  );
  return clampedMinPoints - 1;
}

export function clampZoomWindow(
  window: ChartZoomWindow,
  totalPoints: number,
  minVisiblePoints = DEFAULT_MIN_VISIBLE_POINTS
): ChartZoomWindow {
  if (totalPoints <= 1) {
    return { start: 0, end: 0 };
  }

  const maxIndex = totalPoints - 1;
  const minSpan = getEffectiveMinSpan(totalPoints, minVisiblePoints);

  let start = Number.isFinite(window.start) ? window.start : 0;
  let end = Number.isFinite(window.end) ? window.end : maxIndex;

  if (end < start) {
    const tmp = start;
    start = end;
    end = tmp;
  }

  let span = end - start;
  if (span >= maxIndex - FULL_WINDOW_EPSILON) {
    return { start: 0, end: maxIndex };
  }

  if (span < minSpan) {
    const mid = (start + end) / 2;
    span = minSpan;
    start = mid - span / 2;
    end = mid + span / 2;
  }

  if (start < 0) {
    end = Math.min(maxIndex, end - start);
    start = 0;
  }

  if (end > maxIndex) {
    start = Math.max(0, start - (end - maxIndex));
    end = maxIndex;
  }

  return { start, end };
}

export function isZoomedWindow(
  window: ChartZoomWindow,
  totalPoints: number
): boolean {
  if (totalPoints <= 2) return false;
  const maxIndex = totalPoints - 1;
  return (
    window.start > FULL_WINDOW_EPSILON ||
    window.end < maxIndex - FULL_WINDOW_EPSILON
  );
}

/**
 * Zooms a window around `anchorRatio` (0 = left edge, 1 = right edge).
 * - `scaleFactor < 1` zooms IN (narrower window).
 * - `scaleFactor > 1` zooms OUT (wider window).
 */
export function zoomWindowAroundAnchor(
  window: ChartZoomWindow,
  totalPoints: number,
  scaleFactor: number,
  anchorRatio: number,
  minVisiblePoints = DEFAULT_MIN_VISIBLE_POINTS
): ChartZoomWindow {
  if (totalPoints <= 1 || !Number.isFinite(scaleFactor) || scaleFactor <= 0) {
    return createFullZoomWindow(totalPoints);
  }

  const maxIndex = totalPoints - 1;
  const minSpan = getEffectiveMinSpan(totalPoints, minVisiblePoints);
  const clampedCurrent = clampZoomWindow(window, totalPoints, minVisiblePoints);
  const currentSpan = clampedCurrent.end - clampedCurrent.start;

  const targetSpan = clamp(currentSpan * scaleFactor, minSpan, maxIndex);
  if (targetSpan >= maxIndex - FULL_WINDOW_EPSILON) {
    return { start: 0, end: maxIndex };
  }

  const ratio = clamp(anchorRatio, 0, 1);
  const anchorIndex = clampedCurrent.start + currentSpan * ratio;

  const nextStart = anchorIndex - targetSpan * ratio;
  const nextEnd = nextStart + targetSpan;

  return clampZoomWindow(
    { start: nextStart, end: nextEnd },
    totalPoints,
    minVisiblePoints
  );
}

/**
 * Pans a zoom window by `deltaPoints` while preserving its exact span width.
 * - Positive `deltaPoints` moves forward in time (toward newer dates).
 * - Negative `deltaPoints` moves backward in time (toward older dates).
 */
export function panZoomWindow(
  window: ChartZoomWindow,
  totalPoints: number,
  deltaPoints: number,
  minVisiblePoints = DEFAULT_MIN_VISIBLE_POINTS
): ChartZoomWindow {
  if (totalPoints <= 1 || !Number.isFinite(deltaPoints)) {
    return createFullZoomWindow(totalPoints);
  }

  const maxIndex = totalPoints - 1;
  const clampedCurrent = clampZoomWindow(window, totalPoints, minVisiblePoints);
  const span = clampedCurrent.end - clampedCurrent.start;

  if (span >= maxIndex - FULL_WINDOW_EPSILON) {
    return { start: 0, end: maxIndex };
  }

  const nextStart = clamp(clampedCurrent.start + deltaPoints, 0, maxIndex - span);
  return {
    start: nextStart,
    end: nextStart + span,
  };
}

export function getVisibleSliceBounds(
  window: ChartZoomWindow,
  totalPoints: number
): VisibleSliceBounds {
  if (totalPoints <= 0) {
    return { startIndex: 0, endIndex: -1 };
  }
  if (totalPoints === 1) {
    return { startIndex: 0, endIndex: 0 };
  }

  const maxIndex = totalPoints - 1;
  const startIndex = clamp(Math.floor(window.start + 1e-6), 0, maxIndex);
  const endIndex = clamp(Math.ceil(window.end - 1e-6), startIndex, maxIndex);

  return { startIndex, endIndex };
}
