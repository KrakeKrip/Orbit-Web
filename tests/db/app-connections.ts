import { Client } from "pg";
import { closeDbPool } from "../../src/server/db/core.ts";
import type { DbTarget } from "./db-target.ts";

/**
 * Жизненный цикл подключений приложения к собственной test-базе (R3b).
 *
 * Порядок остановки обязателен: остановка HTTP-сервера → closeDbPool()
 * (закрывает фактический пул, общий с compiled-бандлом Next через
 * globalThis-реестр) → ожидание нуля соединений к СВОЕЙ базе → drop.
 * Принудительное завершение (pg_terminate_backend) — только аварийная
 * зачистка собственной базы: clean:false, что teardown обязан превратить
 * в явный сбой, а не в успешный результат.
 */

async function withAdminClient(
  target: DbTarget,
  fn: (client: Client) => Promise<void>,
): Promise<void> {
  const admin = new Client({
    host: target.host,
    port: target.port,
    user: target.user,
    password: target.password,
    database: "postgres",
  });
  await admin.connect();
  try {
    await fn(admin);
  } finally {
    await admin.end();
  }
}

/** R3-регрессия: после остановки приложения соединений к базе быть не должно. */
export async function countTargetConnections(target: DbTarget): Promise<number> {
  let count = -1;
  await withAdminClient(target, async (admin) => {
    const { rows } = await admin.query<{ count: number }>(
      `SELECT count(*)::int AS "count" FROM "pg_stat_activity" WHERE "datname" = $1`,
      [target.database],
    );
    count = rows[0].count;
  });
  return count;
}

/** Ожидает закрытия соединений после closeDbPool; возвращает остаток. */
export async function waitForConnectionsClosed(
  target: DbTarget,
  timeoutMs: number,
): Promise<number> {
  const deadline = Date.now() + timeoutMs;
  let count = await countTargetConnections(target);
  while (count !== 0 && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    count = await countTargetConnections(target);
  }
  return count;
}

/** Завершает только соединения к собственной per-run базе этого запуска. */
export async function terminateTargetConnections(target: DbTarget): Promise<void> {
  await withAdminClient(target, async (admin) => {
    await admin.query(
      `SELECT pg_terminate_backend("pid") FROM "pg_stat_activity" WHERE "datname" = $1 AND "pid" <> "pg_backend_pid"()`,
      [target.database],
    );
  });
}

export type AppPoolCloseOptions = {
  /** Ожидание нуля соединений после closeDbPool (по умолчанию 10000). */
  closeWaitMs?: number;
  /** Ожидание после аварийного обрыва (по умолчанию 5000). */
  terminateWaitMs?: number;
};

export type AppPoolCloseResult = {
  /** false: потребовался принудительный обрыв — это не чистый teardown. */
  clean: boolean;
  remaining: number;
};

/**
 * Закрывает пул приложения и дожидается нуля его соединений к собственной
 * базе. Вызывать ПОСЛЕ остановки HTTP-сервера и ДО drop базы.
 */
export async function closeAppPoolAndConnections(
  target: DbTarget,
  options: AppPoolCloseOptions = {},
): Promise<AppPoolCloseResult> {
  const closeWaitMs = options.closeWaitMs ?? 10000;
  const terminateWaitMs = options.terminateWaitMs ?? 5000;
  await closeDbPool();
  const remaining = await waitForConnectionsClosed(target, closeWaitMs);
  if (remaining === 0) {
    return { clean: true, remaining: 0 };
  }
  // Аварийная зачистка собственной базы: владельцем соединений был наш
  // процесс; clean:false обязывает вызвавший teardown сообщить сбой.
  await terminateTargetConnections(target);
  const after = await waitForConnectionsClosed(target, terminateWaitMs);
  return { clean: false, remaining: after };
}
