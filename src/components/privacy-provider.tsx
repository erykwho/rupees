"use client";

import {
  createContext,
  useCallback,
  useContext,
  useSyncExternalStore,
} from "react";
import { PRIVACY_STORAGE_KEY } from "@/lib/privacy";

interface PrivacyContextValue {
  isPrivate: boolean;
  setIsPrivate: (next: boolean) => void;
  togglePrivacy: () => void;
}

const PrivacyContext = createContext<PrivacyContextValue | null>(null);

const listeners = new Set<() => void>();

function emitChange() {
  listeners.forEach((listener) => listener());
}

function getClientPrivacy(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(PRIVACY_STORAGE_KEY) === "true";
}

function getServerPrivacy(): boolean {
  return false;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const handleStorage = (event: StorageEvent) => {
    if (event.key === PRIVACY_STORAGE_KEY) {
      emitChange();
    }
  };
  window.addEventListener("storage", handleStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", handleStorage);
  };
}

export function PrivacyProvider({ children }: { children: React.ReactNode }) {
  const isPrivate = useSyncExternalStore(
    subscribe,
    getClientPrivacy,
    getServerPrivacy
  );

  const setIsPrivate = useCallback((next: boolean) => {
    window.localStorage.setItem(PRIVACY_STORAGE_KEY, String(next));
    emitChange();
  }, []);

  const togglePrivacy = useCallback(() => {
    const next = !getClientPrivacy();
    window.localStorage.setItem(PRIVACY_STORAGE_KEY, String(next));
    emitChange();
  }, []);

  return (
    <PrivacyContext.Provider value={{ isPrivate, setIsPrivate, togglePrivacy }}>
      {children}
    </PrivacyContext.Provider>
  );
}

export function usePrivacy() {
  const ctx = useContext(PrivacyContext);
  if (!ctx) {
    throw new Error("usePrivacy deve ser usado dentro de PrivacyProvider");
  }
  return ctx;
}
