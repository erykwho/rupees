import { describe, expect, it } from "vitest";
import {
  computeLockoutDurationSeconds,
  DEFAULT_APP_LOCK_TIMEOUT_MINUTES,
  getRemainingLockoutSeconds,
  isUnlockTokenValid,
  isValidTimeoutMinutes,
  normalizeTimeoutMinutes,
  sanitizeUnlockRedirectPath,
  shouldRefreshUnlockToken,
  validatePinFormat,
} from "./security";

describe("security domain", () => {
  describe("validatePinFormat", () => {
    it("aceita PIN numérico com exatamente 6 dígitos", () => {
      expect(validatePinFormat("012345")).toEqual({ valid: true });
      expect(validatePinFormat("987654")).toEqual({ valid: true });
    });

    it("rejeita PIN com menos ou mais de 6 dígitos ou caracteres não numéricos", () => {
      expect(validatePinFormat("12345").valid).toBe(false);
      expect(validatePinFormat("1234567").valid).toBe(false);
      expect(validatePinFormat("12345a").valid).toBe(false);
      expect(validatePinFormat("12 345").valid).toBe(false);
      expect(validatePinFormat("").valid).toBe(false);
    });
  });

  describe("timeout normalization", () => {
    it("reconhece timeouts permitidos e normaliza inválidos para 30 minutos", () => {
      expect(isValidTimeoutMinutes(5)).toBe(true);
      expect(isValidTimeoutMinutes(30)).toBe(true);
      expect(isValidTimeoutMinutes(240)).toBe(true);
      expect(isValidTimeoutMinutes(45)).toBe(false);

      expect(normalizeTimeoutMinutes(15)).toBe(15);
      expect(normalizeTimeoutMinutes(999)).toBe(DEFAULT_APP_LOCK_TIMEOUT_MINUTES);
      expect(normalizeTimeoutMinutes(null)).toBe(DEFAULT_APP_LOCK_TIMEOUT_MINUTES);
    });
  });

  describe("progressive lockout", () => {
    it("aplica backoff progressivo após 5 tentativas falhas", () => {
      expect(computeLockoutDurationSeconds(0)).toBe(0);
      expect(computeLockoutDurationSeconds(4)).toBe(0);
      expect(computeLockoutDurationSeconds(5)).toBe(60);
      expect(computeLockoutDurationSeconds(7)).toBe(60);
      expect(computeLockoutDurationSeconds(8)).toBe(300);
      expect(computeLockoutDurationSeconds(9)).toBe(300);
      expect(computeLockoutDurationSeconds(10)).toBe(900);
      expect(computeLockoutDurationSeconds(20)).toBe(900);
    });

    it("calcula segundos restantes de bloqueio corretamente", () => {
      const now = 1_700_000_000_000;
      expect(getRemainingLockoutSeconds(null, now)).toBe(0);
      expect(getRemainingLockoutSeconds(new Date(now - 1000), now)).toBe(0);
      expect(getRemainingLockoutSeconds(new Date(now + 1500), now)).toBe(2);
      expect(getRemainingLockoutSeconds(new Date(now + 60_000), now)).toBe(60);
    });
  });

  describe("unlock token validity and sliding refresh", () => {
    it("valida uid e expiração", () => {
      const payload = { uid: "user_1", iat: 1000, exp: 2800, ttl: 30 };
      expect(isUnlockTokenValid(payload, "user_1", 1500)).toBe(true);
      expect(isUnlockTokenValid(payload, "user_2", 1500)).toBe(false);
      expect(isUnlockTokenValid(payload, "user_1", 2800)).toBe(false);
      expect(isUnlockTokenValid(payload, "user_1", 2801)).toBe(false);
      expect(isUnlockTokenValid(null, "user_1", 1500)).toBe(false);
    });

    it("sinaliza renovação deslizante somente após o limiar de 60 segundos", () => {
      const payload = { uid: "user_1", iat: 1000, exp: 2800, ttl: 30 };
      expect(shouldRefreshUnlockToken(payload, 1000)).toBe(false);
      expect(shouldRefreshUnlockToken(payload, 1059)).toBe(false);
      expect(shouldRefreshUnlockToken(payload, 1060)).toBe(true);
      expect(shouldRefreshUnlockToken(payload, 1500)).toBe(true);
    });
  });

  describe("sanitizeUnlockRedirectPath", () => {
    it("permite apenas caminhos internos seguros", () => {
      expect(sanitizeUnlockRedirectPath("/carteira")).toBe("/carteira");
      expect(sanitizeUnlockRedirectPath("/aporte?valor=1000")).toBe(
        "/aporte?valor=1000"
      );
      expect(sanitizeUnlockRedirectPath("https://evil.com")).toBe("/");
      expect(sanitizeUnlockRedirectPath("//evil.com")).toBe("/");
      expect(sanitizeUnlockRedirectPath("/unlock")).toBe("/");
      expect(sanitizeUnlockRedirectPath("/login")).toBe("/");
      expect(sanitizeUnlockRedirectPath(null)).toBe("/");
    });
  });
});
