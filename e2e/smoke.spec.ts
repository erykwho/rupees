import { expect, test, type Page } from "@playwright/test";

function trackRuntimeErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (err) => {
    errors.push(`pageerror: ${err.message}`);
  });
  page.on("console", (msg) => {
    if (msg.type() === "error") {
      errors.push(`console.error: ${msg.text()}`);
    }
  });
  return errors;
}

test.describe("Rupees E2E Smoke Suite (Mobile PWA)", () => {
  test("/api/health responds 200 ok with no-store cache headers", async ({
    request,
  }) => {
    const res = await request.get("/api/health");
    expect(res.status()).toBe(200);
    expect(res.headers()["cache-control"]).toContain("no-store");

    const body = (await res.json()) as { status: string; timestamp: string };
    expect(body.status).toBe("ok");
    expect(typeof body.timestamp).toBe("string");
  });

  test("unauthenticated visits to protected pages redirect to /login without runtime errors", async ({
    page,
  }) => {
    const errors = trackRuntimeErrors(page);

    for (const route of [
      "/",
      "/carteira",
      "/lancamentos",
      "/aporte",
      "/objetivos",
      "/evolucao",
      "/eventos",
      "/seguranca",
    ]) {
      await page.goto(route);
      await expect(page).toHaveURL(/\/login$/);
    }

    await expect(page.getByRole("heading", { name: "Rupees" })).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Entrar com Google" })
    ).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("/login renders AccessDenied feedback and theme toggle persists across reload", async ({
    page,
  }) => {
    const errors = trackRuntimeErrors(page);

    await page.goto("/login?error=AccessDenied");
    await expect(
      page.getByText(
        "Acesso negado. Sua conta Google não está na lista de e-mails autorizados."
      )
    ).toBeVisible();

    const initialIsDark = await page
      .locator("html")
      .evaluate((el) => el.classList.contains("dark"));

    await page
      .getByRole("button", {
        name: initialIsDark
          ? "Mudar para tema claro"
          : "Mudar para tema escuro",
      })
      .click();

    await expect
      .poll(() =>
        page.locator("html").evaluate((el) => el.classList.contains("dark"))
      )
      .toBe(!initialIsDark);

    await page.reload();
    const afterReloadIsDark = await page
      .locator("html")
      .evaluate((el) => el.classList.contains("dark"));
    expect(afterReloadIsDark).toBe(!initialIsDark);

    expect(errors).toEqual([]);
  });

  test("protected /api/* routes fail closed with 401 when unauthenticated", async ({
    request,
  }) => {
    for (const endpoint of [
      "/api/portfolio",
      "/api/assets",
      "/api/transactions",
      "/api/goals",
      "/api/sector-goals",
      "/api/evolution",
      "/api/fixed-income",
      "/api/events",
      "/api/security/status",
    ]) {
      const res = await request.get(endpoint);
      expect(res.status(), `expected 401 for ${endpoint}`).toBe(401);
    }
  });

  test("PWA manifest is publicly accessible and valid", async ({ request }) => {
    const res = await request.get("/manifest.webmanifest");
    expect(res.status()).toBe(200);
    const manifest = (await res.json()) as { name?: string; short_name?: string };
    expect(manifest.short_name ?? manifest.name).toContain("Rupees");
  });
});
