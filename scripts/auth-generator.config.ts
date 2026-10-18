// Минимальная конфигурация генерации Better Auth core schema (TASK-003).
// Используется только `@better-auth/cli generate`; это не сервер auth:
// публичных handler'ов, сессий и flows здесь нет (TASK-004).
//
// Генерация не подключается к БД и не требует реального URL/секрета:
// Pool создаётся лениво и ни разу не подключается в процессе generate.
// Если DATABASE_URL не задан, используется одноразовый placeholder.
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ??
    "postgresql://orbit:placeholder@127.0.0.1:55432/orbit_dev",
  max: 1,
});

export const auth = betterAuth({
  database: drizzleAdapter(drizzle(pool), { provider: "pg" }),
  emailAndPassword: {
    enabled: true,
  },
});
