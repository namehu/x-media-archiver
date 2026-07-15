import { defineConfig, devices } from "@playwright/test";

const webServerPort = Number(process.env.E2E_WEB_PORT ?? 5173);
const webServerUrl = `http://127.0.0.1:${webServerPort}`;

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  expect: {
    timeout: 10_000,
  },
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: webServerUrl,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: "retain-on-failure",
  },
  webServer: {
    command: `npm run dev -- --host 127.0.0.1 --port ${webServerPort}`,
    url: webServerUrl,
    reuseExistingServer: !process.env.CI && !process.env.E2E_WEB_PORT,
    timeout: 120_000,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
