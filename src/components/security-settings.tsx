"use client";

import { useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import {
  browserSupportsWebAuthn,
  startRegistration,
} from "@simplewebauthn/browser";
import {
  CheckCircle2,
  Clock,
  Fingerprint,
  KeyRound,
  Loader2,
  ShieldCheck,
  ShieldOff,
  Smartphone,
  Trash2,
} from "lucide-react";
import {
  APP_LOCK_TIMEOUT_LABELS,
  APP_LOCK_TIMEOUT_OPTIONS,
  type AppLockTimeoutMinutes,
} from "@/lib/domain/security";
import { cn } from "@/lib/utils";

interface CredentialItem {
  id: string;
  deviceName: string;
  createdAt: string;
  lastUsedAt: string | null;
}

interface SecuritySettingsProps {
  initialEnabled: boolean;
  initialTimeoutMinutes: AppLockTimeoutMinutes;
  initialRequirePinOnly: boolean;
  initialCredentials: CredentialItem[];
}

const subscribeNoop = () => () => {};
const getServerWebAuthnSupport = () => false;
const getClientWebAuthnSupport = () => browserSupportsWebAuthn();

function guessDeviceName(): string {
  if (typeof navigator === "undefined") return "Dispositivo atual";
  const ua = navigator.userAgent;
  if (/iPhone/i.test(ua)) return "iPhone";
  if (/iPad/i.test(ua)) return "iPad";
  if (/Android/i.test(ua)) return "Celular Android";
  if (/Macintosh|Mac OS/i.test(ua)) return "Mac";
  if (/Windows/i.test(ua)) return "Windows";
  if (/Linux/i.test(ua)) return "Linux";
  return "Dispositivo atual";
}

function formatDatePtBr(iso: string | null): string {
  if (!iso) return "Nunca usado";
  try {
    return new Intl.DateTimeFormat("pt-BR", {
      dateStyle: "short",
      timeStyle: "short",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export function SecuritySettings({
  initialEnabled,
  initialTimeoutMinutes,
  initialRequirePinOnly,
  initialCredentials,
}: SecuritySettingsProps) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(initialEnabled);
  const [timeoutMinutes, setTimeoutMinutes] =
    useState<AppLockTimeoutMinutes>(initialTimeoutMinutes);
  const [requirePinOnly, setRequirePinOnly] = useState(initialRequirePinOnly);
  const [credentials, setCredentials] =
    useState<CredentialItem[]>(initialCredentials);

  const supportsWebAuthn = useSyncExternalStore(
    subscribeNoop,
    getClientWebAuthnSupport,
    getServerWebAuthnSupport
  );
  const suggestedDeviceName = useSyncExternalStore(
    subscribeNoop,
    guessDeviceName,
    () => "Dispositivo atual"
  );
  const [deviceName, setDeviceName] = useState("");

  // PIN form states
  const [newPin, setNewPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [currentPin, setCurrentPin] = useState("");
  const [pinPanel, setPinPanel] = useState<"none" | "change" | "disable">(
    "none"
  );

  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  function sanitizePinInput(value: string): string {
    return value.replace(/\D/g, "").slice(0, 6);
  }

  async function handleEnablePin(event: React.FormEvent) {
    event.preventDefault();
    setFeedback(null);

    if (newPin.length !== 6) {
      setFeedback({
        type: "error",
        text: "Digite um PIN numérico de 6 dígitos.",
      });
      return;
    }
    if (newPin !== confirmPin) {
      setFeedback({
        type: "error",
        text: "A confirmação do PIN não confere.",
      });
      return;
    }

    setBusyAction("enable");
    try {
      const res = await fetch("/api/security/pin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "enable",
          pin: newPin,
          timeoutMinutes,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setFeedback({
          type: "error",
          text: data.error || "Não foi possível ativar o bloqueio.",
        });
        return;
      }

      setEnabled(true);
      setNewPin("");
      setConfirmPin("");
      setFeedback({
        type: "success",
        text: "Bloqueio ativado.",
      });
      router.refresh();
    } catch {
      setFeedback({
        type: "error",
        text: "Erro de conexão ao ativar o bloqueio.",
      });
    } finally {
      setBusyAction(null);
    }
  }

  async function handleChangePin(event: React.FormEvent) {
    event.preventDefault();
    setFeedback(null);

    if (currentPin.length !== 6 || newPin.length !== 6) {
      setFeedback({
        type: "error",
        text: "Informe o PIN atual e o novo PIN com 6 dígitos.",
      });
      return;
    }
    if (newPin !== confirmPin) {
      setFeedback({
        type: "error",
        text: "A confirmação do novo PIN não confere.",
      });
      return;
    }

    setBusyAction("change");
    try {
      const res = await fetch("/api/security/pin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "change",
          currentPin,
          newPin,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setFeedback({
          type: "error",
          text: data.error || "Não foi possível alterar o PIN.",
        });
        return;
      }

      setCurrentPin("");
      setNewPin("");
      setConfirmPin("");
      setPinPanel("none");
      setFeedback({
        type: "success",
        text: "PIN alterado.",
      });
    } catch {
      setFeedback({
        type: "error",
        text: "Erro de conexão ao alterar o PIN.",
      });
    } finally {
      setBusyAction(null);
    }
  }

  async function handleDisablePin(event: React.FormEvent) {
    event.preventDefault();
    setFeedback(null);

    if (currentPin.length !== 6) {
      setFeedback({
        type: "error",
        text: "Informe seu PIN atual de 6 dígitos.",
      });
      return;
    }

    setBusyAction("disable");
    try {
      const res = await fetch("/api/security/pin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "disable",
          currentPin,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setFeedback({
          type: "error",
          text: data.error || "Não foi possível desativar o bloqueio.",
        });
        return;
      }

      setEnabled(false);
      setRequirePinOnly(false);
      setCurrentPin("");
      setPinPanel("none");
      setFeedback({
        type: "success",
        text: "Bloqueio desativado.",
      });
      router.refresh();
    } catch {
      setFeedback({
        type: "error",
        text: "Erro de conexão ao desativar o bloqueio.",
      });
    } finally {
      setBusyAction(null);
    }
  }

  async function handleTimeoutChange(nextTimeout: AppLockTimeoutMinutes) {
    setFeedback(null);
    setTimeoutMinutes(nextTimeout);
    if (!enabled) return;

    setBusyAction("timeout");
    try {
      const res = await fetch("/api/security/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ timeoutMinutes: nextTimeout }),
      });
      const data = await res.json();
      if (!res.ok) {
        setFeedback({
          type: "error",
          text: data.error || "Erro ao salvar inatividade.",
        });
        return;
      }
      setFeedback({
        type: "success",
        text: `Inatividade: ${APP_LOCK_TIMEOUT_LABELS[nextTimeout]}.`,
      });
    } catch {
      setFeedback({
        type: "error",
        text: "Erro de conexão ao salvar inatividade.",
      });
    } finally {
      setBusyAction(null);
    }
  }

  async function handleToggleRequirePinOnly() {
    setFeedback(null);
    const nextValue = !requirePinOnly;
    setBusyAction("requirePinOnly");
    try {
      const res = await fetch("/api/security/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requirePinOnly: nextValue }),
      });
      const data = await res.json();
      if (!res.ok) {
        setFeedback({
          type: "error",
          text: data.error || "Erro ao atualizar preferência.",
        });
        return;
      }
      setRequirePinOnly(nextValue);
      setFeedback({
        type: "success",
        text: nextValue ? "Apenas PIN ativado." : "Biometria liberada.",
      });
    } catch {
      setFeedback({
        type: "error",
        text: "Erro de conexão ao atualizar preferência.",
      });
    } finally {
      setBusyAction(null);
    }
  }

  async function handleRegisterBiometrics() {
    setFeedback(null);
    setBusyAction("registerBiometrics");
    try {
      const optionsRes = await fetch("/api/security/webauthn/register/options", {
        method: "POST",
      });
      const optionsData = await optionsRes.json();
      if (!optionsRes.ok || !optionsData.options) {
        setFeedback({
          type: "error",
          text:
            optionsData.error || "Não foi possível iniciar o cadastro biométrico.",
        });
        return;
      }

      const registrationResponse = await startRegistration({
        optionsJSON: optionsData.options,
      });

      const verifyRes = await fetch("/api/security/webauthn/register/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          response: registrationResponse,
          deviceName: deviceName.trim() || suggestedDeviceName,
        }),
      });
      const verifyData = await verifyRes.json();
      if (!verifyRes.ok || !verifyData.credential) {
        setFeedback({
          type: "error",
          text: verifyData.error || "Não foi possível salvar a biometria.",
        });
        return;
      }

      setCredentials((prev) => [
        verifyData.credential,
        ...prev.filter((item) => item.id !== verifyData.credential.id),
      ]);
      setDeviceName("");
      setFeedback({
        type: "success",
        text: `Biometria cadastrada (${verifyData.credential.deviceName}).`,
      });
    } catch (err) {
      const text =
        err instanceof Error && err.name === "NotAllowedError"
          ? "Cadastro biométrico cancelado."
          : "Não foi possível cadastrar a biometria neste dispositivo.";
      setFeedback({ type: "error", text });
    } finally {
      setBusyAction(null);
    }
  }

  async function handleDeleteCredential(id: string) {
    setFeedback(null);
    setBusyAction(`delete:${id}`);
    try {
      const res = await fetch(`/api/security/webauthn/credentials/${id}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (!res.ok) {
        setFeedback({
          type: "error",
          text: data.error || "Não foi possível remover o dispositivo.",
        });
        return;
      }
      setCredentials((prev) => prev.filter((item) => item.id !== id));
      setFeedback({
        type: "success",
        text: "Dispositivo removido.",
      });
    } catch {
      setFeedback({
        type: "error",
        text: "Erro de conexão ao remover o dispositivo.",
      });
    } finally {
      setBusyAction(null);
    }
  }

  return (
    <div className="space-y-4 sm:space-y-5">
      <h1 className="text-xl font-bold tracking-tight text-slate-900 sm:text-2xl dark:text-slate-100">
        Segurança
      </h1>

      {feedback && (
        <div
          className={cn(
            "flex items-center gap-2 rounded-xl border px-3.5 py-2.5 text-xs font-medium",
            feedback.type === "success"
              ? "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300"
              : "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-300"
          )}
        >
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          <span>{feedback.text}</span>
        </div>
      )}

      {/* Unified Settings Card */}
      <section className="divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-2xs dark:divide-slate-800 dark:border-slate-800 dark:bg-slate-900">
        {/* Row 1: App Lock / PIN */}
        <div className="p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2.5">
              <div
                className={cn(
                  "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
                  enabled
                    ? "bg-emerald-50 text-emerald-600 dark:bg-emerald-950/60 dark:text-emerald-400"
                    : "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400"
                )}
              >
                {enabled ? (
                  <ShieldCheck className="h-4 w-4" />
                ) : (
                  <ShieldOff className="h-4 w-4" />
                )}
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  Bloqueio por PIN
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {enabled ? "Ativo (6 dígitos)" : "Desativado"}
                </p>
              </div>
            </div>

            {enabled && (
              <div className="flex shrink-0 items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => {
                    setFeedback(null);
                    setCurrentPin("");
                    setNewPin("");
                    setConfirmPin("");
                    setPinPanel((prev) =>
                      prev === "change" ? "none" : "change"
                    );
                  }}
                  className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                >
                  Alterar
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setFeedback(null);
                    setCurrentPin("");
                    setPinPanel((prev) =>
                      prev === "disable" ? "none" : "disable"
                    );
                  }}
                  className="rounded-lg border border-rose-200 bg-rose-50/70 px-2.5 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-100 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-300"
                >
                  Desativar
                </button>
              </div>
            )}
          </div>

          {!enabled ? (
            <form onSubmit={handleEnablePin} className="mt-4 space-y-3.5">
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
                    PIN (6 dígitos)
                  </label>
                  <input
                    type="password"
                    inputMode="numeric"
                    autoComplete="new-password"
                    maxLength={6}
                    value={newPin}
                    onChange={(e) => setNewPin(sanitizePinInput(e.target.value))}
                    placeholder="••••••"
                    className="w-full rounded-xl border border-slate-200 bg-slate-50/60 px-3 py-2 font-mono text-sm tracking-[0.35em] text-slate-900 outline-none focus:border-emerald-500 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-100"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
                    Confirmar PIN
                  </label>
                  <input
                    type="password"
                    inputMode="numeric"
                    autoComplete="new-password"
                    maxLength={6}
                    value={confirmPin}
                    onChange={(e) =>
                      setConfirmPin(sanitizePinInput(e.target.value))
                    }
                    placeholder="••••••"
                    className="w-full rounded-xl border border-slate-200 bg-slate-50/60 px-3 py-2 font-mono text-sm tracking-[0.35em] text-slate-900 outline-none focus:border-emerald-500 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-100"
                  />
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap gap-1.5">
                  {APP_LOCK_TIMEOUT_OPTIONS.map((option) => (
                    <button
                      key={option}
                      type="button"
                      onClick={() => setTimeoutMinutes(option)}
                      className={cn(
                        "rounded-lg border px-2.5 py-1 text-xs font-semibold transition-colors",
                        timeoutMinutes === option
                          ? "border-emerald-600 bg-emerald-50 text-emerald-700 dark:border-emerald-500 dark:bg-emerald-950/60 dark:text-emerald-300"
                          : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800/50 dark:text-slate-300"
                      )}
                    >
                      {APP_LOCK_TIMEOUT_LABELS[option]}
                    </button>
                  ))}
                </div>

                <button
                  type="submit"
                  disabled={busyAction !== null}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-semibold text-white shadow-xs transition-colors hover:bg-emerald-700 disabled:opacity-60"
                >
                  {busyAction === "enable" ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <KeyRound className="h-3.5 w-3.5" />
                  )}
                  Ativar
                </button>
              </div>
            </form>
          ) : (
            <>
              {pinPanel === "change" && (
                <form
                  onSubmit={handleChangePin}
                  className="mt-3.5 space-y-3 rounded-xl border border-slate-200/80 bg-slate-50/60 p-3.5 dark:border-slate-800 dark:bg-slate-800/40"
                >
                  <div className="grid gap-2.5 sm:grid-cols-3">
                    <div>
                      <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                        PIN atual
                      </label>
                      <input
                        type="password"
                        inputMode="numeric"
                        maxLength={6}
                        value={currentPin}
                        onChange={(e) =>
                          setCurrentPin(sanitizePinInput(e.target.value))
                        }
                        placeholder="••••••"
                        className="w-full rounded-xl border border-slate-200 bg-white px-3 py-1.5 font-mono text-sm tracking-[0.3em] text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                        Novo PIN
                      </label>
                      <input
                        type="password"
                        inputMode="numeric"
                        maxLength={6}
                        value={newPin}
                        onChange={(e) =>
                          setNewPin(sanitizePinInput(e.target.value))
                        }
                        placeholder="••••••"
                        className="w-full rounded-xl border border-slate-200 bg-white px-3 py-1.5 font-mono text-sm tracking-[0.3em] text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                        Confirmar
                      </label>
                      <input
                        type="password"
                        inputMode="numeric"
                        maxLength={6}
                        value={confirmPin}
                        onChange={(e) =>
                          setConfirmPin(sanitizePinInput(e.target.value))
                        }
                        placeholder="••••••"
                        className="w-full rounded-xl border border-slate-200 bg-white px-3 py-1.5 font-mono text-sm tracking-[0.3em] text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                      />
                    </div>
                  </div>
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setPinPanel("none")}
                      className="rounded-xl px-3 py-1.5 text-xs font-medium text-slate-500 hover:text-slate-800 dark:text-slate-400"
                    >
                      Cancelar
                    </button>
                    <button
                      type="submit"
                      disabled={busyAction !== null}
                      className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
                    >
                      {busyAction === "change" && (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      )}
                      Salvar
                    </button>
                  </div>
                </form>
              )}

              {pinPanel === "disable" && (
                <form
                  onSubmit={handleDisablePin}
                  className="mt-3.5 flex flex-wrap items-center gap-2 rounded-xl border border-rose-200/80 bg-rose-50/50 p-3 dark:border-rose-900/50 dark:bg-rose-950/30"
                >
                  <input
                    type="password"
                    inputMode="numeric"
                    maxLength={6}
                    value={currentPin}
                    onChange={(e) =>
                      setCurrentPin(sanitizePinInput(e.target.value))
                    }
                    placeholder="PIN atual"
                    className="w-36 rounded-xl border border-rose-200 bg-white px-3 py-1.5 font-mono text-sm tracking-[0.3em] text-slate-900 dark:border-rose-900/60 dark:bg-slate-900 dark:text-slate-100"
                  />
                  <button
                    type="submit"
                    disabled={busyAction !== null}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-rose-700 disabled:opacity-60"
                  >
                    {busyAction === "disable" && (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    )}
                    Confirmar
                  </button>
                  <button
                    type="button"
                    onClick={() => setPinPanel("none")}
                    className="rounded-xl px-2.5 py-1.5 text-xs font-medium text-slate-500 hover:text-slate-800 dark:text-slate-400"
                  >
                    Cancelar
                  </button>
                </form>
              )}
            </>
          )}
        </div>

        {enabled && (
          <>
            {/* Row 2: Inactivity Timeout */}
            <div className="flex flex-wrap items-center justify-between gap-3 p-4">
              <div className="flex items-center gap-2.5">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                  <Clock className="h-4 w-4" />
                </div>
                <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  Inatividade
                </span>
              </div>

              <div className="flex flex-wrap gap-1.5">
                {APP_LOCK_TIMEOUT_OPTIONS.map((option) => (
                  <button
                    key={option}
                    type="button"
                    disabled={busyAction !== null}
                    onClick={() => void handleTimeoutChange(option)}
                    className={cn(
                      "rounded-lg border px-2.5 py-1 text-xs font-semibold transition-colors disabled:opacity-60",
                      timeoutMinutes === option
                        ? "border-emerald-600 bg-emerald-50 text-emerald-700 dark:border-emerald-500 dark:bg-emerald-950/60 dark:text-emerald-300"
                        : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800/50 dark:text-slate-300"
                    )}
                  >
                    {APP_LOCK_TIMEOUT_LABELS[option]}
                  </button>
                ))}
              </div>
            </div>

            {/* Row 3: Require PIN Only */}
            <div className="flex items-center justify-between gap-3 p-4">
              <div className="flex items-center gap-2.5">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                  <KeyRound className="h-4 w-4" />
                </div>
                <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  Exigir apenas PIN
                </span>
              </div>

              <button
                type="button"
                role="switch"
                aria-label="Exigir apenas PIN"
                aria-checked={requirePinOnly}
                disabled={busyAction !== null}
                onClick={() => void handleToggleRequirePinOnly()}
                className={cn(
                  "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-60",
                  requirePinOnly
                    ? "bg-emerald-600"
                    : "bg-slate-200 dark:bg-slate-700"
                )}
              >
                <span
                  className={cn(
                    "inline-block h-4 w-4 transform rounded-full bg-white shadow-xs transition-transform",
                    requirePinOnly ? "translate-x-6" : "translate-x-1"
                  )}
                />
              </button>
            </div>

            {/* Row 4: Biometrics / Passkeys */}
            <div className="space-y-3 p-4">
              <div className="flex items-center gap-2.5">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600 dark:bg-emerald-950/60 dark:text-emerald-400">
                  <Fingerprint className="h-4 w-4" />
                </div>
                <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  Biometria / Passkey
                </span>
              </div>

              {supportsWebAuthn ? (
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    maxLength={60}
                    value={deviceName}
                    onChange={(e) => setDeviceName(e.target.value)}
                    placeholder={`Nome (ex: ${suggestedDeviceName})`}
                    className="min-w-0 flex-1 rounded-xl border border-slate-200 bg-slate-50/60 px-3 py-2 text-xs text-slate-900 outline-none focus:border-emerald-500 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-100"
                  />
                  <button
                    type="button"
                    disabled={busyAction !== null}
                    onClick={() => void handleRegisterBiometrics()}
                    className="inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-emerald-600 px-3.5 py-2 text-xs font-semibold text-white shadow-xs transition-colors hover:bg-emerald-700 disabled:opacity-60"
                  >
                    {busyAction === "registerBiometrics" ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Fingerprint className="h-3.5 w-3.5" />
                    )}
                    Cadastrar
                  </button>
                </div>
              ) : (
                <p className="text-xs text-slate-400 dark:text-slate-500">
                  Biometria indisponível neste navegador.
                </p>
              )}

              {credentials.length > 0 && (
                <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200/80 dark:divide-slate-800 dark:border-slate-800">
                  {credentials.map((cred) => (
                    <li
                      key={cred.id}
                      className="flex items-center justify-between gap-2.5 px-3 py-2.5"
                    >
                      <div className="flex min-w-0 items-center gap-2.5">
                        <Smartphone className="h-4 w-4 shrink-0 text-slate-400 dark:text-slate-500" />
                        <div className="min-w-0">
                          <p className="truncate text-xs font-semibold text-slate-900 dark:text-slate-100">
                            {cred.deviceName}
                          </p>
                          <p className="text-[11px] text-slate-400 dark:text-slate-500">
                            {formatDatePtBr(cred.lastUsedAt)}
                          </p>
                        </div>
                      </div>
                      <button
                        type="button"
                        disabled={busyAction !== null}
                        onClick={() => void handleDeleteCredential(cred.id)}
                        title="Remover dispositivo"
                        aria-label={`Remover ${cred.deviceName}`}
                        className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-rose-50 hover:text-rose-600 disabled:opacity-40 dark:hover:bg-rose-950/50 dark:hover:text-rose-400"
                      >
                        {busyAction === `delete:${cred.id}` ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Trash2 className="h-3.5 w-3.5" />
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        )}
      </section>
    </div>
  );
}
