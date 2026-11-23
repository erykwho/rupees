import { describe, expect, it, vi } from "vitest";
import {
  getAllUserFinancialTags,
  invalidateUserFinancialCaches,
  runCachedForUser,
  userEvolutionTag,
  userFixedIncomeTag,
  userPortfolioTag,
} from "@/lib/server-cache";

describe("server-cache (multi-tenant tag isolation & test fallback)", () => {
  it("generates strictly user-scoped cache tags with zero cross-tenant overlap", () => {
    const tagsA = getAllUserFinancialTags("user-a");
    const tagsB = getAllUserFinancialTags("user-b");

    expect(tagsA).toEqual([
      userPortfolioTag("user-a"),
      userEvolutionTag("user-a"),
      userFixedIncomeTag("user-a"),
    ]);
    expect(tagsA.every((t) => t.endsWith(":user-a"))).toBe(true);
    expect(tagsA.some((t) => tagsB.includes(t))).toBe(false);
  });

  it("executes loader directly in test environment without throwing", async () => {
    const loader = vi.fn().mockResolvedValue({ total: 1234 });

    const res = await runCachedForUser({
      keyPrefix: "user-portfolio",
      userId: "user-a",
      tags: [userPortfolioTag("user-a")],
      loader,
    });

    expect(loader).toHaveBeenCalledTimes(1);
    expect(res).toEqual({ total: 1234 });
  });

  it("does not throw when invalidating caches outside Next.js server runtime", () => {
    expect(() => invalidateUserFinancialCaches("user-a")).not.toThrow();
  });
});
