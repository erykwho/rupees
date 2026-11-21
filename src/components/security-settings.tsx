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
  if (!iso) return "Ainda não usado";
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

  // Formulários de PIN
  const [newPin, setNewPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [currentPin, setCurrentPin] = useState("");
  const [pinPanel, setPinPanel] = useState<"none" | "change" | "disable">("none");

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
        text: "Bloqueio ativado! Agora você pode cadastrar a biometria deste dispositivo abaixo.",
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
        text: "PIN alterado com sucesso.",
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
        text: "Informe seu PIN atual de 6 dígitos para desativar.",
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
        text: "Bloqueio do aplicativo desativado.",
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
          text: data.error || "Não foi possível salvar o tempo de inatividade.",
        });
        return;
      }
      setFeedback({
        type: "success",
        text: `Tempo de inatividade atualizado para ${APP_LOCK_TIMEOUT_LABELS[nextTimeout]}.`,
      });
    } catch {
      setFeedback({
        type: "error",
        text: "Erro de conexão ao salvar o tempo de inatividade.",
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
          text: data.error || "Não foi possível atualizar a preferência.",
        });
        return;
      }
      setRequirePinOnly(nextValue);
      setFeedback({
        type: "success",
        text: nextValue
          ? "Modo 'Exigir PIN próprio sempre' ativado."
          : "Desbloqueio por biometria reativado.",
      });
    } catch {
      setFeedback({
        type: "error",
        text: "Erro de conexão ao atualizar a preferência.",
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
          text:
            verifyData.error || "Não foi possível salvar a biometria deste dispositivo.",
        });
        return;
      }

      setCredentials((prev) => [
        verifyData.credential,
        ...prev.filter((item) => item.id !== verifyData.credential.id),
      ]);
      setFeedback({
        type: "success",
        text: `Biometria cadastrada para "${verifyData.credential.deviceName}".`,
      });
    } catch (err) {
      const text =
        err instanceof Error && err.name === "NotAllowedError"
          ? "Cadastro biométrico cancelado no dispositivo."
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
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
          Segurança
        </h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Proteja sua carteira com biometria e PIN próprio, sem atrapalhar o uso
          diário.
        </p>
      </div>

      {feedback && (
        <div
          className={cn(
            "flex items-center gap-2.5 rounded-xl border px-4 py-3 text-sm font-medium",
            feedback.type === "success"
              ? "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300"
              : "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-300"
          )}
        >
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          <span>{feedback.text}</span>
        </div>
      )}

      {/* Card 1: Status & PIN */}
      <section className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-2xs dark:border-slate-800 dark:bg-slate-900 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div
              className={cn(
                "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl",
                enabled
                  ? "bg-emerald-50 text-emerald-600 dark:bg-emerald-950/60 dark:text-emerald-400"
                  : "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400"
              )}
            >
              {enabled ? (
                <ShieldCheck className="h-5 w-5" />
              ) : (
                <ShieldOff className="h-5 w-5" />
              )}
            </div>
            <div>
              <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                Bloqueio do Aplicativo (PIN de 6 dígitos)
              </h2>
              <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
                {enabled
                  ? "Ativo. O servidor exige desbloqueio após o período de inatividade."
                  : "Desativado. Crie um PIN de 6 dígitos para proteger o acesso no celular."}
              </p>
            </div>
          </div>

          <span
            className={cn(
              "inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold",
              enabled
                ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300"
                : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400"
            )}
          >
            {enabled ? "Ativo" : "Desativado"}
          </span>
        </div>

        {!enabled ? (
          <form onSubmit={handleEnablePin} className="mt-5 space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-1.5 block text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Novo PIN (6 dígitos)
                </label>
                <input
                  type="password"
                  inputMode="numeric"
                  autoComplete="new-password"
                  maxLength={6}
                  value={newPin}
                  onChange={(e) => setNewPin(sanitizePinInput(e.target.value))}
                  placeholder="••••••"
                  className="w-full rounded-xl border border-slate-200 bg-slate-50/50 px-3.5 py-2.5 font-mono text-base tracking-[0.35em] text-slate-900 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-100"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-semibold text-slate-700 dark:text-slate-300">
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
                  className="w-full rounded-xl border border-slate-200 bg-slate-50/50 px-3.5 py-2.5 font-mono text-base tracking-[0.35em] text-slate-900 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-100"
                />
              </div>
            </div>

            <div>
              <label className="mb-2 block text-xs font-semibold text-slate-700 dark:text-slate-300">
                Tempo de inatividade padrão
              </label>
              <div className="flex flex-wrap gap-2">
                {APP_LOCK_TIMEOUT_OPTIONS.map((option) => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => setTimeoutMinutes(option)}
                    className={cn(
                      "rounded-xl border px-3 py-1.5 text-xs font-semibold transition-colors",
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

            <button
              type="submit"
              disabled={busyAction !== null}
              className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white shadow-xs transition-colors hover:bg-emerald-700 disabled:opacity-60"
            >
              {busyAction === "enable" ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <KeyRound className="h-4 w-4" />
              )}
              Ativar bloqueio do aplicativo
            </button>
          </form>
        ) : (
          <div className="mt-5 space-y-4">
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => {
                  setFeedback(null);
                  setCurrentPin("");
                  setNewPin("");
                  setConfirmPin("");
                  setPinPanel((prev) => (prev === "change" ? "none" : "change"));
                }}
                className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
              >
                <KeyRound className="h-3.5 w-3.5" />
                Alterar PIN
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
                className="inline-flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50/70 px-3.5 py-2 text-xs font-semibold text-rose-700 transition-colors hover:bg-rose-100 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-300"
              >
                <ShieldOff className="h-3.5 w-3.5" />
                Desativar bloqueio
              </button>
            </div>

            {pinPanel === "change" && (
              <form
                onSubmit={handleChangePin}
                className="space-y-3 rounded-xl border border-slate-200/80 bg-slate-50/60 p-4 dark:border-slate-800 dark:bg-slate-800/40"
              >
                <div className="grid gap-3 sm:grid-cols-3">
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
                      className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 font-mono text-sm tracking-[0.3em] text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
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
                      className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 font-mono text-sm tracking-[0.3em] text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                      Confirmar novo PIN
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
                      className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 font-mono text-sm tracking-[0.3em] text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                    />
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    type="submit"
                    disabled={busyAction !== null}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
                  >
                    {busyAction === "change" && (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    )}
                    Salvar novo PIN
                  </button>
                  <button
                    type="button"
                    onClick={() => setPinPanel("none")}
                    className="rounded-xl px-3 py-2 text-xs font-medium text-slate-500 hover:text-slate-800 dark:text-slate-400"
                  >
                    Cancelar
                  </button>
                </div>
              </form>
            )}

            {pinPanel === "disable" && (
              <form
                onSubmit={handleDisablePin}
                className="space-y-3 rounded-xl border border-rose-200/80 bg-rose-50/50 p-4 dark:border-rose-900/50 dark:bg-rose-950/30"
              >
                <p className="text-xs text-rose-700 dark:text-rose-300">
                  Confirme seu PIN atual para remover a camada extra de bloqueio.
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    type="password"
                    inputMode="numeric"
                    maxLength={6}
                    value={currentPin}
                    onChange={(e) =>
                      setCurrentPin(sanitizePinInput(e.target.value))
                    }
                    placeholder="PIN atual"
                    className="w-40 rounded-xl border border-rose-200 bg-white px-3 py-2 font-mono text-sm tracking-[0.3em] text-slate-900 dark:border-rose-900/60 dark:bg-slate-900 dark:text-slate-100"
                  />
                  <button
                    type="submit"
                    disabled={busyAction !== null}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-rose-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-rose-700 disabled:opacity-60"
                  >
                    {busyAction === "disable" && (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    )}
                    Confirmar desativação
                  </button>
                  <button
                    type="button"
                    onClick={() => setPinPanel("none")}
                    className="rounded-xl px-3 py-2 text-xs font-medium text-slate-500 hover:text-slate-800 dark:text-slate-400"
                  >
                    Cancelar
                  </button>
                </div>
              </form>
            )}
          </div>
        )}
      </section>

      {enabled && (
        <>
          {/* Card 2: Tempo de inatividade */}
          <section className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-2xs dark:border-slate-800 dark:bg-slate-900 sm:p-6">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                <Clock className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                  Tempo de inatividade
                </h2>
                <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
                  Enquanto você usa o aplicativo, o relógio é renovado
                  automaticamente. Ficar ausente ou fechar e reabrir o app
                  dentro desse prazo não pede desbloqueio novamente.
                </p>
              </div>
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              {APP_LOCK_TIMEOUT_OPTIONS.map((option) => (
                <button
                  key={option}
                  type="button"
                  disabled={busyAction !== null}
                  onClick={() => void handleTimeoutChange(option)}
                  className={cn(
                    "rounded-xl border px-3.5 py-2 text-xs font-semibold transition-colors disabled:opacity-60",
                    timeoutMinutes === option
                      ? "border-emerald-600 bg-emerald-50 text-emerald-700 dark:border-emerald-500 dark:bg-emerald-950/60 dark:text-emerald-300"
                      : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800/50 dark:text-slate-300 dark:hover:bg-slate-800"
                  )}
                >
                  {APP_LOCK_TIMEOUT_LABELS[option]}
                </button>
              ))}
            </div>
          </section>

          {/* Card 3: Biometria / Passkey */}
          <section className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-2xs dark:border-slate-800 dark:bg-slate-900 sm:p-6">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600 dark:bg-emerald-950/60 dark:text-emerald-400">
                <Fingerprint className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                  Biometria / Passkey do dispositivo
                </h2>
                <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
                  Desbloqueie em 1 segundo com Face ID, Touch ID, impressão
                  digital ou Windows Hello.
                </p>
              </div>
            </div>

            {supportsWebAuthn ? (
              <div className="mt-4 flex flex-col gap-2.5 sm:flex-row sm:items-center">
                <input
                  type="text"
                  maxLength={60}
                  value={deviceName}
                  onChange={(e) => setDeviceName(e.target.value)}
                  placeholder="Nome do dispositivo (ex: iPhone)"
                  className="flex-1 rounded-xl border border-slate-200 bg-slate-50/60 px-3.5 py-2.5 text-sm text-slate-900 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-100"
                />
                <button
                  type="button"
                  disabled={busyAction !== null}
                  onClick={() => void handleRegisterBiometrics()}
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white shadow-xs transition-colors hover:bg-emerald-700 disabled:opacity-60"
                >
                  {busyAction === "registerBiometrics" ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Fingerprint className="h-4 w-4" />
                  )}
                  Cadastrar neste dispositivo
                </button>
              </div>
            ) : (
              <p className="mt-4 rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-xs text-slate-600 dark:border-slate-800 dark:bg-slate-800/60 dark:text-slate-400">
                Este navegador/dispositivo não oferece suporte a WebAuthn. Você
                continuará usando seu PIN de 6 dígitos normalmente.
              </p>
            )}

            {/* Lista de dispositivos */}
            {credentials.length > 0 && (
              <div className="mt-5 space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                  Dispositivos cadastrados
                </p>
                <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200/80 dark:divide-slate-800 dark:border-slate-800">
                  {credentials.map((cred) => (
                    <li
                      key={cred.id}
                      className="flex items-center justify-between gap-3 px-3.5 py-3"
                    >
                      <div className="flex min-w-0 items-center gap-3">
                        <Smartphone className="h-4 w-4 shrink-0 text-slate-400 dark:text-slate-500" />
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-slate-900 dark:text-slate-100">
                            {cred.deviceName}
                          </p>
                          <p className="text-xs text-slate-500 dark:text-slate-400">
                            Último uso: {formatDatePtBr(cred.lastUsedAt)}
                          </p>
                        </div>
                      </div>
                      <button
                        type="button"
                        disabled={busyAction !== null}
                        onClick={() => void handleDeleteCredential(cred.id)}
                        title="Remover dispositivo"
                        aria-label={`Remover ${cred.deviceName}`}
                        className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-rose-50 hover:text-rose-600 disabled:opacity-40 dark:hover:bg-rose-950/50 dark:hover:text-rose-400"
                      >
                        {busyAction === `delete:${cred.id}` ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Trash2 className="h-4 w-4" />
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Toggle: Exigir PIN próprio sempre */}
            <div className="mt-5 flex items-center justify-between gap-4 border-t border-slate-100 pt-4 dark:border-slate-800">
              <div>
                <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
                  Exigir PIN próprio sempre
                </p>
                <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                  Desativa o desbloqueio biométrico e exige sempre seu PIN de 6
                  dígitos — protege mesmo contra quem saiba a senha do celular.
                </p>
              </div>
              <button
                type="button"
                role="switch"
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
          </section>
        </>
      )}
    </div>
  );
}
