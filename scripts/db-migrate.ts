import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

// Применяет checked-in миграции из drizzle/ к базе из DATABASE_URL
// (локальная dev-база). Пул закрывается: процесс не остаётся висеть.

try {
  process.loadEnvFile(".env");
} catch {
  // .env может отсутствовать: DATABASE_URL берётся из окружения.
}

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.error(
    "DATABASE_URL is not set. Copy .env.example to .env and fill local values.",
  );
  process.exit(1);
}

const pool = new Pool({ connectionString, max: 1 });

try {
  const db = drizzle(pool);
  await migrate(db, { migrationsFolder: "./drizzle" });
  console.log("Migrations applied.");
} finally {
  await pool.end();
}
