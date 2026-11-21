"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ArrowLeftRight,
  ChevronLeft,
  ChevronRight,
  Compass,
  LayoutDashboard,
  LogOut,
  Menu,
  PieChart,
  RefreshCw,
  Target,
  TrendingUp,
  X,
} from "lucide-react";
import { PrivacyToggle } from "@/components/privacy-toggle";
import { PullToRefresh } from "@/components/pull-to-refresh";
import { RupeesLogo } from "@/components/rupees-logo";
import { ThemeToggle } from "@/components/theme-toggle";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { href: "/", label: "Geral", fullLabel: "Visão Geral", icon: LayoutDashboard },
  { href: "/carteira", label: "Carteira", fullLabel: "Carteira", icon: PieChart },
  {
    href: "/evolucao",
    label: "Evolução",
    fullLabel: "Evolução",
    icon: TrendingUp,
  },
  {
    href: "/lancamentos",
    label: "Lançamentos",
    fullLabel: "Lançamentos",
    icon: ArrowLeftRight,
  },
  {
    href: "/aporte",
    label: "Aporte",
    fullLabel: "Plano de Aporte",
    icon: Compass,
  },
  { href: "/objetivos", label: "Objetivos", fullLabel: "Objetivos", icon: Target },
];

const MOBILE_NAV_ITEMS = NAV_ITEMS.filter((item) => item.href !== "/objetivos");
const SIDEBAR_STORAGE_KEY = "rupees-sidebar-collapsed";
const sidebarListeners = new Set<() => void>();

function emitSidebarChange() {
  sidebarListeners.forEach((listener) => listener());
}

