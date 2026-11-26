import { cn } from "@/lib/utils";

function SkeletonBlock({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "animate-pulse rounded-lg bg-slate-200/75 dark:bg-slate-800/80",
        className
      )}
    />
  );
}

export function DashboardDefaultSkeleton() {
  return (
    <div
      aria-busy="true"
      aria-label="Carregando página..."
      className="space-y-4 sm:space-y-5"
    >
      {/* Compact Header */}
      <div className="flex items-center justify-between gap-2">
        <SkeletonBlock className="h-7 w-36 rounded-xl" />
        <SkeletonBlock className="h-8 w-8 rounded-xl" />
      </div>

      {/* KPI Strip */}
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 sm:gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="rounded-2xl border border-slate-200/80 bg-white p-3.5 shadow-2xs dark:border-slate-800 dark:bg-slate-900"
          >
            <SkeletonBlock className="h-3 w-20" />
            <SkeletonBlock className="mt-2.5 h-6 w-28" />
            <SkeletonBlock className="mt-2 h-3 w-16" />
          </div>
        ))}
      </div>

      {/* Primary Content Cards */}
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-2xs dark:border-slate-800 dark:bg-slate-900">
          <SkeletonBlock className="h-4 w-40" />
          <SkeletonBlock className="mt-4 h-52 w-full rounded-xl" />
        </div>
        <div className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-2xs dark:border-slate-800 dark:bg-slate-900">
          <SkeletonBlock className="h-4 w-44" />
          <div className="mt-4 space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-center justify-between gap-3">
                <SkeletonBlock className="h-4 w-28" />
                <SkeletonBlock className="h-4 w-20" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export function PortfolioPageSkeleton() {
  return (
    <div
      aria-busy="true"
      aria-label="Carregando carteira..."
      className="space-y-4 sm:space-y-5"
    >
      <div className="flex items-center justify-between gap-2">
        <SkeletonBlock className="h-7 w-28 rounded-xl" />
        <SkeletonBlock className="h-8 w-28 rounded-xl" />
      </div>

      {/* Compact Filter & Search Bar */}
      <div className="rounded-2xl border border-slate-200/80 bg-white p-3 shadow-2xs dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center gap-2">
          <SkeletonBlock className="h-9 flex-1 rounded-xl" />
          <SkeletonBlock className="h-9 w-24 rounded-xl" />
        </div>
      </div>

      {/* Asset List Rows */}
      <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-2xs dark:border-slate-800 dark:bg-slate-900">
        <div className="divide-y divide-slate-100 dark:divide-slate-800">
          {Array.from({ length: 7 }).map((_, i) => (
            <div
              key={i}
              className="flex items-center justify-between gap-3 px-4 py-3.5"
            >
              <div className="space-y-1.5">
                <SkeletonBlock className="h-4 w-20" />
                <SkeletonBlock className="h-3 w-32" />
              </div>
              <div className="flex flex-col items-end space-y-1.5">
                <SkeletonBlock className="h-4 w-24" />
                <SkeletonBlock className="h-3 w-16" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function EvolutionPageSkeleton() {
  return (
    <div
      aria-busy="true"
      aria-label="Carregando evolução..."
      className="space-y-4 sm:space-y-5"
    >
      <div className="flex items-center justify-between gap-2">
        <SkeletonBlock className="h-7 w-28 rounded-xl" />
        <SkeletonBlock className="h-8 w-8 rounded-xl" />
      </div>

      {/* Main 3-Tab Switcher */}
      <div className="grid w-full grid-cols-3 gap-1.5 rounded-xl border border-slate-200 bg-slate-100/80 p-1 sm:w-80 dark:border-slate-800 dark:bg-slate-900">
        <SkeletonBlock className="h-7 w-full rounded-lg" />
        <SkeletonBlock className="h-7 w-full rounded-lg" />
        <SkeletonBlock className="h-7 w-full rounded-lg" />
      </div>

      {/* KPI Strip */}
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 sm:gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="rounded-2xl border border-slate-200/80 bg-white p-3.5 shadow-2xs dark:border-slate-800 dark:bg-slate-900"
          >
            <SkeletonBlock className="h-3 w-20" />
            <SkeletonBlock className="mt-2 h-6 w-24" />
          </div>
        ))}
      </div>

      {/* Main Chart Card */}
      <div className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-2xs dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center justify-between gap-2">
          <SkeletonBlock className="h-4 w-36" />
          <SkeletonBlock className="h-7 w-32 rounded-lg" />
        </div>
        <SkeletonBlock className="mt-4 h-64 w-full rounded-xl" />
      </div>
    </div>
  );
}

export function TransactionsPageSkeleton() {
  return (
    <div
      aria-busy="true"
      aria-label="Carregando lançamentos..."
      className="space-y-4 sm:space-y-5"
    >
      <div className="flex items-center justify-between gap-2">
        <SkeletonBlock className="h-7 w-36 rounded-xl" />
        <SkeletonBlock className="h-8 w-32 rounded-xl" />
      </div>

      <div className="rounded-2xl border border-slate-200/80 bg-white p-3 shadow-2xs dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center gap-2">
          <SkeletonBlock className="h-9 flex-1 rounded-xl" />
          <SkeletonBlock className="h-9 w-28 rounded-xl" />
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-2xs dark:border-slate-800 dark:bg-slate-900">
        <div className="divide-y divide-slate-100 dark:divide-slate-800">
          {Array.from({ length: 8 }).map((_, i) => (
            <div
              key={i}
              className="flex items-center justify-between gap-3 px-4 py-3.5"
            >
              <div className="space-y-1.5">
                <SkeletonBlock className="h-4 w-24" />
                <SkeletonBlock className="h-3 w-20" />
              </div>
              <div className="flex flex-col items-end space-y-1.5">
                <SkeletonBlock className="h-4 w-24" />
                <SkeletonBlock className="h-3 w-14" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function SavingsPageSkeleton() {
  return (
    <div
      aria-busy="true"
      aria-label="Carregando caixinhas..."
      className="space-y-4 sm:space-y-5"
    >
      <div className="flex items-center justify-between gap-2">
        <SkeletonBlock className="h-7 w-32 rounded-xl" />
        <div className="flex items-center gap-1.5">
          <SkeletonBlock className="h-8 w-24 rounded-xl" />
          <SkeletonBlock className="h-8 w-28 rounded-xl" />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div
            key={i}
            className={cn(
              "rounded-xl border border-slate-200/80 bg-white p-3.5 shadow-2xs dark:border-slate-800 dark:bg-slate-900",
              i === 2 && "col-span-2 sm:col-span-1"
            )}
          >
            <SkeletonBlock className="h-3 w-20" />
            <SkeletonBlock className="mt-2 h-6 w-28" />
          </div>
        ))}
      </div>

      <div className="grid w-full grid-cols-3 gap-1.5 rounded-xl border border-slate-200 bg-slate-100/80 p-1 sm:w-80 dark:border-slate-800 dark:bg-slate-900">
        <SkeletonBlock className="h-7 w-full rounded-lg" />
        <SkeletonBlock className="h-7 w-full rounded-lg" />
        <SkeletonBlock className="h-7 w-full rounded-lg" />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-2xs dark:border-slate-800 dark:bg-slate-900"
          >
            <div className="flex items-center justify-between gap-2">
              <SkeletonBlock className="h-4 w-36" />
              <SkeletonBlock className="h-5 w-24" />
            </div>
            <SkeletonBlock className="mt-3 h-2 w-full rounded-full" />
            <SkeletonBlock className="mt-2.5 h-3 w-44" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function MonthlyBudgetPageSkeleton() {
  return (
    <div
      aria-busy="true"
      aria-label="Carregando controle do mês..."
      className="space-y-4 sm:space-y-5"
    >
      <div className="flex items-center justify-between gap-2">
        <SkeletonBlock className="h-7 w-36 rounded-xl" />
        <SkeletonBlock className="h-8 w-32 rounded-xl" />
      </div>

      <div className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-2xs dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center justify-between gap-2">
          <SkeletonBlock className="h-4 w-28" />
          <SkeletonBlock className="h-7 w-28 rounded-lg" />
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2.5 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="space-y-1.5">
              <SkeletonBlock className="h-3 w-20" />
              <SkeletonBlock className="h-5 w-24" />
            </div>
          ))}
        </div>
      </div>

      <div className="grid w-full grid-cols-3 gap-1.5 rounded-xl border border-slate-200 bg-slate-100/80 p-1 sm:w-80 dark:border-slate-800 dark:bg-slate-900">
        <SkeletonBlock className="h-7 w-full rounded-lg" />
        <SkeletonBlock className="h-7 w-full rounded-lg" />
        <SkeletonBlock className="h-7 w-full rounded-lg" />
      </div>

      <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-2xs dark:border-slate-800 dark:bg-slate-900">
        <div className="divide-y divide-slate-100 dark:divide-slate-800">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="flex items-center justify-between gap-3 px-4 py-3"
            >
              <div className="flex items-center gap-2.5">
                <SkeletonBlock className="h-5 w-5 rounded-full" />
                <SkeletonBlock className="h-4 w-32" />
              </div>
              <SkeletonBlock className="h-4 w-20" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

