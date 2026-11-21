"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { RotateCcw } from "lucide-react";
import type { MouseHandlerDataParam } from "recharts";
import {
  type ChartZoomWindow,
  clampZoomWindow,
  createFullZoomWindow,
  getVisibleSliceBounds,
  isZoomedWindow,
  panZoomWindow,
  zoomWindowAroundAnchor,
} from "@/lib/domain/chart-zoom";
import { cn } from "@/lib/utils";

interface UseChartZoomOptions<T> {
  /** Changing this key automatically resets the zoom to 100%. */
  resetKey: string;
  /** Minimum number of data points kept visible at maximum zoom. */
  minVisiblePoints?: number;
  /** Left plot area inset in px (typically YAxis width). */
  plotLeftInset?: number;
  /** Right plot area inset in px. */
  plotRightInset?: number;
  /** Extracts a human-readable date/period label for the visible range badge. */
  getRangeLabel?: (item: T) => string;
}

interface StoredZoomState {
  resetKey: string;
  totalPoints: number;
  window: ChartZoomWindow;
}

export interface UseChartZoomResult<T> {
  containerRef: React.RefObject<HTMLDivElement | null>;
  visibleData: T[];
  isZoomed: boolean;
  isInteracting: boolean;
  rangeLabel: string | null;
  resetZoom: () => void;
  /** Currently inspected point, or falls back to the last visible point. */
  displayPoint: T | null;
  /** True when the user is actively inspecting a specific point (touch/hover/tap). */
  isPointActive: boolean;
  /** Spread onto Recharts AreaChart/BarChart to sync the mobile fixed readout. */
  chartEventHandlers: {
    onMouseMove: (state: MouseHandlerDataParam) => void;
    onMouseLeave: () => void;
    onTouchStart: (state: MouseHandlerDataParam) => void;
    onTouchMove: (state: MouseHandlerDataParam) => void;
    onClick: (state: MouseHandlerDataParam) => void;
  };
}

function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

function getTouchDistance(t1: Touch, t2: Touch): number {
  return Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
}

function getTouchMidX(t1: Touch, t2: Touch): number {
  return (t1.clientX + t2.clientX) / 2;
}

