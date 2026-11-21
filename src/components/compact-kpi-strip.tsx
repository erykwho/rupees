"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface CompactKpiItem {
  id: string;
  label: string;
  value: string;
  icon: ReactNode;
  subtext?: string | null;
  valueClassName?: string;
  highlighted?: boolean;
  mobileFullRow?: boolean;
}

interface CompactKpiStripProps {
  items: CompactKpiItem[];
  columns: 3 | 4;
  className?: string;
}

function getDividerClasses(index: number, columns: 3 | 4, mobileFullRow?: boolean) {
  const borderColor = "border-slate-200/70 dark:border-slate-800";

  if (columns === 3) {
    if (index === 0) return "";
    if (index === 1) return cn("border-l", borderColor);
    if (mobileFullRow) {
      return cn("col-span-2 border-t sm:col-span-1 sm:border-t-0 sm:border-l", borderColor);
    }
    return cn("border-t sm:border-t-0 sm:border-l", borderColor);
  }

  // columns === 4: 2x2 grid below lg, 4 columns from lg+
  if (index === 0) return "";
  if (index === 1) return cn("border-l", borderColor);
  if (index === 2) return cn("border-t lg:border-t-0 lg:border-l", borderColor);
  return cn("border-t border-l lg:border-t-0", borderColor);
}

export function CompactKpiStrip({
  items,
  columns,
  className,
}: CompactKpiStripProps) {
  return (
    <div
      className={cn(
        "overflow-hidden rounded-xl border border-slate-200/80 bg-white shadow-2xs dark:border-slate-800 dark:bg-slate-900",
        className
      )}
    >
      <div
        className={cn(
          "grid grid-cols-2",
          columns === 3 ? "sm:grid-cols-3" : "lg:grid-cols-4"
        )}
      >
        {items.map((item, index) => {
          const isMobileHorizontal = columns === 3 && item.mobileFullRow;

          return (
            <div
              key={item.id}
              className={cn(
                "min-w-0 px-3.5 py-2 sm:px-4 sm:py-2.5",
                getDividerClasses(index, columns, item.mobileFullRow),
                item.highlighted && "bg-emerald-50/50 dark:bg-emerald-950/25",
                isMobileHorizontal
                  ? "flex items-center justify-between gap-2 sm:flex-col sm:items-start sm:justify-center sm:gap-0.5"
                  : "flex flex-col justify-center"
              )}
            >
              <div
                className={cn(
                  "flex min-w-0 items-center gap-1.5 text-[11px] font-medium leading-4",
                  item.highlighted
                    ? "text-emerald-800/90 dark:text-emerald-300/90"
                    : "text-slate-500 dark:text-slate-400"
                )}
              >
                <span className="shrink-0">{item.icon}</span>
                <span className="truncate">{item.label}</span>
              </div>

              <p
                className={cn(
                  "font-mono text-base font-bold leading-6 tracking-tight tabular-nums sm:text-lg",
                  !isMobileHorizontal && "mt-0.5",
                  item.valueClassName ?? "text-slate-900 dark:text-slate-100"
                )}
              >
                {item.value}
              </p>

              {item.subtext && (
                <p className="mt-0.5 truncate text-[11px] leading-4 text-slate-500 tabular-nums dark:text-slate-400">
                  {item.subtext}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
