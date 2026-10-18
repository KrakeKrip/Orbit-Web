import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.{ts,tsx}"],
    // DB suite — npm run test:db, auth suite — npm run test:auth.
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "tests/db/**",
      "tests/auth/**",
    ],
  },
});