export function useChartZoom<T>(
  data: T[],
  {
    resetKey,
    minVisiblePoints = 5,
    plotLeftInset = 68,
    plotRightInset = 12,
    getRangeLabel,
  }: UseChartZoomOptions<T>
): UseChartZoomResult<T> {
  const totalPoints = data.length;
  const containerRef = useRef<HTMLDivElement | null>(null);

  const [zoomState, setZoomState] = useState<StoredZoomState>(() => ({
    resetKey,
    totalPoints,
    window: createFullZoomWindow(totalPoints),
  }));
  const [isInteracting, setIsInteracting] = useState(false);

  const effectiveWindow = useMemo(() => {
    if (
      zoomState.resetKey !== resetKey ||
      zoomState.totalPoints !== totalPoints
    ) {
      return createFullZoomWindow(totalPoints);
    }
    return clampZoomWindow(zoomState.window, totalPoints, minVisiblePoints);
  }, [zoomState, resetKey, totalPoints, minVisiblePoints]);

  const isZoomed = useMemo(
    () => isZoomedWindow(effectiveWindow, totalPoints),
    [effectiveWindow, totalPoints]
  );

  // Keep refs in sync for native DOM event listeners without re-binding on every frame
  const windowRef = useRef<ChartZoomWindow>(effectiveWindow);
  const isZoomedRef = useRef<boolean>(isZoomed);
  const totalPointsRef = useRef<number>(totalPoints);
  const resetKeyRef = useRef<string>(resetKey);
  const minPointsRef = useRef<number>(minVisiblePoints);

  useEffect(() => {
    windowRef.current = effectiveWindow;
    isZoomedRef.current = isZoomed;
    totalPointsRef.current = totalPoints;
    resetKeyRef.current = resetKey;
    minPointsRef.current = minVisiblePoints;
  }, [effectiveWindow, isZoomed, totalPoints, resetKey, minVisiblePoints]);

  const commitWindow = useCallback((nextWindow: ChartZoomWindow) => {
    const count = totalPointsRef.current;
    const clamped = clampZoomWindow(nextWindow, count, minPointsRef.current);
    windowRef.current = clamped;
    isZoomedRef.current = isZoomedWindow(clamped, count);
    setZoomState({
      resetKey: resetKeyRef.current,
      totalPoints: count,
      window: clamped,
    });
  }, []);

  const resetZoom = useCallback(() => {
    const full = createFullZoomWindow(totalPointsRef.current);
    windowRef.current = full;
    isZoomedRef.current = false;
    setIsInteracting(false);
    setZoomState({
      resetKey: resetKeyRef.current,
      totalPoints: totalPointsRef.current,
      window: full,
    });
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const getPlotMetrics = () => {
      const rect = el.getBoundingClientRect();
      const plotWidth = Math.max(1, rect.width - plotLeftInset - plotRightInset);
      return { rect, plotWidth };
    };

    const getAnchorRatio = (clientX: number) => {
      const { rect, plotWidth } = getPlotMetrics();
      return clamp((clientX - rect.left - plotLeftInset) / plotWidth, 0, 1);
    };

    // --- Wheel: trackpad pinch (ctrlKey) / Ctrl+wheel zoom + horizontal trackpad pan ---
    const handleWheel = (event: WheelEvent) => {
      const count = totalPointsRef.current;
      if (count <= minPointsRef.current) return;

      const isZoomGesture = event.ctrlKey || event.metaKey;
      if (isZoomGesture) {
        event.preventDefault();
        let deltaY = event.deltaY;
        if (event.deltaMode === 1) deltaY *= 16;
        else if (event.deltaMode === 2) deltaY *= 400;

        const scaleFactor = Math.exp(clamp(deltaY, -120, 120) * 0.0045);
        const anchorRatio = getAnchorRatio(event.clientX);
        const next = zoomWindowAroundAnchor(
          windowRef.current,
          count,
          scaleFactor,
          anchorRatio,
          minPointsRef.current
        );
        commitWindow(next);
        return;
      }

      const isHorizontalPan =
        isZoomedRef.current &&
        (Math.abs(event.deltaX) > Math.abs(event.deltaY) || event.shiftKey);

      if (isHorizontalPan) {
        event.preventDefault();
        const rawDelta =
          event.shiftKey && Math.abs(event.deltaX) < Math.abs(event.deltaY)
            ? event.deltaY
            : event.deltaX;
        const { plotWidth } = getPlotMetrics();
        const span = windowRef.current.end - windowRef.current.start;
        const deltaPoints = (rawDelta / plotWidth) * span;
        const next = panZoomWindow(
          windowRef.current,
          count,
          deltaPoints,
          minPointsRef.current
        );
        commitWindow(next);
      }
    };

    // --- Desktop mouse drag to pan when zoomed ---
    let mouseDrag: {
      startX: number;
      startWindow: ChartZoomWindow;
      hasDragged: boolean;
    } | null = null;

    const handleMouseMove = (event: MouseEvent) => {
      if (!mouseDrag) return;
      const dx = event.clientX - mouseDrag.startX;
      if (!mouseDrag.hasDragged && Math.abs(dx) <= 4) return;

      if (!mouseDrag.hasDragged) {
        mouseDrag.hasDragged = true;
        setIsInteracting(true);
      }

      const { plotWidth } = getPlotMetrics();
      const span = mouseDrag.startWindow.end - mouseDrag.startWindow.start;
      const deltaPoints = (-dx / plotWidth) * span;
      const next = panZoomWindow(
        mouseDrag.startWindow,
        totalPointsRef.current,
        deltaPoints,
        minPointsRef.current
      );
      commitWindow(next);
    };

    const handleMouseUp = () => {
      if (!mouseDrag) return;
      const wasDragging = mouseDrag.hasDragged;
      mouseDrag = null;
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
      if (wasDragging) {
        setIsInteracting(false);
      }
    };

    const handleMouseDown = (event: MouseEvent) => {
      if (event.button !== 0 || !isZoomedRef.current) return;
      if (event.target instanceof Element && event.target.closest("button")) {
        return;
      }
      mouseDrag = {
        startX: event.clientX,
        startWindow: windowRef.current,
        hasDragged: false,
      };
      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
    };

    const handleDoubleClick = () => {
      if (isZoomedRef.current) {
        resetZoom();
      }
    };

    // --- Mobile touch: 2-finger pinch zoom + 1-finger horizontal pan when zoomed ---
    let pinchState: {
      startDist: number;
      startMidX: number;
      startAnchorRatio: number;
      startWindow: ChartZoomWindow;
    } | null = null;

    let singleTouchPan: {
      startX: number;
      startY: number;
      startWindow: ChartZoomWindow;
      axis: "undecided" | "horizontal" | "vertical";
    } | null = null;

    const handleTouchStart = (event: TouchEvent) => {
      const count = totalPointsRef.current;
      if (count <= minPointsRef.current) return;

      if (event.touches.length === 2) {
        if (event.cancelable) event.preventDefault();
        singleTouchPan = null;
        const t1 = event.touches[0];
        const t2 = event.touches[1];
        const startMidX = getTouchMidX(t1, t2);
        pinchState = {
          startDist: Math.max(10, getTouchDistance(t1, t2)),
          startMidX,
          startAnchorRatio: getAnchorRatio(startMidX),
          startWindow: windowRef.current,
        };
        setIsInteracting(true);
        return;
      }

      if (event.touches.length === 1 && isZoomedRef.current) {
        pinchState = null;
        const touch = event.touches[0];
        singleTouchPan = {
          startX: touch.clientX,
          startY: touch.clientY,
          startWindow: windowRef.current,
          axis: "undecided",
        };
      }
    };

    const handleTouchMove = (event: TouchEvent) => {
      const count = totalPointsRef.current;

      if (event.touches.length === 2 && pinchState) {
        if (event.cancelable) event.preventDefault();
        const t1 = event.touches[0];
        const t2 = event.touches[1];
        const currentDist = Math.max(10, getTouchDistance(t1, t2));
        const currentMidX = getTouchMidX(t1, t2);
        const scaleFactor = pinchState.startDist / currentDist;

        const zoomed = zoomWindowAroundAnchor(
          pinchState.startWindow,
          count,
          scaleFactor,
          pinchState.startAnchorRatio,
          minPointsRef.current
        );

        const { plotWidth } = getPlotMetrics();
        const zoomedSpan = zoomed.end - zoomed.start;
        const midDeltaX = currentMidX - pinchState.startMidX;
        const panned = panZoomWindow(
          zoomed,
          count,
          (-midDeltaX / plotWidth) * zoomedSpan,
          minPointsRef.current
        );
        commitWindow(panned);
        return;
      }

      if (event.touches.length === 1 && singleTouchPan) {
        const touch = event.touches[0];
        const dx = touch.clientX - singleTouchPan.startX;
        const dy = touch.clientY - singleTouchPan.startY;

        if (singleTouchPan.axis === "undecided") {
          if (Math.hypot(dx, dy) <= 8) return;
          if (Math.abs(dx) >= Math.abs(dy)) {
            singleTouchPan.axis = "horizontal";
            setIsInteracting(true);
          } else {
            singleTouchPan.axis = "vertical";
            return;
          }
        }

        if (singleTouchPan.axis === "horizontal") {
          if (event.cancelable) event.preventDefault();
          const { plotWidth } = getPlotMetrics();
          const span =
            singleTouchPan.startWindow.end - singleTouchPan.startWindow.start;
          const deltaPoints = (-dx / plotWidth) * span;
          const next = panZoomWindow(
            singleTouchPan.startWindow,
            count,
            deltaPoints,
            minPointsRef.current
          );
          commitWindow(next);
        }
      }
    };

    const handleTouchEnd = (event: TouchEvent) => {
      if (event.touches.length === 1 && pinchState && isZoomedRef.current) {
        // Seamlessly hand off from 2-finger pinch to 1-finger pan without jumping
        pinchState = null;
        const touch = event.touches[0];
        singleTouchPan = {
          startX: touch.clientX,
          startY: touch.clientY,
          startWindow: windowRef.current,
          axis: "horizontal",
        };
        return;
      }

      if (event.touches.length === 0) {
        pinchState = null;
        singleTouchPan = null;
        setIsInteracting(false);
      }
    };

    el.addEventListener("wheel", handleWheel, { passive: false });
    el.addEventListener("mousedown", handleMouseDown);
    el.addEventListener("dblclick", handleDoubleClick);
    el.addEventListener("touchstart", handleTouchStart, { passive: false });
    el.addEventListener("touchmove", handleTouchMove, { passive: false });
    el.addEventListener("touchend", handleTouchEnd, { passive: true });
    el.addEventListener("touchcancel", handleTouchEnd, { passive: true });

    return () => {
      el.removeEventListener("wheel", handleWheel);
      el.removeEventListener("mousedown", handleMouseDown);
      el.removeEventListener("dblclick", handleDoubleClick);
      el.removeEventListener("touchstart", handleTouchStart);
      el.removeEventListener("touchmove", handleTouchMove);
      el.removeEventListener("touchend", handleTouchEnd);
      el.removeEventListener("touchcancel", handleTouchEnd);
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [commitWindow, plotLeftInset, plotRightInset, resetZoom]);

  const { visibleData, rangeLabel, sliceKey } = useMemo(() => {
    if (totalPoints === 0) {
      return { visibleData: data, rangeLabel: null, sliceKey: `${resetKey}|0|0` };
    }
    if (!isZoomed) {
      return {
        visibleData: data,
        rangeLabel: null,
        sliceKey: `${resetKey}|0|${totalPoints - 1}`,
      };
    }

    const { startIndex, endIndex } = getVisibleSliceBounds(
      effectiveWindow,
      totalPoints
    );
    const sliced = data.slice(startIndex, endIndex + 1);
    let label: string | null = null;
    if (getRangeLabel && sliced.length > 0) {
      const first = getRangeLabel(sliced[0]);
      const last = getRangeLabel(sliced[sliced.length - 1]);
      label = first === last ? first : `${first} – ${last}`;
    }
    return {
      visibleData: sliced,
      rangeLabel: label,
      sliceKey: `${resetKey}|${startIndex}|${endIndex}`,
    };
  }, [data, effectiveWindow, getRangeLabel, isZoomed, resetKey, totalPoints]);

  const [activeSelection, setActiveSelection] = useState<{
    sliceKey: string;
    index: number;
  } | null>(null);

  const sliceKeyRef = useRef(sliceKey);
  const visibleLengthRef = useRef(visibleData.length);
  const isInteractingRef = useRef(isInteracting);

  useEffect(() => {
    sliceKeyRef.current = sliceKey;
    visibleLengthRef.current = visibleData.length;
    isInteractingRef.current = isInteracting;
  }, [sliceKey, visibleData.length, isInteracting]);

  const updateActiveFromChart = useCallback((state: MouseHandlerDataParam) => {
    if (isInteractingRef.current) return;
    const raw = state?.activeTooltipIndex;
    const idx = typeof raw === "number" ? raw : Number(raw);
    if (
      Number.isInteger(idx) &&
      idx >= 0 &&
      idx < visibleLengthRef.current
    ) {
      setActiveSelection({ sliceKey: sliceKeyRef.current, index: idx });
    }
  }, []);

  const clearActiveFromChart = useCallback(() => {
    setActiveSelection(null);
  }, []);

  const chartEventHandlers = useMemo(
    () => ({
      onMouseMove: updateActiveFromChart,
      onMouseLeave: clearActiveFromChart,
      onTouchStart: updateActiveFromChart,
      onTouchMove: updateActiveFromChart,
      onClick: updateActiveFromChart,
    }),
    [updateActiveFromChart, clearActiveFromChart]
  );

  const activeIndex =
    !isInteracting &&
    activeSelection &&
    activeSelection.sliceKey === sliceKey &&
    activeSelection.index >= 0 &&
    activeSelection.index < visibleData.length
      ? activeSelection.index
      : null;

  const isPointActive = activeIndex !== null;
  const displayPoint =
    visibleData.length === 0
      ? null
      : activeIndex !== null
        ? visibleData[activeIndex]
        : visibleData[visibleData.length - 1];

  return {
    containerRef,
    visibleData,
    isZoomed,
    isInteracting,
    rangeLabel,
    resetZoom,
    displayPoint,
    isPointActive,
    chartEventHandlers,
  };
}

interface ZoomableChartContainerProps {
  containerRef: React.RefObject<HTMLDivElement | null>;
  isZoomed: boolean;
  isInteracting: boolean;
  rangeLabel: string | null;
  onResetZoom: () => void;
  /** Compact fixed readout strip shown above the chart on mobile (< sm). */
  mobileReadout?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}

export function ZoomableChartContainer({
  containerRef,
  isZoomed,
  isInteracting,
  rangeLabel,
  onResetZoom,
  mobileReadout,
  className,
  children,
}: ZoomableChartContainerProps) {
  return (
    <div>
      {mobileReadout && <div className="mb-2.5 sm:hidden">{mobileReadout}</div>}
      {isZoomed && (
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          {rangeLabel ? (
            <span className="inline-flex items-center rounded-lg bg-slate-100 px-2.5 py-1 text-[11px] font-medium tabular-nums text-slate-600 dark:bg-slate-800 dark:text-slate-300">
              {rangeLabel}
            </span>
          ) : (
            <span />
          )}
          <button
            type="button"
            onClick={onResetZoom}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700 shadow-2xs transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            <RotateCcw className="h-3 w-3" />
            Resetar zoom
          </button>
        </div>
      )}
      <div
        ref={containerRef}
        style={{ touchAction: "pan-y" }}
        className={cn(
          "w-full select-none",
          isZoomed && (isInteracting ? "cursor-grabbing" : "cursor-grab"),
          className
        )}
      >
        {children}
      </div>
    </div>
  );
}
