import { defineConfig } from "vitest/config";

// Отдельный DB suite (npm run test:db): работает только с явно выбранной
// изолированной локальной test-базой из TEST_DATABASE_URL и не смешивается
// с быстрой UI suite (npm test).
export default defineConfig({
  test: {
    environment: "node",
    globalSetup: ["./tests/db/global-setup.ts"],
    include: ["tests/db/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**"],
    // Одна общая test-база: тесты выполняются последовательно.
    fileParallelism: false,
  },
});
