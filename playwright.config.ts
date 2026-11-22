import { defineConfig, devices } from "@playwright/test";

const PORT = 3101;
const BASE_URL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium-mobile",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 390, height: 844 },
        hasTouch: true,
        isMobile: true,
      },
    },
  ],
  webServer: {
    command: `pnpm exec next start -H 127.0.0.1 -p ${PORT}`,
    url: `${BASE_URL}/api/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    env: {
      AUTH_TRUST_HOST: "true",
      AUTH_SECRET:
        process.env.AUTH_SECRET ?? "rupees-e2e-placeholder-secret-32-chars",
      AUTH_GOOGLE_ID: process.env.AUTH_GOOGLE_ID ?? "e2e-google-client-id",
      AUTH_GOOGLE_SECRET:
        process.env.AUTH_GOOGLE_SECRET ?? "e2e-google-client-secret",
    },
  },
});
