import { defineConfig } from "drizzle-kit";

// .env — локальные значения разработки (игнорируется Git).
try {
  process.loadEnvFile(".env");
} catch {
  // .env может отсутствовать: DATABASE_URL берётся из окружения вызывающего.
}

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error(
    "DATABASE_URL is not set. Copy .env.example to .env and fill local values.",
  );
}

export default defineConfig({
  dialect: "postgresql",
  schema: ["./src/server/db/schema.auth.ts", "./src/server/db/schema.ts"],
  out: "./drizzle",
  dbCredentials: {
    url: connectionString,
  },
  strict: true,
  verbose: true,
});
