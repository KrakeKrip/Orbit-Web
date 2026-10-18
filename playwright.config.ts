import { defineConfig, devices } from "@playwright/test";
import { e2ePort } from "./tests/e2e/credentials";

const port = e2ePort;
const baseURL = `http://127.0.0.1:${port}`;
const storageDir = "test-results/.auth";

export default defineConfig({
  testDir: "tests/e2e",
  // Tasks-спеки используют общие mutable fixtures (задачи пользователя A/C);
  // последовательное выполнение устраняет кросс-спек интерференцию.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  reporter: "list",
  globalTeardown: "./tests/e2e/global-teardown.ts",
  use: {
    trace: 'retain-on-failure',
    baseURL,
    ...devices["Desktop Chrome"],
  },
  webServer: {
    command: "node scripts/e2e-server.ts",
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      E2E_PORT: String(port),
    },
  },
  projects: [
    {
      name: "auth-setup",
      testMatch: /auth\.setup\.ts/,
      use: { trace: 'retain-on-failure', ...devices["Desktop Chrome"] },
    },
    {
      name: "chromium",
      use: {
        trace: 'retain-on-failure',
        ...devices["Desktop Chrome"],
        storageState: `${storageDir}/user-a.json`,
      },
      dependencies: ["auth-setup"],
    },
  ],
});
