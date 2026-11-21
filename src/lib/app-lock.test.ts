import { describe, expect, it } from "vitest";
import { hashPin, verifyPin } from "./app-lock";
import { signUnlockToken, verifyUnlockToken } from "./app-lock-token";

describe("app-lock crypto helpers", () => {
  describe("hashPin and verifyPin", () => {
    it("gera hashes distintos com salt e valida PIN corretamente", () => {
      const hashA = hashPin("482910");
      const hashB = hashPin("482910");

      expect(hashA).not.toBe(hashB);
      expect(hashA.startsWith("scrypt$")).toBe(true);
      expect(verifyPin("482910", hashA)).toBe(true);
      expect(verifyPin("482910", hashB)).toBe(true);
      expect(verifyPin("482911", hashA)).toBe(false);
      expect(verifyPin("482910", null)).toBe(false);
      expect(verifyPin("482910", "invalid-format")).toBe(false);
    });
  });

  describe("signUnlockToken and verifyUnlockToken", () => {
    const secret = "test-secret-for-rupees-app-lock";

    it("assina e verifica payload válido", async () => {
      const { token, payload } = await signUnlockToken("user_abc", 30, {
        nowSec: 1_700_000_000,
        secret,
      });

      expect(payload).toEqual({
        uid: "user_abc",
        iat: 1_700_000_000,
        exp: 1_700_001_800,
        ttl: 30,
      });

      const verified = await verifyUnlockToken(token, { secret });
      expect(verified).toEqual(payload);
    });

    it("rejeita token adulterado ou assinado com outro segredo", async () => {
      const { token } = await signUnlockToken("user_abc", 30, {
        nowSec: 1_700_000_000,
        secret,
      });

      const [payloadPart, sigPart] = token.split(".");
      const tampered = `${payloadPart}x.${sigPart}`;

      expect(await verifyUnlockToken(tampered, { secret })).toBeNull();
      expect(await verifyUnlockToken(token, { secret: "other-secret" })).toBeNull();
      expect(await verifyUnlockToken("malformed", { secret })).toBeNull();
    });
  });
});
