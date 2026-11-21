"use client";

import { useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import {
  PULL_REFRESH_HOLD_DISTANCE,
  PULL_THRESHOLD,
  calculatePullDistance,
  getPullPhase,
  getPullProgress,
} from "@/lib/pull-to-refresh";
import { cn } from "@/lib/utils";

interface PullToRefreshProps {
  children: React.ReactNode;
  disabled?: boolean;
  className?: string;
}

function hasScrollableParentNotAtTop(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  let current: HTMLElement | null = target;
  while (
    current &&
    current !== document.body &&
    current !== document.documentElement
  ) {
    const style = window.getComputedStyle(current);
    const overflowY = style.overflowY;
    const isScrollable = overflowY === "auto" || overflowY === "scroll";
    if (isScrollable && current.scrollTop > 0) {
      return true;
    }
    current = current.parentElement;
  }

  return false;
}

export function PullToRefresh({
  children,
  disabled = false,
  className,
}: PullToRefreshProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [pullDistance, setPullDistance] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const startXRef = useRef(0);
  const startYRef = useRef(0);
  const trackingRef = useRef(false);
  const pullingRef = useRef(false);
  const distanceRef = useRef(0);
  const crossedThresholdRef = useRef(false);
  const refreshingRef = useRef(false);
  const disabledRef = useRef(disabled);

  useEffect(() => {
    disabledRef.current = disabled;
    if (disabled) {
      trackingRef.current = false;
      pullingRef.current = false;
      distanceRef.current = 0;
    }
  }, [disabled]);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) {
      return;
    }

    let reloadTimeout: number | undefined;

    function resetDrag() {
      trackingRef.current = false;
      pullingRef.current = false;
      crossedThresholdRef.current = false;
      distanceRef.current = 0;
      setIsDragging(false);
      setPullDistance(0);
    }

    function handleTouchStart(event: TouchEvent) {
      if (
        disabledRef.current ||
        refreshingRef.current ||
        event.touches.length !== 1
      ) {
        return;
      }

      if (window.scrollY > 0) {
        return;
      }

      if (document.body.style.overflow === "hidden") {
        return;
      }

      if (hasScrollableParentNotAtTop(event.target)) {
        return;
      }

      const touch = event.touches[0];
      startXRef.current = touch.clientX;
      startYRef.current = touch.clientY;
      trackingRef.current = true;
      pullingRef.current = false;
      crossedThresholdRef.current = false;
      distanceRef.current = 0;
    }

    function handleTouchMove(event: TouchEvent) {
      if (
        !trackingRef.current ||
        disabledRef.current ||
        refreshingRef.current
      ) {
        return;
      }

      if (event.touches.length !== 1) {
        resetDrag();
        return;
      }

      const touch = event.touches[0];
      const deltaX = touch.clientX - startXRef.current;
      const deltaY = touch.clientY - startYRef.current;

      if (!pullingRef.current) {
        if (deltaY <= 0 || window.scrollY > 0) {
          trackingRef.current = false;
          return;
        }
        if (Math.abs(deltaX) > Math.abs(deltaY)) {
          trackingRef.current = false;
          return;
        }
      }

      const nextDistance = calculatePullDistance(deltaY);
      if (nextDistance <= 0) {
        if (pullingRef.current) {
          distanceRef.current = 0;
          setPullDistance(0);
        }
        return;
      }

      if (event.cancelable) {
        event.preventDefault();
      }

      if (!pullingRef.current) {
        pullingRef.current = true;
        setIsDragging(true);
      }

      if (nextDistance >= PULL_THRESHOLD && !crossedThresholdRef.current) {
        crossedThresholdRef.current = true;
        if (typeof navigator !== "undefined" && "vibrate" in navigator) {
          navigator.vibrate(10);
        }
      } else if (nextDistance < PULL_THRESHOLD) {
        crossedThresholdRef.current = false;
      }

      distanceRef.current = nextDistance;
      setPullDistance(nextDistance);
    }

    function handleTouchEnd() {
      if (!trackingRef.current && !pullingRef.current) {
        return;
      }

      const shouldRefresh =
        pullingRef.current &&
        distanceRef.current >= PULL_THRESHOLD &&
        !disabledRef.current &&
        !refreshingRef.current;

      if (shouldRefresh) {
        trackingRef.current = false;
        pullingRef.current = false;
        refreshingRef.current = true;
        distanceRef.current = PULL_REFRESH_HOLD_DISTANCE;
        setIsDragging(false);
        setIsRefreshing(true);
        setPullDistance(PULL_REFRESH_HOLD_DISTANCE);

        reloadTimeout = window.setTimeout(() => {
          window.location.reload();
        }, 150);
      } else {
        resetDrag();
      }
    }

    element.addEventListener("touchstart", handleTouchStart, { passive: true });
    element.addEventListener("touchmove", handleTouchMove, { passive: false });
    element.addEventListener("touchend", handleTouchEnd, { passive: true });
    element.addEventListener("touchcancel", handleTouchEnd, { passive: true });

    return () => {
      if (reloadTimeout !== undefined) {
        window.clearTimeout(reloadTimeout);
      }
      element.removeEventListener("touchstart", handleTouchStart);
      element.removeEventListener("touchmove", handleTouchMove);
      element.removeEventListener("touchend", handleTouchEnd);
      element.removeEventListener("touchcancel", handleTouchEnd);
    };
  }, []);

  const effectiveDistance = disabled && !isRefreshing ? 0 : pullDistance;
  const phase = getPullPhase(effectiveDistance, isRefreshing);
  const progress = getPullProgress(effectiveDistance);
  const showIndicator = phase !== "idle";

  const label =
    phase === "refreshing"
      ? "Atualizando..."
      : phase === "ready"
        ? "Solte para atualizar"
        : "Puxe para atualizar";

  return (
    <div ref={containerRef} className={cn("relative", className)}>
      {/* Indicador flutuante de Pull-to-Refresh */}
      <div
        aria-live="polite"
        className={cn(
          "pointer-events-none fixed inset-x-0 top-16 z-20 flex justify-center lg:hidden",
          !isDragging && "transition-all duration-200 ease-out"
        )}
        style={{
          opacity: showIndicator ? Math.max(0.25, progress) : 0,
          transform: showIndicator
            ? `translateY(${Math.max(0, effectiveDistance - 44)}px) scale(${0.92 + progress * 0.08})`
            : "translateY(-16px) scale(0.9)",
        }}
      >
        <div
          className={cn(
            "flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-xs font-semibold shadow-md backdrop-blur-md transition-colors",
            phase === "ready" || phase === "refreshing"
              ? "border-emerald-200 bg-emerald-50/95 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/95 dark:text-emerald-300"
              : "border-slate-200/90 bg-white/95 text-slate-600 dark:border-slate-700 dark:bg-slate-900/95 dark:text-slate-300"
          )}
        >
          <RefreshCw
            className={cn(
              "h-3.5 w-3.5 shrink-0",
              phase === "refreshing" && "animate-spin"
            )}
            style={
              phase !== "refreshing"
                ? { transform: `rotate(${Math.round(progress * 270)}deg)` }
                : undefined
            }
          />
          <span>{label}</span>
        </div>
      </div>

      {/* Conteúdo deslocado suavemente durante o gesto */}
      <div
        className={cn(!isDragging && "transition-transform duration-200 ease-out")}
        style={
          effectiveDistance > 0
            ? { transform: `translateY(${effectiveDistance}px)` }
            : undefined
        }
      >
        {children}
      </div>
    </div>
  );
}
