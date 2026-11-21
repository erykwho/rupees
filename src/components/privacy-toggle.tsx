"use client";

import { Eye, EyeOff } from "lucide-react";
import { usePrivacy } from "@/components/privacy-provider";
import { cn } from "@/lib/utils";

interface PrivacyToggleProps {
  className?: string;
}

export function PrivacyToggle({ className }: PrivacyToggleProps) {
  const { isPrivate, togglePrivacy } = usePrivacy();

  const label = isPrivate
    ? "Mostrar valores"
    : "Ocultar valores (modo privacidade)";

  return (
    <button
      type="button"
      onClick={togglePrivacy}
      title={label}
      aria-label={label}
      aria-pressed={isPrivate}
      className={cn(
        "inline-flex h-8 w-8 items-center justify-center rounded-lg transition-colors",
        isPrivate
          ? "bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-950/60 dark:text-emerald-300 dark:hover:bg-emerald-900/60"
          : "text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100",
        className
      )}
    >
      {isPrivate ? (
        <EyeOff className="h-4 w-4" />
      ) : (
        <Eye className="h-4 w-4" />
      )}
    </button>
  );
}
