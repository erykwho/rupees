"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  browserSupportsWebAuthn,
  startAuthentication,
} from "@simplewebauthn/browser";
import {
  Delete,
  Fingerprint,
  KeyRound,
  Loader2,
  Lock,
  LogOut,
} from "lucide-react";
import { RupeesLogo } from "@/components/rupees-logo";
import { ThemeToggle } from "@/components/theme-toggle";
import { cn } from "@/lib/utils";

interface UnlockScreenProps {
  userName: string | null;
  userEmail: string;
  nextPath: string;
  canUseBiometrics: boolean;
  initialLockoutSeconds: number;
  signOutAction: () => Promise<void>;
}

const PIN_LENGTH = 6;
const KEYPAD_ROWS = [
  ["1", "2", "3"],
  ["4", "5", "6"],
  ["7", "8", "9"],
] as const;

const subscribeNoop = () => () => {};
const getServerWebAuthnSupport = () => false;
const getClientWebAuthnSupport = () => browserSupportsWebAuthn();

export function UnlockScreen({
  userName,
  userEmail,
  nextPath,
  canUseBiometrics,
  initialLockoutSeconds,
  signOutAction,
}: UnlockScreenProps) {
  const supportsWebAuthn = useSyncExternalStore(
    subscribeNoop,
    getClientWebAuthnSupport,
    getServerWebAuthnSupport
  );
  const biometricsAvailable = canUseBiometrics && supportsWebAuthn;
  const [selectedMode, setSelectedMode] = useState<"biometrics" | "pin">(
    canUseBiometrics ? "biometrics" : "pin"
  );
  const mode = biometricsAvailable ? selectedMode : "pin";
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lockoutSeconds, setLockoutSeconds] = useState(initialLockoutSeconds);
  const autoPromptedRef = useRef(false);

  // Contagem regressiva do lockout temporário
  useEffect(() => {
    if (lockoutSeconds <= 0) return;
    const timer = window.setInterval(() => {
      setLockoutSeconds((prev) => (prev <= 1 ? 0 : prev - 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [lockoutSeconds]);

  const handleBiometricUnlock = useCallback(async () => {
    if (!biometricsAvailable) return;

    setBusy(true);
    setError(null);
    try {
      const optionsRes = await fetch("/api/security/webauthn/auth/options", {
        method: "POST",
      });
      const optionsData = await optionsRes.json();
      if (!optionsRes.ok || !optionsData.options) {
        setError(
          optionsData.error || "Não foi possível iniciar a biometria. Use seu PIN."
        );
        setBusy(false);
        return;
      }

      const authResponse = await startAuthentication({
        optionsJSON: optionsData.options,
      });

      const verifyRes = await fetch("/api/security/webauthn/auth/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ response: authResponse }),
      });
      const verifyData = await verifyRes.json();

      if (!verifyRes.ok) {
        setError(
          verifyData.error || "Falha ao validar biometria. Tente novamente ou use o PIN."
        );
        setBusy(false);
        return;
      }

      window.location.replace(nextPath);
    } catch (err) {
      const message =
        err instanceof Error && err.name === "NotAllowedError"
          ? "Biometria cancelada. Toque para tentar novamente ou use o PIN."
          : "Não foi possível usar a biometria neste dispositivo. Use seu PIN.";
      setError(message);
      setBusy(false);
    }
  }, [biometricsAvailable, nextPath]);

  // Disparo automático da biometria ao abrir /unlock
  useEffect(() => {
    if (!biometricsAvailable || autoPromptedRef.current) return;
    autoPromptedRef.current = true;
    const timer = window.setTimeout(() => {
      void handleBiometricUnlock();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [biometricsAvailable, handleBiometricUnlock]);

  const submitPin = useCallback(
    async (candidatePin: string) => {
      if (candidatePin.length !== PIN_LENGTH || busy || lockoutSeconds > 0) {
        return;
      }

      setBusy(true);
      setError(null);

      try {
        const res = await fetch("/api/security/unlock/pin", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pin: candidatePin }),
        });
        const data = await res.json();

        if (!res.ok) {
          setPin("");
          setError(data.error || "PIN incorreto.");
          if (
            typeof data.remainingLockoutSeconds === "number" &&
            data.remainingLockoutSeconds > 0
          ) {
            setLockoutSeconds(data.remainingLockoutSeconds);
          }
          setBusy(false);
          return;
        }

        window.location.replace(nextPath);
      } catch {
        setPin("");
        setError("Erro de conexão ao validar o PIN. Tente novamente.");
        setBusy(false);
      }
    },
    [busy, lockoutSeconds, nextPath]
  );

  const appendDigit = useCallback(
    (digit: string) => {
      if (busy || lockoutSeconds > 0) return;
      setError(null);
      setPin((prev) => {
        if (prev.length >= PIN_LENGTH) return prev;
        const next = prev + digit;
        if (next.length === PIN_LENGTH) {
          void submitPin(next);
        }
        return next;
      });
    },
    [busy, lockoutSeconds, submitPin]
  );

  const removeDigit = useCallback(() => {
    if (busy || lockoutSeconds > 0) return;
    setPin((prev) => prev.slice(0, -1));
  }, [busy, lockoutSeconds]);

  // Suporte a teclado físico no desktop
  useEffect(() => {
    if (mode !== "pin") return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (/^\d$/.test(event.key)) {
        event.preventDefault();
        appendDigit(event.key);
      } else if (event.key === "Backspace") {
        event.preventDefault();
        removeDigit();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [mode, appendDigit, removeDigit]);

  const formatCountdown = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    if (mins === 0) return `${secs}s`;
    return `${mins}m ${String(secs).padStart(2, "0")}s`;
  };

  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center bg-[#f6f7f9] px-4 py-10 dark:bg-slate-950">
      <div className="absolute right-4 top-4">
        <ThemeToggle className="h-9 w-9 rounded-xl border border-slate-200/80 bg-white shadow-2xs dark:border-slate-800 dark:bg-slate-900" />
      </div>

      <div className="w-full max-w-sm rounded-2xl border border-slate-200/90 bg-white p-7 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="mb-6 flex flex-col items-center text-center">
          <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-2xl border border-slate-200/80 bg-slate-50/80 shadow-sm dark:border-slate-800 dark:bg-slate-800/60">
            <RupeesLogo className="h-9 w-9" />
          </div>
          <div className="flex items-center gap-1.5 text-lg font-bold tracking-tight text-slate-900 dark:text-slate-100">
            <Lock className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
            <span>Rupees bloqueado</span>
          </div>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            {userName ? `${userName} · ${userEmail}` : userEmail}
          </p>
        </div>

        {error && (
          <div className="mb-5 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-center text-xs font-medium text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/50 dark:text-rose-300">
            {error}
          </div>
        )}

        {lockoutSeconds > 0 && (
          <div className="mb-5 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-center text-xs font-medium text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/50 dark:text-amber-300">
            Aguarde{" "}
            <span className="font-mono font-semibold">
              {formatCountdown(lockoutSeconds)}
            </span>{" "}
            para tentar o PIN novamente.
          </div>
        )}

        {mode === "biometrics" ? (
          <div className="flex flex-col items-center gap-4 py-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => void handleBiometricUnlock()}
              className="flex w-full items-center justify-center gap-2.5 rounded-xl bg-emerald-600 px-4 py-3.5 text-sm font-semibold text-white shadow-xs transition-all hover:bg-emerald-700 active:scale-[0.99] disabled:opacity-60"
            >
              {busy ? (
                <>
                  <Loader2 className="h-5 w-5 animate-spin" />
                  Aguardando biometria...
                </>
              ) : (
                <>
                  <Fingerprint className="h-5 w-5" />
                  Desbloquear com Biometria
                </>
              )}
            </button>

            <button
              type="button"
              onClick={() => {
                setError(null);
                setSelectedMode("pin");
              }}
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800/70 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              <KeyRound className="h-4 w-4 text-slate-500 dark:text-slate-400" />
              Usar PIN de 6 dígitos
            </button>
          </div>
        ) : (
          <div>
            <p className="mb-4 text-center text-xs font-medium text-slate-500 dark:text-slate-400">
              Digite seu PIN de 6 dígitos
            </p>

            {/* Indicadores do PIN */}
            <div
              className="mb-6 flex items-center justify-center gap-3"
              aria-label={`PIN: ${pin.length} de ${PIN_LENGTH} dígitos preenchidos`}
            >
              {Array.from({ length: PIN_LENGTH }).map((_, index) => {
                const filled = index < pin.length;
                return (
                  <div
                    key={index}
                    className={cn(
                      "h-3.5 w-3.5 rounded-full border transition-all",
                      filled
                        ? "scale-110 border-emerald-600 bg-emerald-600 dark:border-emerald-400 dark:bg-emerald-400"
                        : "border-slate-300 bg-transparent dark:border-slate-600"
                    )}
                  />
                );
              })}
            </div>

            {/* Teclado numérico */}
            <div className="mx-auto grid max-w-[260px] grid-cols-3 gap-3">
              {KEYPAD_ROWS.flat().map((digit) => (
                <button
                  key={digit}
                  type="button"
                  disabled={busy || lockoutSeconds > 0}
                  onClick={() => appendDigit(digit)}
                  className="flex h-14 items-center justify-center rounded-2xl border border-slate-200/90 bg-slate-50/70 text-xl font-semibold text-slate-900 transition-all hover:bg-slate-100 active:scale-95 disabled:opacity-40 dark:border-slate-800 dark:bg-slate-800/60 dark:text-slate-100 dark:hover:bg-slate-800"
                >
                  {digit}
                </button>
              ))}

              <div className="flex items-center justify-center">
                {biometricsAvailable && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      setError(null);
                      setSelectedMode("biometrics");
                      void handleBiometricUnlock();
                    }}
                    title="Usar biometria"
                    aria-label="Usar biometria"
                    className="flex h-14 w-full items-center justify-center rounded-2xl border border-emerald-200/80 bg-emerald-50/80 text-emerald-700 transition-all hover:bg-emerald-100 active:scale-95 disabled:opacity-40 dark:border-emerald-900/60 dark:bg-emerald-950/50 dark:text-emerald-300"
                  >
                    <Fingerprint className="h-5 w-5" />
                  </button>
                )}
              </div>

              <button
                type="button"
                disabled={busy || lockoutSeconds > 0}
                onClick={() => appendDigit("0")}
                className="flex h-14 items-center justify-center rounded-2xl border border-slate-200/90 bg-slate-50/70 text-xl font-semibold text-slate-900 transition-all hover:bg-slate-100 active:scale-95 disabled:opacity-40 dark:border-slate-800 dark:bg-slate-800/60 dark:text-slate-100 dark:hover:bg-slate-800"
              >
                0
              </button>

              <button
                type="button"
                disabled={busy || pin.length === 0 || lockoutSeconds > 0}
                onClick={removeDigit}
                title="Apagar dígito"
                aria-label="Apagar dígito"
                className="flex h-14 items-center justify-center rounded-2xl border border-slate-200/90 bg-slate-50/70 text-slate-600 transition-all hover:bg-slate-100 active:scale-95 disabled:opacity-40 dark:border-slate-800 dark:bg-slate-800/60 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                <Delete className="h-5 w-5" />
              </button>
            </div>

            {busy && (
              <div className="mt-4 flex items-center justify-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Validando PIN...
              </div>
            )}
          </div>
        )}

        <div className="mt-6 border-t border-slate-100 pt-4 dark:border-slate-800">
          <form action={signOutAction} className="flex justify-center">
            <button
              type="submit"
              className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-400 transition-colors hover:text-slate-700 dark:text-slate-500 dark:hover:text-slate-300"
            >
              <LogOut className="h-3.5 w-3.5" />
              Sair da conta
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
