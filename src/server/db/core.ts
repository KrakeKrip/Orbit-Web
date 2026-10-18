import { drizzle } from "drizzle-orm/node-postgres";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

/**
 * Нижний уровень доступа к БД (lower-level core, без server-only маркера):
 * разрешён CLI/тестовой инфраструктуре (scripts/, tests/, e2e-сервер),
 * которые создают собственные подключения/пулы и закрывают их явно.
 *
 * App-facing граница — `src/server/db/client.ts` (server-only): клиентские
 * компоненты не могут импортировать пул, а Next build это проверяет.
 * На import ничего не подключается и DATABASE_URL не требуется; первая
 * явная DB-операция без настроенного DATABASE_URL получает понятную
 * ошибку без раскрытия секретов.
 *
 * Пул живёт в реестре на globalThis (стандартный для Next global-singleton
 * приём): собранный Next bundle содержит собственную копию этого модуля со
 * своей module-scope переменной, а globalThis у процесса один — исходный
 * core и копия из bundle сходятся к одному экземпляру пула. Поэтому
 * closeDbPool() из тестового графа закрывает фактический пул приложения
 * (R3b), и teardown удаляет test-базу без принудительного обрыва открытых
 * соединений.
 */

type OrbitDbGlobal = typeof globalThis & {
  __orbitDbState?: {
    pool: Pool;
    db: NodePgDatabase<Record<string, never>>;
  };
};

const globalRef = globalThis as OrbitDbGlobal;

function ensureDbState(): {
  pool: Pool;
  db: NodePgDatabase<Record<string, never>>;
} {
  let state = globalRef.__orbitDbState;
  if (!state) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error(
        "DATABASE_URL is not set: database operations are unavailable. Copy .env.example to .env for local development.",
      );
    }
    const pool = new Pool({ connectionString, max: 10 });
    // Стандартная практика pg: ошибки idle-клиентов (например, рестарт БД)
    // эмитятся на пул и без обработчика роняют процесс. Ошибка логируется —
    // не глушится.
    pool.on("error", (error) => {
      console.error("[db] idle client error:", error.message);
    });
    state = { pool, db: drizzle(pool) };
    globalRef.__orbitDbState = state;
  }
  return state;
}

export function getDbPool(): Pool {
  return ensureDbState().pool;
}

export function getDb(): NodePgDatabase<Record<string, never>> {
  return ensureDbState().db;
}

export async function closeDbPool(): Promise<void> {
  const state = globalRef.__orbitDbState;
  if (!state) {
    return;
  }
  globalRef.__orbitDbState = undefined;
  await state.pool.end();
}
