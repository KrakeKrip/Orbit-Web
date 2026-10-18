import { loadDotEnv } from "./db-target";
import { prepareTestDatabase } from "./runner";

/**
 * Подготовка изолированной test-базы для npm run test:db.
 *
 * Разрешение — только явный TEST_DATABASE_URL (без fallback на DATABASE_URL);
 * сервер и компоненты подключения валидируются в db-target.ts, сама база
 * создаётся с уникальным именем на этот запуск и удаляется в teardown.
 */

export default async function setup(): Promise<() => Promise<void>> {
  loadDotEnv();
  const prepared = await prepareTestDatabase(process.env);

  // Имя созданной базы получают worker'ы через окружение; проверки имени —
  // в helpers.resolveRunnerTarget().
  process.env.ORBIT_TEST_DB_NAME = prepared.target.database;

  return async () => {
    await prepared.teardown();
  };
}
