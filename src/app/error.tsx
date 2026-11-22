"use client";

import { useEffect } from "react";
import { RotateCcw } from "lucide-react";
import { RupeesLogo } from "@/components/rupees-logo";

interface ErrorPageProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function AppError({ error, reset }: ErrorPageProps) {
  useEffect(() => {
    console.error("[rupees] Erro não tratado na rota:", error);
  }, [error]);

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col items-center justify-center px-6 text-center">
      <div className="w-full rounded-2xl border border-slate-200/90 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-slate-200/80 bg-slate-50/80 dark:border-slate-800 dark:bg-slate-800/60">
          <RupeesLogo className="h-9 w-9" />
        </div>

        <h1 className="mt-4 text-lg font-semibold tracking-tight text-slate-900 dark:text-slate-100">
          Algo deu errado
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-slate-500 dark:text-slate-400">
          Ocorreu um erro inesperado ao exibir esta tela. Seus dados continuam
          seguros — tente novamente ou recarregue o aplicativo.
        </p>

        <div className="mt-6 grid grid-cols-2 gap-2.5">
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="flex h-11 items-center justify-center rounded-xl border border-slate-200 bg-slate-50 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
          >
            Recarregar app
          </button>
          <button
            type="button"
            onClick={() => reset()}
            className="flex h-11 items-center justify-center gap-1.5 rounded-xl bg-emerald-600 text-xs font-semibold text-white transition-colors hover:bg-emerald-700 dark:bg-emerald-500 dark:text-slate-950 dark:hover:bg-emerald-400"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Tentar novamente
          </button>
        </div>
      </div>
    </div>
  );
}
