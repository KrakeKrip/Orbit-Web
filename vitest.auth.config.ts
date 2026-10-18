import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Auth integration suite (npm run test:auth): production Next request
// handler поднимается в процессе тест-раннера, поэтому модули с маркером
// `server-only` резолвятся через пустую заглушку ТОЛЬКО здесь.
// Сама граница проверяется реальной сборкой Next (npm run build / E2E):
// клиентский компонент, импортировавший server-only модуль, ломает build.
const serverOnlyStub = fileURLToPath(
  new URL("./tests/auth/server-only-stub.mjs", import.meta.url),
);

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "server-only": serverOnlyStub,
    },
  },
  test: {
    environment: "node",
    globalSetup: ["./tests/auth/global-setup.ts"],
    include: ["tests/auth/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**"],
    fileParallelism: false,
    testTimeout: 30000,
    hookTimeout: 180000,
    teardownTimeout: 60000,
  },
});
