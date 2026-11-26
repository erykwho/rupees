import { revalidateTag, unstable_cache } from "next/cache";

export const DEFAULT_USER_CACHE_TTL_SECONDS = 60;

export function userPortfolioTag(userId: string): string {
  return `portfolio:${userId}`;
}

export function userEvolutionTag(userId: string): string {
  return `evolution:${userId}`;
}

export function userFixedIncomeTag(userId: string): string {
  return `fixed-income:${userId}`;
}

export function userSavingsTag(userId: string): string {
  return `savings:${userId}`;
}

export function userMonthlyBudgetTag(userId: string): string {
  return `monthly-budget:${userId}`;
}

export function getAllUserFinancialTags(userId: string): string[] {
  return [
    userPortfolioTag(userId),
    userEvolutionTag(userId),
    userFixedIncomeTag(userId),
  ];
}

function expireTags(tags: string[]): void {
  if (process.env.NODE_ENV === "test") {
    return;
  }

  for (const tag of tags) {
    try {
      revalidateTag(tag, { expire: 0 });
    } catch {
      // Ignore outside Next.js request/cache lifecycle (e.g. scripts or tests)
    }
  }
}

/**
 * Immediately expires all per-user long-term financial server caches so subsequent reads
 * always reflect the user's own mutations (read-your-own-writes).
 * Safely no-ops outside a Next.js server runtime (e.g. unit tests / CLI scripts).
 */
export function invalidateUserFinancialCaches(userId: string): void {
  expireTags(getAllUserFinancialTags(userId));
}

/**
 * Expires per-user Savings (Caixinhas) and Monthly Budget caches (since monthly allocations
 * reference active savings goals and balances).
 */
export function invalidateUserSavingsCaches(userId: string): void {
  expireTags([userSavingsTag(userId), userMonthlyBudgetTag(userId)]);
}

/**
 * Expires per-user Monthly Budget caches so home/month reads reflect mutations immediately.
 */
export function invalidateUserMonthlyBudgetCaches(userId: string): void {
  expireTags([userMonthlyBudgetTag(userId)]);
}

/**
 * Runs a per-user server loader through Next.js Data Cache scoped strictly by userId.
 * Falls back transparently to direct execution in test/CLI environments.
 */
export async function runCachedForUser<T>(params: {
  keyPrefix: string;
  userId: string;
  tags: string[];
  revalidateSeconds?: number;
  loader: () => Promise<T>;
}): Promise<T> {
  const {
    keyPrefix,
    userId,
    tags,
    revalidateSeconds = DEFAULT_USER_CACHE_TTL_SECONDS,
    loader,
  } = params;

  if (process.env.NODE_ENV === "test") {
    return loader();
  }

  try {
    const cachedFn = unstable_cache(
      async () => loader(),
      [keyPrefix, userId],
      {
        tags,
        revalidate: revalidateSeconds,
      }
    );
    return await cachedFn();
  } catch {
    // Fallback when incrementalCache is unavailable (e.g. standalone scripts)
    return loader();
  }
}
