import { signIn } from "@/lib/auth";
import { ShieldCheck } from "lucide-react";
import { RupeesLogo } from "@/components/rupees-logo";
import { ThemeToggle } from "@/components/theme-toggle";

export default async function LoginPage(props: {
  searchParams: Promise<{ error?: string }>;
}) {
  const searchParams = await props.searchParams;
  const error = searchParams.error;

  async function handleGoogleSignIn() {
    "use server";
    await signIn("google", { redirectTo: "/" });
  }

  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center bg-[#f6f7f9] px-4 py-12 dark:bg-slate-950">
      <div className="absolute right-4 top-4">
        <ThemeToggle className="h-9 w-9 rounded-xl border border-slate-200/80 bg-white shadow-2xs dark:border-slate-800 dark:bg-slate-900" />
      </div>

      <div className="w-full max-w-sm rounded-2xl border border-slate-200/90 bg-white p-8 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="mb-6 flex flex-col items-center text-center">
          <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl border border-slate-200/80 bg-slate-50/80 shadow-sm dark:border-slate-800 dark:bg-slate-800/60">
            <RupeesLogo className="h-11 w-11" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
            Rupees
          </h1>
          <p className="mt-1.5 text-sm text-slate-500 dark:text-slate-400">
            Controle pessoal de investimentos — B3, EUA e Renda Fixa.
          </p>
        </div>

        {error && (
          <div className="mb-5 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs font-medium text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/50 dark:text-rose-300">
            {error === "AccessDenied"
              ? "Acesso negado. Sua conta Google não está na lista de e-mails autorizados."
              : "Não foi possível completar o login. Tente novamente."}
          </div>
        )}

        <form action={handleGoogleSignIn}>
          <button
            type="submit"
            className="flex w-full items-center justify-center gap-3 rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-800 shadow-xs transition-all hover:border-slate-400 hover:bg-slate-50 active:scale-[0.99] dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:hover:border-slate-600 dark:hover:bg-slate-700/80"
          >
            <svg className="h-5 w-5" viewBox="0 0 24 24">
              <path
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                fill="#4285F4"
              />
              <path
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                fill="#34A853"
              />
              <path
                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                fill="#FBBC05"
              />
              <path
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                fill="#EA4335"
              />
            </svg>
            Entrar com Google
          </button>
        </form>

        <div className="mt-6 flex items-center justify-center gap-2 text-xs text-slate-400 dark:text-slate-500">
          <ShieldCheck className="h-4 w-4 text-emerald-600 dark:text-emerald-500" />
          <span>Acesso restrito a contas autorizadas</span>
        </div>
      </div>
    </div>
  );
}
