"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { RotateCcw } from "lucide-react";
import type { MouseHandlerDataParam } from "recharts";
import {
  type ChartZoomWindow,
  type TouchPanAxis,
  type TouchVelocitySample,
  clampZoomWindow,
  computeInertiaVelocity,
  createFullZoomWindow,
  getVisibleSliceBounds,
  isZoomedWindow,
  panZoomWindow,
  resolveTouchPanAxis,
  stepInertiaVelocity,
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
  const isInteractingRef = useRef<boolean>(isInteracting);
  const inertiaRafRef = useRef<number | null>(null);
  const totalPointsRef = useRef<number>(totalPoints);
  const resetKeyRef = useRef<string>(resetKey);
  const minPointsRef = useRef<number>(minVisiblePoints);

  useEffect(() => {
    windowRef.current = effectiveWindow;
    isZoomedRef.current = isZoomed;
    isInteractingRef.current = isInteracting;
    totalPointsRef.current = totalPoints;
    resetKeyRef.current = resetKey;
    minPointsRef.current = minVisiblePoints;
  }, [
    effectiveWindow,
    isZoomed,
    isInteracting,
    totalPoints,
    resetKey,
    minVisiblePoints,
  ]);

  const setInteractingSync = useCallback((next: boolean) => {
    isInteractingRef.current = next;
    setIsInteracting(next);
  }, []);

  const stopInertia = useCallback(() => {
    if (inertiaRafRef.current !== null) {
      window.cancelAnimationFrame(inertiaRafRef.current);
      inertiaRafRef.current = null;
    }
  }, []);

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
    stopInertia();
    const full = createFullZoomWindow(totalPointsRef.current);
    windowRef.current = full;
    isZoomedRef.current = false;
    setInteractingSync(false);
    setZoomState({
      resetKey: resetKeyRef.current,
      totalPoints: totalPointsRef.current,
      window: full,
    });
  }, [setInteractingSync, stopInertia]);

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
        setInteractingSync(true);
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
        setInteractingSync(false);
      }
    };

    const handleMouseDown = (event: MouseEvent) => {
      if (event.button !== 0 || !isZoomedRef.current) return;
      if (event.target instanceof Element && event.target.closest("button")) {
        return;
      }
      stopInertia();
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

    // --- Mobile touch (capture phase + active target safety net): 2-finger pinch zoom + 1-finger horizontal pan + inertia ---
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
      axis: TouchPanAxis;
      samples: TouchVelocitySample[];
    } | null = null;

    const handledTouchEvents = new WeakSet<Event>();
    const activeTouchTargets = new Set<EventTarget>();

    const startInertia = (initialVelocityPxPerMs: number) => {
      stopInertia();
      let velocity = initialVelocityPxPerMs;
      let lastTime = performance.now();
      setInteractingSync(true);

      const step = (now: number) => {
        const dt = Math.min(48, Math.max(1, now - lastTime));
        lastTime = now;

        const count = totalPointsRef.current;
        const current = windowRef.current;
        const span = current.end - current.start;
        const { plotWidth } = getPlotMetrics();
        const dx = velocity * dt;
        const deltaPoints = (-dx / plotWidth) * span;
        const next = panZoomWindow(
          current,
          count,
          deltaPoints,
          minPointsRef.current
        );

        const moved = Math.abs(next.start - current.start) > 1e-5;
        if (moved) {
          commitWindow(next);
        }

        velocity = moved ? stepInertiaVelocity(velocity, dt) : 0;
        if (velocity !== 0 && isZoomedRef.current) {
          inertiaRafRef.current = window.requestAnimationFrame(step);
        } else {
          inertiaRafRef.current = null;
          setInteractingSync(false);
        }
      };

      inertiaRafRef.current = window.requestAnimationFrame(step);
    };

    const detachActiveTouchTargets = () => {
      for (const target of activeTouchTargets) {
        target.removeEventListener("touchmove", handleTouchMove, {
          capture: true,
        });
        target.removeEventListener("touchend", handleTouchEnd, {
          capture: true,
        });
        target.removeEventListener("touchcancel", handleTouchEnd, {
          capture: true,
        });
      }
      activeTouchTargets.clear();
    };

    const attachTouchTarget = (target: EventTarget | null) => {
      if (!target || target === el || activeTouchTargets.has(target)) return;
      activeTouchTargets.add(target);
      target.addEventListener("touchmove", handleTouchMove, {
        passive: false,
        capture: true,
      });
      target.addEventListener("touchend", handleTouchEnd, {
        passive: true,
        capture: true,
      });
      target.addEventListener("touchcancel", handleTouchEnd, {
        passive: true,
        capture: true,
      });
    };

    const recordVelocitySample = (
      samples: TouchVelocitySample[],
      x: number,
      t: number
    ) => {
      samples.push({ x, t });
      if (samples.length > 6) {
        samples.shift();
      }
    };

    const handleTouchStart = (event: TouchEvent) => {
      stopInertia();
      const count = totalPointsRef.current;
      if (count <= minPointsRef.current) return;

      if (event.touches.length === 2) {
        if (event.cancelable) event.preventDefault();
        event.stopPropagation();
        attachTouchTarget(window);
        attachTouchTarget(event.target);
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
        setInteractingSync(true);
        return;
      }

      if (event.touches.length === 1 && isZoomedRef.current) {
        attachTouchTarget(window);
        attachTouchTarget(event.target);
        pinchState = null;
        const touch = event.touches[0];
        const now = performance.now();
        singleTouchPan = {
          startX: touch.clientX,
          startY: touch.clientY,
          startWindow: windowRef.current,
          axis: "undecided",
          samples: [{ x: touch.clientX, t: now }],
        };
      }
    };

    const handleTouchMove = (event: Event) => {
      if (!(event instanceof TouchEvent)) return;
      if (handledTouchEvents.has(event)) return;
      handledTouchEvents.add(event);

      const count = totalPointsRef.current;

      if (event.touches.length === 2 && pinchState) {
        if (event.cancelable) event.preventDefault();
        event.stopPropagation();
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
        const now = performance.now();

        if (singleTouchPan.axis === "undecided") {
          const resolved = resolveTouchPanAxis(dx, dy);
          if (resolved === "undecided") {
            // Keep Recharts from scrubbing the tooltip during tiny initial jitter
            event.stopPropagation();
            return;
          }
          singleTouchPan.axis = resolved;
          if (resolved === "horizontal") {
            setInteractingSync(true);
          }
        }

        if (singleTouchPan.axis === "horizontal") {
          if (event.cancelable) event.preventDefault();
          event.stopPropagation();
          recordVelocitySample(singleTouchPan.samples, touch.clientX, now);
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
          return;
        }

        // Clearly vertical drag: allow native page scroll without scrubbing tooltip
        event.stopPropagation();
      }
    };

    const handleTouchEnd = (event: Event) => {
      if (!(event instanceof TouchEvent)) return;
      if (handledTouchEvents.has(event)) return;
      handledTouchEvents.add(event);

      if (event.touches.length === 1 && pinchState && isZoomedRef.current) {
        // Seamlessly hand off from 2-finger pinch to 1-finger pan without jumping
        pinchState = null;
        const touch = event.touches[0];
        singleTouchPan = {
          startX: touch.clientX,
          startY: touch.clientY,
          startWindow: windowRef.current,
          axis: "horizontal",
          samples: [{ x: touch.clientX, t: performance.now() }],
        };
        return;
      }

      if (event.touches.length === 0) {
        const finishedHorizontalPan =
          singleTouchPan?.axis === "horizontal" ? singleTouchPan : null;
        pinchState = null;
        singleTouchPan = null;
        detachActiveTouchTargets();

        if (finishedHorizontalPan && isZoomedRef.current) {
          const releaseVelocity = computeInertiaVelocity(
            finishedHorizontalPan.samples,
            performance.now()
          );
          if (releaseVelocity !== 0) {
            startInertia(releaseVelocity);
            return;
          }
        }

        setInteractingSync(false);
      }
    };

    el.addEventListener("wheel", handleWheel, { passive: false });
    el.addEventListener("mousedown", handleMouseDown);
    el.addEventListener("dblclick", handleDoubleClick);
    el.addEventListener("touchstart", handleTouchStart, {
      passive: false,
      capture: true,
    });
    el.addEventListener("touchmove", handleTouchMove, {
      passive: false,
      capture: true,
    });
    el.addEventListener("touchend", handleTouchEnd, {
      passive: true,
      capture: true,
    });
    el.addEventListener("touchcancel", handleTouchEnd, {
      passive: true,
      capture: true,
    });

    return () => {
      stopInertia();
      detachActiveTouchTargets();
      el.removeEventListener("wheel", handleWheel);
      el.removeEventListener("mousedown", handleMouseDown);
      el.removeEventListener("dblclick", handleDoubleClick);
      el.removeEventListener("touchstart", handleTouchStart, { capture: true });
      el.removeEventListener("touchmove", handleTouchMove, { capture: true });
      el.removeEventListener("touchend", handleTouchEnd, { capture: true });
      el.removeEventListener("touchcancel", handleTouchEnd, { capture: true });
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [
    commitWindow,
    plotLeftInset,
    plotRightInset,
    resetZoom,
    setInteractingSync,
    stopInertia,
  ]);

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

  useEffect(() => {
    sliceKeyRef.current = sliceKey;
    visibleLengthRef.current = visibleData.length;
  }, [sliceKey, visibleData.length]);

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

  const updateActiveFromTouchScrub = useCallback(
    (state: MouseHandlerDataParam) => {
      // When zoomed, 1-finger touch drag pans the timeline; single taps update via onClick
      if (isZoomedRef.current) return;
      updateActiveFromChart(state);
    },
    [updateActiveFromChart]
  );

  const clearActiveFromChart = useCallback(() => {
    setActiveSelection(null);
  }, []);

  const chartEventHandlers = useMemo(
    () => ({
      onMouseMove: updateActiveFromChart,
      onMouseLeave: clearActiveFromChart,
      onTouchStart: updateActiveFromTouchScrub,
      onTouchMove: updateActiveFromTouchScrub,
      onClick: updateActiveFromChart,
    }),
    [updateActiveFromChart, updateActiveFromTouchScrub, clearActiveFromChart]
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
          "w-full select-none [&_.recharts-surface_*]:pointer-events-none",
          isZoomed && (isInteracting ? "cursor-grabbing" : "cursor-grab"),
          className
        )}
      >
        {children}
      </div>
    </div>
  );
}
