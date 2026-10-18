import http from "node:http";
import path from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";
import { loadDotEnv } from "../tests/db/db-target.ts";
import { prepareTestDatabase } from "../tests/db/runner.ts";
import { closeAppPoolAndConnections } from "../tests/db/app-connections.ts";
import { provisionLocalUser } from "../src/server/auth/bootstrap-core.ts";
import {
  E2E_DB_MARKER,
  clearE2EShutdownOutcome,
  performE2EServerShutdown,
  recordE2EShutdownOutcome,
} from "../tests/e2e/server-lifecycle.ts";
import {
  e2eSecret,
  userAEmail,
  userAPassword,
  userBEmail,
  userBPassword,
  userCEmail,
  userCPassword,
} from "../tests/e2e/credentials.ts";

/**
 * Production-сервер для Playwright E2E (запускается webServer'ом playwright):
 * изолированная per-run база (проверенный target, уникальное имя, миграции)
 * и production Next request handler в этом же процессе (реальные сетевые
 * сокеты). Синтетические аккаунты A/B; пароли генерирует playwright config
 * и передаёт через окружение (AUTH_E2E_USER_*_PASSWORD) — литералов нет.
 *
 * Остановка (R3b/R3c): SIGTERM/SIGINT → graceful close HTTP-сервера →
 * закрытие фактического пула приложения (общий с compiled-бандлом через
 * globalThis реестр) → ожидание нуля соединений к своей базе → удаление
 * только своей базы → синхронная запись completion-исхода остановки
 * (clean:true/false + имя своей базы) → exit 0/1. Принудительный обрыв
 * соединений — только аварийная зачистка: исход clean:false, runner-side
 * finalization превращает его в ненулевой итог всего прогона.
 * Имя базы и pid записываются в маркер сразу после создания базы: любой
 * сбой оставляет finalization'у имя базы для проверки зачистки.
 */

function childDatabaseUrl(target: {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
}): string {
  return `postgresql://${encodeURIComponent(target.user)}:${encodeURIComponent(
    target.password,
  )}@${target.host}:${target.port}/${target.database}`;
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`${name} is required for the E2E server.`);
    process.exit(1);
  }
  return value;
}

let shuttingDown = false;
let prepared: Awaited<ReturnType<typeof prepareTestDatabase>> | null = null;
let server: http.Server | null = null;

async function shutdown(): Promise<void> {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  // R3c: исход остановки (включая имя своей базы) записывается синхронно
  // до выхода; exit 1 при clean:false — нечистая остановка, которую
  // runner-side finalization обязан превратить в ненулевой итог прогона.
  const outcome = await performE2EServerShutdown(prepared, { server });
  if (!outcome.clean) {
    console.error(
      `[e2e-server] unclean shutdown: ${outcome.detail ?? `${outcome.remaining} connection(s) remained after cleanup`}`,
    );
    process.exit(1);
  }
  process.exit(0);
}

process.on("SIGTERM", () => {
  void shutdown();
});
process.on("SIGINT", () => {
  void shutdown();
});

async function main(): Promise<void> {
  loadDotEnv();
  // Прошлый запуска не должен оставить исход, который примут за результат
  // этого запуска (identities сверяются, но stale-файл не нужен).
  clearE2EShutdownOutcome();
  prepared = await prepareTestDatabase(process.env);
  const target = prepared.target;
  const port = Number(requiredEnv("E2E_PORT"));
  const baseURL = `http://127.0.0.1:${port}`;

  // Маркер пишется сразу после создания базы: любой сбой ниже оставляет
  // finalization'у имя базы и pid для проверки зачистки собственной базы.
  mkdirSync(path.join("test-results", ".auth"), { recursive: true });
  writeFileSync(
    E2E_DB_MARKER,
    JSON.stringify({ database: target.database, pid: process.pid }),
  );

  // Сбой init не оставляет своих сервера/пула/базы.
  try {
    Object.assign(process.env, {
      NODE_ENV: "production",
      DATABASE_URL: childDatabaseUrl(target),
      BETTER_AUTH_SECRET: e2eSecret,
      BETTER_AUTH_URL: baseURL,
      PORT: String(port),
    });
    const databaseUrl = childDatabaseUrl(target);

    await provisionLocalUser(databaseUrl, {
      email: userAEmail,
      password: userAPassword,
      name: "E2E User A",
    });
    await provisionLocalUser(databaseUrl, {
      email: userBEmail,
      password: userBPassword,
      name: "E2E User B",
    });
    // Пользователь C — изолированный fixture для сценария смены аккаунта
    // (TASK-005): theme-мутации B не пересекаются с проверкой чужих
    // настроек при повторном входе в том же browser storage.
    await provisionLocalUser(databaseUrl, {
      email: userCEmail,
      password: userCPassword,
      name: "E2E User C",
    });

    const { getRequestHandlers } = await import(
      "next/dist/server/lib/start-server.js"
    );
    const { requestHandler } = (await getRequestHandlers({
      dir: process.cwd(),
      port,
      hostname: "127.0.0.1",
      isDev: false,
      minimalMode: false,
      quiet: true,
      onDevServerCleanup: () => undefined,
    })) as unknown as {
      requestHandler: (
        request: http.IncomingMessage,
        response: http.ServerResponse,
      ) => Promise<void>;
    };

    const activeServer: http.Server = http.createServer(
      (request, response) => {
        void requestHandler(request, response);
      },
    );
    server = activeServer;
    await new Promise<void>((resolve) => {
      activeServer.listen(port, "127.0.0.1", resolve);
    });
    console.log(`E2E server ready at ${baseURL}`);
  } catch (error) {
    // R3b: закрыть пул приложения до удаления своей базы; принудительный
    // обрыв при сбое init — аварийная зачистка, она логируется. Исход
    // фиксируется как неуспешный: запуск не считается чисто остановленным.
    const closed = await closeAppPoolAndConnections(target);
    await prepared.teardown();
    if (!closed.clean) {
      console.error(
        `[e2e-server] init cleanup: ${closed.remaining} connection(s) required forced termination`,
      );
    }
    recordE2EShutdownOutcome({
      clean: false,
      remaining: closed.remaining,
      database: target.database,
      detail: "init failed before the server started serving",
    });
    throw error;
  }
}

await main();
