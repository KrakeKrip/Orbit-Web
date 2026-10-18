import type http from "node:http";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { closeAppPoolAndConnections } from "../db/app-connections.ts";
import { prepareTestDatabase } from "../db/runner.ts";

/**
 * Серверная сторона остановки E2E-сервера и её локальный completion result
 * (R3c). Итог остановки конкретного запуска записывается синхронно в файл
 * ДО завершения процесса: исчезновение pid и отсутствие базы сами по себе
 * не доказывают чистую остановку — runner-side finalization читает исход,
 * и missing/failed результат считается нечистой остановкой, даже если
 * аварийная зачистка уже удалила собственную базу.
 *
 * Никаких сетевых teardown-эндпоинтов: только локальный файл в
 * gitignored test-results. Политика reuseExistingServer вне CI (живой
 * сервер-владелец не сигналится и не проверяется) не меняется.
 */

export const E2E_AUTH_DIR = path.join("test-results", ".auth");
export const E2E_DB_MARKER = path.join(E2E_AUTH_DIR, "e2e-db.json");
export const E2E_SHUTDOWN_COMPLETION = path.join(
  E2E_AUTH_DIR,
  "e2e-shutdown.json",
);

export type E2EShutdownOutcome = {
  /** false: потребовался принудительный обрыв либо остановка не завершилась. */
  clean: boolean;
  /** Остаток соединений после аварийной зачистки (0 — обрыв потребовался). */
  remaining: number;
  /** Идентичность ресурса: база, к которой относится этот исход. */
  database: string;
  detail?: string;
};

/** Синхронная запись исхода: результат обязан пережить process.exit. */
export function recordE2EShutdownOutcome(
  outcome: E2EShutdownOutcome,
  file: string = E2E_SHUTDOWN_COMPLETION,
): void {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(outcome));
}

/** null: файла нет или содержимое не является валидным исходом. */
export function readE2EShutdownOutcome(
  file: string = E2E_SHUTDOWN_COMPLETION,
): E2EShutdownOutcome | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
  const outcome = parsed as Partial<E2EShutdownOutcome> | null;
  if (
    !outcome ||
    typeof outcome.clean !== "boolean" ||
    typeof outcome.remaining !== "number" ||
    typeof outcome.database !== "string" ||
    outcome.database === ""
  ) {
    return null;
  }
  return outcome as E2EShutdownOutcome;
}

export function clearE2EShutdownOutcome(
  file: string = E2E_SHUTDOWN_COMPLETION,
): void {
  rmSync(file, { force: true });
}

export type E2EServerShutdownOptions = {
  /** HTTP-сервер этого процесса, если был поднят. */
  server?: http.Server | null;
  closeWaitMs?: number;
  terminateWaitMs?: number;
  /** Путь completion-файла (по умолчанию — общий test-results/.auth). */
  completionFile?: string;
};

/**
 * Полная серверная остановка конкретного E2E-запуска: остановка HTTP →
 * закрытие фактического пула приложения и ожидание нуля соединений к своей
 * базе (принудительный обрыв — только аварийная зачистка, clean:false) →
 * удаление своей базы → синхронная запись исхода. Возвращает исход, по
 * которому скрипт выбирает exit code (0/1).
 */
export async function performE2EServerShutdown(
  prepared: Awaited<ReturnType<typeof prepareTestDatabase>> | null,
  options: E2EServerShutdownOptions = {},
): Promise<E2EShutdownOutcome> {
  const {
    server = null,
    closeWaitMs,
    terminateWaitMs,
    completionFile,
  } = options;
  const database = prepared?.target.database ?? "";
  let outcome: E2EShutdownOutcome;
  try {
    if (server) {
      // closeAllConnections: keep-alive сокеты браузера не должны удерживать
      // close — иначе SIGKILL придёт раньше удаления своей test-базы.
      server.closeAllConnections();
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
    }
    const closed = prepared
      ? await closeAppPoolAndConnections(prepared.target, {
          closeWaitMs,
          terminateWaitMs,
        })
      : { clean: true, remaining: 0 };
    if (prepared) {
      await prepared.teardown();
    }
    outcome = {
      clean: closed.clean,
      remaining: closed.remaining,
      database,
      detail: closed.clean
        ? undefined
        : "forced termination of own DB connections was required",
    };
  } catch (error) {
    // best-effort зачистка собственной базы даже при сбое остановки.
    if (prepared) {
      try {
        await prepared.teardown();
      } catch {
        // исход ниже всё равно clean:false
      }
    }
    outcome = {
      clean: false,
      remaining: -1,
      database,
      detail: `shutdown failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  recordE2EShutdownOutcome(outcome, completionFile);
  return outcome;
}
