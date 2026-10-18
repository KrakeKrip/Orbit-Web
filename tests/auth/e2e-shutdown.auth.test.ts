import { randomUUID } from "node:crypto";
import { existsSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { Client } from "pg";
import { loadDotEnv, createUniqueTestDbName } from "../db/db-target.ts";
import { dropRunnerDatabase, prepareTestDatabase } from "../db/runner.ts";
import { authDbConfig } from "./helpers";
import {
  performE2EServerShutdown,
  readE2EShutdownOutcome,
  type E2EShutdownOutcome,
} from "../e2e/server-lifecycle.ts";
import { finalizeE2ERunResources } from "../e2e/run-finalization.ts";

/**
 * R3c-регрессия: конечный результат runner-финализации E2E-запуска.
 *  - штатная остановка даёт валидный completion-исход (clean:true, identity
 *    совпадает) и runner-финализация завершается успехом;
 *  - synthetic leftover connection к СВОЕЙ уникальной базе → forced cleanup
 *    → исход clean:false → финализация завершается ошибкой (итог runner'а
 *    ненулевой), даже когда аварийная зачистка уже удалила базу;
 *  - missing/чужой completion-исход не считается чистой остановкой;
 *    собственные ресурсы при этом зачищаются.
 *
 * Тесты выполняются на собственных уникальных базах этого запуска
 * (prepareTestDatabase, без предварительных DROP); чужие ресурсы и живые
 * серверы не затрагиваются. HTTP sign-in не используется. Каждый тест
 * передаёт собственные tmp-пути маркера/исхода — общие файлы test-results
 * не читаются и не пишутся.
 */

/** Пид, который гарантированно не существует: сервер считается завершённым. */
const DEAD_PID = 999999999;

function tmpRunFiles(): { markerFile: string; completionFile: string } {
  const unique = `orbit-e2e-r3c-${randomUUID()}`;
  return {
    markerFile: join(tmpdir(), `${unique}-marker.json`),
    completionFile: join(tmpdir(), `${unique}-completion.json`),
  };
}

function writeMarker(
  markerFile: string,
  database: string,
  pid: number = DEAD_PID,
): void {
  writeFileSync(markerFile, JSON.stringify({ database, pid }));
}

async function orbitTestDbExists(database: string): Promise<boolean> {
  const { host, port, user, password } = authDbConfig();
  const client = new Client({ host, port, user, password, database: "postgres" });
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

async function cleanupTmpFiles(paths: string[]): Promise<void> {
  for (const file of paths) {
    rmSync(file, { force: true });
  }
}

describe("R3c: итог остановки E2E-сервера в runner-финализации", () => {
  loadDotEnv();

  test("штатная остановка: clean:true, база удалена, финализация успешна", async () => {
    const prepared = await prepareTestDatabase(process.env);
    const { markerFile, completionFile } = tmpRunFiles();
    try {
      const outcome = await performE2EServerShutdown(prepared, {
        closeWaitMs: 1500,
        terminateWaitMs: 1000,
        completionFile,
      });
      expect(outcome.clean).toBe(true);
      expect(outcome.database).toBe(prepared.target.database);
      expect(outcome.remaining).toBe(0);

      const recorded = readE2EShutdownOutcome(completionFile);
      expect(recorded).toMatchObject({
        clean: true,
        database: prepared.target.database,
      });
      expect(await orbitTestDbExists(prepared.target.database)).toBe(false);

      writeMarker(markerFile, prepared.target.database);
      await expect(
        finalizeE2ERunResources({ markerFile, completionFile }),
      ).resolves.toBeUndefined();
      expect(existsSync(markerFile)).toBe(false);
      expect(existsSync(completionFile)).toBe(false);
    } finally {
      await cleanupTmpFiles([markerFile, completionFile]);
    }
  });

  test("forced cleanup своей уникальной БД: clean:false → финализация завершается ошибкой", async () => {
    const prepared = await prepareTestDatabase(process.env);
    const { markerFile, completionFile } = tmpRunFiles();
    const { host, port, user, password } = authDbConfig();
    const holder = new Client({ host, port, user, password, database: prepared.target.database });
    // 57P01 от pg_terminate_backend — ожидаемая часть сценария; событие
    // не даёт всплыть в процесс.
    holder.on("error", () => undefined);
    await holder.connect();
    try {
      const outcome = await performE2EServerShutdown(prepared, {
        closeWaitMs: 1500,
        terminateWaitMs: 1000,
        completionFile,
      });
      // Synthetic leftover connection Terminat'ится аварийно: исход нечистый,
      // remaining после зачистки — 0 (обрыв потребовался, а не его отсутствие).
      expect(outcome.clean).toBe(false);
      expect(outcome.remaining).toBe(0);
      // Детерминированное доказательство разрыва именно этого соединения.
      await expect(holder.query("SELECT 1")).rejects.toThrowError();
      expect(readE2EShutdownOutcome(completionFile)).toMatchObject({
        clean: false,
        database: prepared.target.database,
      });
      // Аварийная зачистка удалила собственную базу сервера.
      expect(await orbitTestDbExists(prepared.target.database)).toBe(false);

      writeMarker(markerFile, prepared.target.database);
      // Конечный результат runner: нечистая остановка → ошибка финализации
      // (итог прогона ненулевой), даже когда база уже удалена зачисткой.
      await expect(
        finalizeE2ERunResources({ markerFile, completionFile }),
      ).rejects.toThrowError(/unclean shutdown/);
      expect(existsSync(markerFile)).toBe(false);
      expect(existsSync(completionFile)).toBe(false);
      expect(await orbitTestDbExists(prepared.target.database)).toBe(false);
    } finally {
      await holder.end().catch(() => undefined);
      await cleanupTmpFiles([markerFile, completionFile]);
    }
  });

  test("missing completion-исход: удалённая БД не превращает остановку в чистую", async () => {
    // База этого запуска никогда не существовала: маркер указывает на имя
    // по всем правилам, но completion-файла нет (сервер погиб без записи).
    const database = createUniqueTestDbName();
    const { markerFile, completionFile } = tmpRunFiles();
    try {
      writeMarker(markerFile, database);
      await expect(
        finalizeE2ERunResources({ markerFile, completionFile }),
      ).rejects.toThrowError(/did not report a valid shutdown result/);
      expect(existsSync(markerFile)).toBe(false);
      expect(existsSync(completionFile)).toBe(false);
    } finally {
      await cleanupTmpFiles([markerFile, completionFile]);
    }
  });

  test("completion-исход чужой базы (identity mismatch) не принимается", async () => {
    const ownDatabase = createUniqueTestDbName();
    const { markerFile, completionFile } = tmpRunFiles();
    try {
      writeMarker(markerFile, ownDatabase);
      const foreign: E2EShutdownOutcome = {
        clean: true,
        remaining: 0,
        database: createUniqueTestDbName(),
      };
      writeFileSync(completionFile, JSON.stringify(foreign));
      await expect(
        finalizeE2ERunResources({ markerFile, completionFile }),
      ).rejects.toThrowError(/identity mismatch/);
    } finally {
      await cleanupTmpFiles([markerFile, completionFile]);
    }
  });

  test("missing completion при существующей своей БД: аварийная зачистка + ошибка", async () => {
    const prepared = await prepareTestDatabase(process.env);
    const { markerFile, completionFile } = tmpRunFiles();
    try {
      // Сервер «погиб» без зачистки: база существует, исхода нет.
      writeMarker(markerFile, prepared.target.database);
      await expect(
        finalizeE2ERunResources({ markerFile, completionFile }),
      ).rejects.toThrowError(/did not report a valid shutdown result/);
      // Собственный ресурс восстановлен финализацией, итог — ошибка.
      expect(await orbitTestDbExists(prepared.target.database)).toBe(false);
      expect(existsSync(markerFile)).toBe(false);
    } finally {
      await cleanupTmpFiles([markerFile, completionFile]);
      // Страховка от утечки при неожиданном поведении финализации: база
      // создана этим тестом, удалять её вправе только он.
      if (await orbitTestDbExists(prepared.target.database)) {
        await dropRunnerDatabase(prepared.target);
      }
    }
  });
});
