import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Client, Pool } from "pg";
import {
  adminTarget,
  isRunnerCreatedDbName,
  resolveTestDatabaseTarget,
  type DbTarget,
} from "./db-target.ts";

/**
 * Подготовка изолированной test-базы (исправление R1).
 *
 * - Ничего не удаляется ДО создания: база каждого запуска получает новое
 *   уникальное имя и создаётся CREATE DATABASE без IF NOT EXISTS. Ранее
 *   существовавшие базы (включая orbit_test и любые *_test) не затрагиваются.
 * - teardown удаляет ТОЛЬКО базу, успешно созданную этим запуском.
 * - Все подключения строятся из проверенных частей target (R2), сырой URL
 *   в pg не передаётся; administrative подключение — на тот же проверенный
 *   сервер, в maintenance-базу postgres.
 */

function pgConfig(target: DbTarget) {
  return {
    host: target.host,
    port: target.port,
    user: target.user,
    password: target.password,
    database: target.database,
  };
}

async function withAdminClient(
  target: DbTarget,
  fn: (client: Client) => Promise<void>,
): Promise<void> {
  const client = new Client(pgConfig(adminTarget(target)));
  await client.connect();
  try {
    await fn(client);
  } finally {
    await client.end();
  }
}

export type PreparedTestDatabase = {
  /** Проверенные части подключения к созданной базе. */
  target: DbTarget;
  teardown: () => Promise<void>;
};

export async function prepareTestDatabase(
  env: NodeJS.ProcessEnv = process.env,
): Promise<PreparedTestDatabase> {
  const target = resolveTestDatabaseTarget(env);

  await withAdminClient(target, async (admin) => {
    await admin.query(`CREATE DATABASE "${target.database}"`);
  });

  let created = true;
  const pool = new Pool(pgConfig(target));
  pool.on("error", () => {
    // Фоновые ошибки простаивающих клиентов не должны ронять процесс.
  });

  try {
    await migrate(drizzle(pool), { migrationsFolder: "./drizzle" });
  } catch (error) {
    created = false;
    await pool.end().catch(() => {});
    // База создана этим запуском, но не пригодилась: удаляем только её.
    await withAdminClient(target, async (admin) => {
      await admin.query(`DROP DATABASE "${target.database}"`);
    });
    throw error;
  }

  await pool.end();

  return {
    target,
    teardown: async () => {
      if (!created) {
        return;
      }
      created = false;
      if (!isRunnerCreatedDbName(target.database)) {
        throw new Error(
          `Refusing to drop unexpectedly named database ${JSON.stringify(target.database)}.`,
        );
      }
      await withAdminClient(target, async (admin) => {
        // WITH (FORCE) допустим: это база, созданная данным запуском.
        await admin.query(`DROP DATABASE "${target.database}" WITH (FORCE)`);
      });
    },
  };
}

/**
 * Аварийная зачистка собственной test-базы раннера (R3b): имя обязано
 * соответствовать namespace-паттерну runner'а. Обычный DROP без FORCE —
 * владелец-процесс обязан быть уже остановлен и соединений не иметь;
 * ошибка DROP не глушится и означает незачищенный ресурс.
 */
export async function dropRunnerDatabase(target: DbTarget): Promise<void> {
  if (!isRunnerCreatedDbName(target.database)) {
    throw new Error(
      `Refusing to drop unexpectedly named database ${JSON.stringify(target.database)}.`,
    );
  }
  await withAdminClient(target, async (admin) => {
    await admin.query(`DROP DATABASE "${target.database}"`);
  });
}