function getClientSidebarCollapsed(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(SIDEBAR_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

function getServerSidebarCollapsed(): boolean {
  return false;
}

function subscribeSidebar(listener: () => void) {
  sidebarListeners.add(listener);
  const handleStorage = (event: StorageEvent) => {
    if (event.key === SIDEBAR_STORAGE_KEY) {
      emitSidebarChange();
    }
  };
  window.addEventListener("storage", handleStorage);
  return () => {
    sidebarListeners.delete(listener);
    window.removeEventListener("storage", handleStorage);
  };
}

interface AppShellProps {
  user: {
    name?: string | null;
    email?: string | null;
    image?: string | null;
  };
  signOutAction: () => Promise<void>;
  children: React.ReactNode;
}

function BrandLogo({ size = "md" }: { size?: "sm" | "md" }) {
  const boxClass = size === "sm" ? "h-8 w-8 rounded-lg" : "h-9 w-9 rounded-xl";
  const svgClass = size === "sm" ? "h-5 w-5" : "h-6 w-6";

  return (
    <div
      className={cn(
        "flex shrink-0 items-center justify-center border border-slate-200/80 bg-slate-50/80 shadow-2xs dark:border-slate-800 dark:bg-slate-800/60",
        boxClass
      )}
    >
      <RupeesLogo className={svgClass} />
    </div>
  );
}

export function AppShell({ user, signOutAction, children }: AppShellProps) {
  const pathname = usePathname();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const desktopCollapsed = useSyncExternalStore(
    subscribeSidebar,
    getClientSidebarCollapsed,
    getServerSidebarCollapsed
  );
  const drawerTouchStartRef = useRef<{ x: number; y: number } | null>(null);

  function toggleDesktopSidebar() {
    const next = !desktopCollapsed;
    try {
      window.localStorage.setItem(SIDEBAR_STORAGE_KEY, String(next));
    } catch {
      // Ignore storage failures in restricted contexts
    }
    emitSidebarChange();
  }

  useEffect(() => {
    if (!mobileMenuOpen) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setMobileMenuOpen(false);
      }
    }

    function handlePopState() {
      setMobileMenuOpen(false);
    }

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("popstate", handlePopState);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("popstate", handlePopState);
    };
  }, [mobileMenuOpen]);

  function handleDrawerTouchStart(event: React.TouchEvent<HTMLElement>) {
    if (event.touches.length !== 1) {
      drawerTouchStartRef.current = null;
      return;
    }
    const touch = event.touches[0];
    drawerTouchStartRef.current = { x: touch.clientX, y: touch.clientY };
  }

  function handleDrawerTouchEnd(event: React.TouchEvent<HTMLElement>) {
    const start = drawerTouchStartRef.current;
    drawerTouchStartRef.current = null;
    if (!start || event.changedTouches.length === 0) {
      return;
    }

    const touch = event.changedTouches[0];
    const deltaX = touch.clientX - start.x;
    const deltaY = touch.clientY - start.y;

    if (deltaX < -56 && Math.abs(deltaX) > Math.abs(deltaY)) {
      setMobileMenuOpen(false);
    }
  }

  function handleManualReload() {
    setMobileMenuOpen(false);
    window.location.reload();
  }

  const renderNavLinks = (options?: {
    onNavigate?: () => void;
    collapsed?: boolean;
  }) => {
    const collapsed = options?.collapsed ?? false;

    return NAV_ITEMS.map((item) => {
      const Icon = item.icon;
      const active =
        item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);

      return (
        <Link
          key={item.href}
          href={item.href}
          onClick={options?.onNavigate}
          title={collapsed ? item.fullLabel : undefined}
          aria-label={collapsed ? item.fullLabel : undefined}
          className={cn(
            "flex items-center rounded-xl py-2.5 text-sm font-medium transition-colors",
            collapsed ? "justify-center px-2" : "gap-3 px-3.5",
            active
              ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300"
              : "text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
          )}
        >
          <Icon
            className={cn(
              "h-[18px] w-[18px] shrink-0",
              active
                ? "text-emerald-600 dark:text-emerald-400"
                : "text-slate-400 dark:text-slate-500"
            )}
          />
          {!collapsed && <span className="truncate">{item.fullLabel}</span>}
        </Link>
      );
    });
  };

  const userAvatar = user.image ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={user.image}
      alt={user.name ?? "Usuário"}
      title={user.name ?? user.email ?? "Investidor"}
      className="h-9 w-9 shrink-0 rounded-full border border-slate-200 object-cover dark:border-slate-700"
    />
  ) : (
    <div
      title={user.name ?? user.email ?? "Investidor"}
      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-xs font-bold text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
    >
      {(user.name ?? user.email ?? "U").slice(0, 2).toUpperCase()}
    </div>
  );

  const signOutButton = (
    <form action={signOutAction}>
      <button
        type="submit"
        title="Sair"
        aria-label="Sair"
        className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 dark:text-slate-500 dark:hover:bg-slate-800 dark:hover:text-slate-200"
      >
        <LogOut className="h-4 w-4" />
      </button>
    </form>
  );

  const userFooter = (
    <div className="flex items-center gap-3">
      {userAvatar}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">
          {user.name ?? "Investidor"}
        </p>
        <p className="truncate text-xs text-slate-500 dark:text-slate-400">
          {user.email}
        </p>
      </div>
      {signOutButton}
    </div>
  );

  return (
    <div className="min-h-screen bg-[#f6f7f9] text-slate-900 dark:bg-slate-950 dark:text-slate-100 lg:flex">
      {/* Desktop Sidebar */}
      <aside
        className={cn(
          "hidden lg:fixed lg:inset-y-0 lg:left-0 lg:z-30 lg:flex lg:flex-col lg:border-r lg:border-slate-200/80 lg:bg-white lg:transition-[width] lg:duration-200 lg:ease-out dark:lg:border-slate-800 dark:lg:bg-slate-900",
          desktopCollapsed ? "lg:w-20" : "lg:w-64"
        )}
      >
        {/* Collapse / Expand Toggle Button */}
        <button
          type="button"
          onClick={toggleDesktopSidebar}
          title={
            desktopCollapsed ? "Expandir barra lateral" : "Recolher barra lateral"
          }
          aria-label={
            desktopCollapsed ? "Expandir barra lateral" : "Recolher barra lateral"
          }
          aria-expanded={!desktopCollapsed}
          className="absolute -right-3.5 top-5 z-10 flex h-7 w-7 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 shadow-xs transition-colors hover:bg-slate-50 hover:text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
        >
          {desktopCollapsed ? (
            <ChevronRight className="h-4 w-4" />
          ) : (
            <ChevronLeft className="h-4 w-4" />
          )}
        </button>

        <div
          className={cn(
            "flex h-16 items-center",
            desktopCollapsed ? "justify-center px-3" : "justify-between gap-2 px-4"
          )}
        >
          <Link
            href="/"
            title="Rupees — Visão Geral"
            className="flex min-w-0 items-center gap-2.5"
          >
            <BrandLogo />
            {!desktopCollapsed && (
              <div className="min-w-0">
                <span className="block truncate text-base font-bold tracking-tight text-slate-900 dark:text-slate-100">
                  Rupees
                </span>
                <p className="truncate text-[11px] font-medium text-slate-500 dark:text-slate-400">
                  Controle de Investimentos
                </p>
              </div>
            )}
          </Link>
          {!desktopCollapsed && (
            <div className="flex shrink-0 items-center gap-0.5">
              <PrivacyToggle />
              <ThemeToggle />
            </div>
          )}
        </div>

        <nav
          className="flex-1 space-y-1 px-3 py-4"
          aria-label="Navegação principal"
        >
          {renderNavLinks({ collapsed: desktopCollapsed })}
        </nav>

        <div
          className={cn(
            "border-t border-slate-200/80 dark:border-slate-800",
            desktopCollapsed ? "p-3" : "p-4"
          )}
        >
          {desktopCollapsed ? (
            <div className="flex flex-col items-center gap-2">
              <PrivacyToggle />
              <ThemeToggle />
              {userAvatar}
              {signOutButton}
            </div>
          ) : (
            userFooter
          )}
        </div>
      </aside>

      {/* Mobile Sidebar Drawer */}
      <div
        aria-hidden={!mobileMenuOpen}
        className={cn(
          "fixed inset-0 z-40 lg:hidden",
          mobileMenuOpen ? "pointer-events-auto" : "pointer-events-none"
        )}
      >
        {/* Backdrop */}
        <div
          onClick={() => setMobileMenuOpen(false)}
          className={cn(
            "fixed inset-0 bg-slate-900/50 backdrop-blur-xs transition-opacity duration-200 dark:bg-slate-950/70",
            mobileMenuOpen ? "opacity-100" : "opacity-0"
          )}
        />

        {/* Drawer Panel */}
        <aside
          role="dialog"
          aria-modal={mobileMenuOpen}
          aria-label="Menu de navegação"
          onTouchStart={handleDrawerTouchStart}
          onTouchEnd={handleDrawerTouchEnd}
          className={cn(
            "fixed inset-y-0 left-0 flex w-72 max-w-[82vw] flex-col border-r border-slate-200/80 bg-white shadow-2xl transition-transform duration-200 ease-out dark:border-slate-800 dark:bg-slate-900",
            mobileMenuOpen ? "translate-x-0" : "-translate-x-full"
          )}
        >
          <div className="flex h-16 items-center justify-between gap-2 border-b border-slate-200/80 px-4 dark:border-slate-800">
            <Link
              href="/"
              onClick={() => setMobileMenuOpen(false)}
              className="flex items-center gap-3"
            >
              <BrandLogo />
              <div>
                <span className="text-base font-bold tracking-tight text-slate-900 dark:text-slate-100">
                  Rupees
                </span>
                <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                  Controle de Investimentos
                </p>
              </div>
            </Link>

            <button
              type="button"
              onClick={() => setMobileMenuOpen(false)}
              aria-label="Fechar menu"
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <nav
            className="flex-1 space-y-1 overflow-y-auto px-3 py-4"
            aria-label="Menu lateral mobile"
          >
            {renderNavLinks({ onNavigate: () => setMobileMenuOpen(false) })}
          </nav>

          <div className="px-3 pb-3">
            <button
              type="button"
              onClick={handleManualReload}
              className="flex w-full items-center gap-3 rounded-xl border border-slate-200/80 bg-slate-50/80 px-3.5 py-2.5 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 dark:border-slate-800 dark:bg-slate-800/50 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-slate-100"
            >
              <RefreshCw className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
              Atualizar aplicativo
            </button>
          </div>

          <div className="pb-safe border-t border-slate-200/80 px-4 pt-4 dark:border-slate-800">
            {userFooter}
          </div>
        </aside>
      </div>

      {/* Mobile Top Header */}
      <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-slate-200/80 bg-white/90 px-3 backdrop-blur-md dark:border-slate-800 dark:bg-slate-900/90 lg:hidden">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setMobileMenuOpen(true)}
            aria-label="Abrir menu de navegação"
            aria-expanded={mobileMenuOpen}
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-slate-100"
          >
            <Menu className="h-5 w-5" />
          </button>

          <Link href="/" className="flex items-center gap-2">
            <BrandLogo size="sm" />
            <span className="text-base font-bold tracking-tight text-slate-900 dark:text-slate-100">
              Rupees
            </span>
          </Link>
        </div>

        <div className="flex items-center gap-1">
          <PrivacyToggle />
          <ThemeToggle />
        </div>
      </header>

      {/* Main Content */}
      <main
        className={cn(
          "flex-1 pb-24 lg:pb-10 lg:transition-[padding-left] lg:duration-200 lg:ease-out",
          desktopCollapsed ? "lg:pl-20" : "lg:pl-64"
        )}
      >
        <PullToRefresh disabled={mobileMenuOpen}>
          <div className="mx-auto max-w-6xl px-4 py-5 sm:px-6 lg:px-8 lg:py-8">
            {children}
          </div>
        </PullToRefresh>
      </main>

      {/* Mobile Bottom Tab Bar */}
      <nav
        aria-label="Navegação inferior"
        className="pb-safe fixed inset-x-0 bottom-0 z-30 border-t border-slate-200/90 bg-white/95 backdrop-blur-md dark:border-slate-800 dark:bg-slate-900/95 lg:hidden"
      >
        <div className="grid grid-cols-5">
          {MOBILE_NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active =
              item.href === "/"
                ? pathname === "/"
                : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex flex-col items-center justify-center gap-1 py-2.5 text-[11px] font-medium transition-colors",
                  active
                    ? "text-emerald-700 dark:text-emerald-400"
                    : "text-slate-500 dark:text-slate-400"
                )}
              >
                <Icon
                  className={cn(
                    "h-5 w-5",
                    active
                      ? "text-emerald-600 dark:text-emerald-400"
                      : "text-slate-400 dark:text-slate-500"
                  )}
                />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
