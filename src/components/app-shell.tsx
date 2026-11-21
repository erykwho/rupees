"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ArrowLeftRight,
  Compass,
  LayoutDashboard,
  LogOut,
  PieChart,
  Target,
} from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { href: "/", label: "Geral", fullLabel: "Visão Geral", icon: LayoutDashboard },
  { href: "/carteira", label: "Carteira", fullLabel: "Carteira", icon: PieChart },
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

interface AppShellProps {
  user: {
    name?: string | null;
    email?: string | null;
    image?: string | null;
  };
  signOutAction: () => Promise<void>;
  children: React.ReactNode;
}

export function AppShell({ user, signOutAction, children }: AppShellProps) {
  const pathname = usePathname();

  return (
    <div className="min-h-screen bg-[#f6f7f9] text-slate-900 dark:bg-slate-950 dark:text-slate-100 lg:flex">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:fixed lg:inset-y-0 lg:left-0 lg:z-30 lg:flex lg:w-64 lg:flex-col lg:border-r lg:border-slate-200/80 lg:bg-white dark:lg:border-slate-800 dark:lg:bg-slate-900">
        <div className="flex h-16 items-center justify-between gap-2 px-5">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-emerald-600 shadow-sm shadow-emerald-600/20">
              <svg viewBox="0 0 32 32" className="h-5 w-5" fill="none">
                <path
                  d="M16 4L25 10.5V21.5L16 28L7 21.5V10.5L16 4Z"
                  fill="#A7F3D0"
                />
                <path d="M16 4L25 10.5L16 15L7 10.5L16 4Z" fill="#ECFDF5" />
                <path d="M16 15L25 10.5V21.5L16 28V15Z" fill="#059669" />
              </svg>
            </div>
            <div>
              <span className="text-base font-bold tracking-tight text-slate-900 dark:text-slate-100">
                Rupees
              </span>
              <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                Controle de Investimentos
              </p>
            </div>
          </div>
          <ThemeToggle />
        </div>

        <nav className="flex-1 space-y-1 px-3 py-4" aria-label="Navegação principal">
          {NAV_ITEMS.map((item) => {
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
                  "flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-medium transition-colors",
                  active
                    ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300"
                    : "text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
                )}
              >
                <Icon
                  className={cn(
                    "h-[18px] w-[18px]",
                    active
                      ? "text-emerald-600 dark:text-emerald-400"
                      : "text-slate-400 dark:text-slate-500"
                  )}
                />
                {item.fullLabel}
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-slate-200/80 p-4 dark:border-slate-800">
          <div className="flex items-center gap-3">
            {user.image ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={user.image}
                alt={user.name ?? "Usuário"}
                className="h-9 w-9 rounded-full border border-slate-200 object-cover dark:border-slate-700"
              />
            ) : (
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-emerald-100 text-xs font-bold text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
                {(user.name ?? user.email ?? "U").slice(0, 2).toUpperCase()}
              </div>
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">
                {user.name ?? "Investidor"}
              </p>
              <p className="truncate text-xs text-slate-500 dark:text-slate-400">
                {user.email}
              </p>
            </div>
            <form action={signOutAction}>
              <button
                type="submit"
                title="Sair"
                className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 dark:text-slate-500 dark:hover:bg-slate-800 dark:hover:text-slate-200"
              >
                <LogOut className="h-4 w-4" />
              </button>
            </form>
          </div>
        </div>
      </aside>

      {/* Mobile Top Header */}
      <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-slate-200/80 bg-white/90 px-4 backdrop-blur-md dark:border-slate-800 dark:bg-slate-900/90 lg:hidden">
        <Link href="/" className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-600 shadow-sm">
            <svg viewBox="0 0 32 32" className="h-4 w-4" fill="none">
              <path
                d="M16 4L25 10.5V21.5L16 28L7 21.5V10.5L16 4Z"
                fill="#A7F3D0"
              />
              <path d="M16 4L25 10.5L16 15L7 10.5L16 4Z" fill="#ECFDF5" />
            </svg>
          </div>
          <span className="text-base font-bold tracking-tight text-slate-900 dark:text-slate-100">
            Rupees
          </span>
        </Link>

        <div className="flex items-center gap-1">
          <ThemeToggle />
          <form action={signOutAction}>
            <button
              type="submit"
              className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              <LogOut className="h-3.5 w-3.5" />
              Sair
            </button>
          </form>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 pb-24 lg:pb-10 lg:pl-64">
        <div className="mx-auto max-w-6xl px-4 py-5 sm:px-6 lg:px-8 lg:py-8">
          {children}
        </div>
      </main>

      {/* Mobile Bottom Tab Bar */}
      <nav
        aria-label="Navegação inferior"
        className="pb-safe fixed inset-x-0 bottom-0 z-30 border-t border-slate-200/90 bg-white/95 backdrop-blur-md dark:border-slate-800 dark:bg-slate-900/95 lg:hidden"
      >
        <div className="grid grid-cols-5">
          {NAV_ITEMS.map((item) => {
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
