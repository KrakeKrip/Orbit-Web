import { existsSync, readFileSync, rmSync } from "node:fs";
import { Client } from "pg";
import {
  isRunnerCreatedDbName,
  loadDotEnv,
  resolveTestDatabaseTarget,
  type DbTarget,
} from "../db/db-target.ts";
import { dropRunnerDatabase } from "../db/runner.ts";
import {
  E2E_DB_MARKER,
  E2E_SHUTDOWN_COMPLETION,
  readE2EShutdownOutcome,
} from "./server-lifecycle.ts";

/**
 * Runner-сторона финализации E2E-запуска (R3c): проверяет достоверный
 * результат остановки сервера ЭТОГО запуска, а не только исчезновение pid
 * и отсутствие базы. Отсутствие/невалидность/провал completion-исхода при
 * CI-остановке — нечистое завершение: собственная база аварийно
 * зачищается по имени из маркера (проверка namespace-паттерна), а вызов
 * завершается ошибкой, чтобы итог runner'а был ненулевым, даже если
 * аварийная зачистка уже удалила базу.
 *
 * Политика reuseExistingServer вне CI сохранена: живой сервер-владелец не
 * сигналится, его база не проверяется. Никаких сетевых teardown-эндпоинтов.
 *
 * Чужие ресурсы невозможны: имя базы берётся только из маркера этого
 * запуска и обязано соответствовать orbit_test-паттерну раннера.
 */

export type FinalizeE2ERunOptions = {
  markerFile?: string;
  completionFile?: string;
};

function adminConfig(): { host: string; port: number; user: string; password: string } {
  loadDotEnv();
  // Валидация TEST_DATABASE_URL выполняется повторно намеренно: подключения
  // строятся только из проверенных частей (host/port/user/password).
  const target = resolveTestDatabaseTarget(process.env);
  return {
    host: target.host,
    port: target.port,
    user: target.user,
    password: target.password,
  };
}

function adminTargetWith(database: string): DbTarget {
  return { ...adminConfig(), database };
}

function waitProcessExit(pid: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve) => {
    const poll = () => {
      try {
        process.kill(pid, 0);
        if (Date.now() > deadline) {
          resolve(false);
          return;
        }
        setTimeout(poll, 200);
      } catch {
        resolve(true);
      }
    };
    poll();
  });
}

async function databaseExists(database: string): Promise<boolean> {
  const client = new Client({ ...adminConfig(), database: "postgres" });
  await client.connect();
  try {
    const { rows } = await client.query<{ exists: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM "pg_database" WHERE "datname" = $1) AS "exists"`,
      [database],
    );
    return rows[0].exists;
  } finally {
    await client.end();
  }
}

async function waitForDatabaseDropped(
  database: string,
  timeoutMs: number,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!(await databaseExists(database))) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return !(await databaseExists(database));
}

/** Аварийная зачистка собственной test-базы, если она ещё существует. */
async function dropOwnDbIfPresent(database: string): Promise<void> {
  if (await databaseExists(database)) {
    await dropRunnerDatabase(adminTargetWith(database));
  }
}

export async function finalizeE2ERunResources(
  options: FinalizeE2ERunOptions = {},
): Promise<void> {
  const markerFile = options.markerFile ?? E2E_DB_MARKER;
  const completionFile = options.completionFile ?? E2E_SHUTDOWN_COMPLETION;

  if (!existsSync(markerFile)) {
    clearE2EFiles(completionFile);
    return;
  }
  const raw = readFileSync(markerFile, "utf8");
  rmSync(markerFile, { force: true });

  let parsed: { pid?: number; database?: string };
  try {
    parsed = JSON.parse(raw);
  } catch {
    clearE2EFiles(completionFile);
    return;
  }
  const pid = parsed.pid;
  if (typeof pid !== "number" || pid <= 0) {
    clearE2EFiles(completionFile);
    return;
  }

  let alive = true;
  try {
    process.kill(pid, 0);
  } catch {
    alive = false;
  }
  if (alive && !process.env.CI) {
    // reuseExistingServer вне CI оставит сервер работать: живой процесс —
    // владелец базы, сигнал ему не пересылается, результат не проверяется.
    return;
  }
  if (alive) {
    process.kill(pid, "SIGTERM");
    const exited = await waitProcessExit(pid, 20000);
    if (!exited) {
      // Нечистая остановка: базу живого владельца не трогаем, итог — сбой.
      throw new Error(
        `E2E server pid ${pid} did not exit within 20s after SIGTERM; its test database was left untouched.`,
      );
    }
  }

  try {
    const outcome = readE2EShutdownOutcome(completionFile);
    // Имя базы только из маркера этого запуска, с проверкой namespace-паттерна;
    // исход принимается лишь если он относится к этой базе.
    const dbName =
      typeof parsed.database === "string" && isRunnerCreatedDbName(parsed.database)
        ? parsed.database
        : null;
    const trustedOutcome =
      outcome && dbName !== null && outcome.database === dbName ? outcome : null;

    if (!trustedOutcome) {
      if (dbName !== null) {
        await dropOwnDbIfPresent(dbName);
      }
      throw new Error(
        `E2E server pid ${pid} did not report a valid shutdown result for its own test database` +
          `${dbName !== null ? ` (${dbName})` : ""}: ` +
          `${outcome ? "completion resource identity mismatch" : "completion result is missing or invalid"}. ` +
          `Forced cleanup does not count as a clean shutdown.`,
      );
    }
    if (!trustedOutcome.clean) {
      if (dbName !== null) {
        await dropOwnDbIfPresent(dbName);
      }
      throw new Error(
        `E2E server reported an unclean shutdown of ${trustedOutcome.database}: ` +
          `${trustedOutcome.detail ?? `${trustedOutcome.remaining} connection(s) remained after cleanup`}. ` +
          `Forced cleanup does not count as a clean shutdown; the E2E gate fails.`,
      );
    }
    if (dbName !== null) {
      const dropped = await waitForDatabaseDropped(dbName, 10000);
      if (!dropped) {
        await dropOwnDbIfPresent(dbName);
        throw new Error(
          `E2E server reported a clean shutdown but left its test database ${dbName}; ` +
            `teardown dropped it as own-resource recovery. This is not a clean teardown.`,
        );
      }
    }
  } finally {
    rmSync(completionFile, { force: true });
  }
}

function clearE2EFiles(completionFile: string): void {
  rmSync(completionFile, { force: true });
}
