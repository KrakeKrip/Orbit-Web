import "server-only";

/**
 * Server-only доступ к БД для app/service кода. Реализация — в
 * `./core.ts` (lower-level core для CLI/тестов); этот модуль добавляет
 * enforceable границу: импорт из клиентских компонентов ломает build,
 * пул и строки подключения не попадают в client bundle.
 */

export { getDbPool, getDb, closeDbPool } from "./core.ts";
