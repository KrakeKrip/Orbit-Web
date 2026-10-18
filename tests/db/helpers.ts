import { Client } from "pg";
import { loadDotEnv, resolveTestDatabaseTarget } from "./db-target.ts";

/**
 * Помощник DB-тестов: короткоживущее подключение к базе, созданной раннером
 * этого запуска. Имя базы приходит через ORBIT_TEST_DB_NAME (global-setup),
 * сервер и креденшелы — только из проверенных частей TEST_DATABASE_URL
 * (сырой URL в pg не передаётся). Клиенты закрываются в finally.
 */

// Экспортируется для auth suite (tests/auth): тот же runner target,
// созданный global-setup соответствующего запуска.
export function runnerTarget() {
  loadDotEnv();
  const target = resolveTestDatabaseTarget();
  const name = process.env.ORBIT_TEST_DB_NAME ?? "";
  if (!/^orbit_test_[0-9]+_[a-z0-9]+$/.test(name)) {
    throw new Error(
      "ORBIT_TEST_DB_NAME is not set by the runner: run the DB suite via npm run test:db.",
    );
  }
  return { ...target, database: name };
}

export function runnerDatabaseName(): string {
  return runnerTarget().database;
}

export function adminConfig() {
  const target = runnerTarget();
  return { ...target, database: "postgres" };
}

export async function withDbClient<T>(
  fn: (client: Client) => Promise<T>,
): Promise<T> {
  const { host, port, user, password, database } = runnerTarget();
  const client = new Client({ host, port, user, password, database });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

export async function createUsers(client: Client): Promise<{
  userA: string;
  userB: string;
}> {
  const userA = `user-a-${crypto.randomUUID()}`;
  const userB = `user-b-${crypto.randomUUID()}`;
  await client.query(
    `INSERT INTO "user" ("id", "name", "email") VALUES ($1, 'User A', $2), ($3, 'User B', $4)`,
    [userA, `${userA}@example.test`, userB, `${userB}@example.test`],
  );
  return { userA, userB };
}

/** Ожидает ошибку PostgreSQL с конкретным SQLSTATE. */
export async function expectPgError(
  action: () => Promise<unknown>,
  expectedCode: string,
): Promise<void> {
  let failed = false;
  try {
    await action();
  } catch (error) {
    failed = true;
    const code = (error as { code?: string }).code;
    if (code !== expectedCode) {
      throw new Error(
        `Expected SQLSTATE ${expectedCode}, got ${code ?? "no code"}: ${String(error)}`,
      );
    }
  }
  if (!failed) {
    throw new Error(`Expected PostgreSQL error ${expectedCode}, but operation succeeded.`);
  }
}
