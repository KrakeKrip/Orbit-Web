import http from "node:http";
import { randomBytes } from "node:crypto";
import { loadDotEnv } from "../db/db-target.ts";
import { prepareTestDatabase } from "../db/runner.ts";
import { closeAppPoolAndConnections } from "../db/app-connections.ts";
import { provisionLocalUser } from "../../src/server/auth/bootstrap-core.ts";

/**
 * Global setup auth suite (npm run test:auth): изолированная per-run база
 * (проверенный target, уникальное имя, миграции) + production Next
 * request handler, поднятый в процессе тест-раннера на собственном
 * http-сервере (реальные сетевые сокеты, HTTP-граница настоящая).
 *
 * Runtime-конфигурация auth живёт только в памяти этого процесса
 * (temporary secret, temporary baseURL, собственная база) и выставляется
 * до инициализации обработчика; build и UI-тесты от неё не зависят.
 * Синтетические аккаунты A/B создаются provisioning core; их пароли
 * генерируются на этот запуск и передаются тестам через окружение.
 *
 * Teardown (R3/R3b): остановка своего http-сервера → закрытие фактического
 * пула приложения (общий с compiled-бандлом через globalThis-реестр) →
 * ожидание нуля соединений → удаление только своей базы. Принудительный
 * обрыв соединений — только аварийная зачистка; в этом случае teardown
 * завершается ошибкой, а не успешным результатом.
 * Сбой setup не оставляет своих сервера/пула/базы.
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

function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = http.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

/** Ожидание готовности: корректный ответ /login от production-обработчика. */
function waitForReady(baseURL: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const poll = async () => {
      if (Date.now() > deadline) {
        reject(new Error(`Next server did not become ready at ${baseURL}`));
        return;
      }
      try {
        const response = await fetch(`${baseURL}/login`);
        if (response.ok) {
          resolve();
          return;
        }
      } catch {
        // сервер ещё не готов
      }
      setTimeout(poll, 500);
    };
    void poll();
  });
}

export default async function setup(): Promise<() => Promise<void>> {
  loadDotEnv();
  const prepared = await prepareTestDatabase(process.env);
  const target = prepared.target;
  const databaseUrl = childDatabaseUrl(target);

  const port = await getFreePort();
  const baseURL = `http://127.0.0.1:${port}`;
  const secret = randomBytes(32).toString("hex");

  // Синтетические пользователи A/B: одноразовые пароли этого запуска.
  const userAPassword = randomBytes(16).toString("hex");
  const userBPassword = randomBytes(16).toString("hex");

  let server: http.Server | null = null;
  let stopped = false;
  const stopServer = async () => {
    const active = server;
    if (stopped || !active) {
      return;
    }
    stopped = true;
    await new Promise<void>((resolve) => {
      // closeAllConnections: keep-alive не удерживает остановку сервера,
      // чтобы teardown успел закрыть пул и удалить свою базу.
      active.closeAllConnections();
      active.close(() => resolve());
    });
  };

  // Сбой setup не оставляет своих сервера/пула/базы.
  try {
    // Runtime env до инициализации Next-обработчика (fail-closed при отсутствии).
    Object.assign(process.env, {
      NODE_ENV: "production",
      DATABASE_URL: databaseUrl,
      BETTER_AUTH_SECRET: secret,
      BETTER_AUTH_URL: baseURL,
      PORT: String(port),
    });

    await provisionLocalUser(databaseUrl, {
      email: "user-a@orbit.test",
      password: userAPassword,
      name: "User A",
    });
    await provisionLocalUser(databaseUrl, {
      email: "user-b@orbit.test",
      password: userBPassword,
      name: "User B",
    });

    // Production request handler Next.js (тот же кодовый путь, что и у
    // `next start`): подключается к собранному .next и отвечает по HTTP.
    const { getRequestHandlers } = await import(
      "next/dist/server/lib/start-server.js"
    );
    const { requestHandler } = (await getRequestHandlers({
      dir: process.cwd(),
      port,
      hostname: "127.0.0.1",
      isDev: false,
      minimalMode: false,
      quiet: false,
      onDevServerCleanup: () => undefined,
    })) as unknown as {
      requestHandler: (
        request: import("node:http").IncomingMessage,
        response: import("node:http").ServerResponse,
      ) => Promise<void>;
    };

    const createdServer: http.Server = http.createServer((request, response) => {
      void requestHandler(request, response);
    });
    server = createdServer;
    await new Promise<void>((resolve) => {
      createdServer.listen(port, "127.0.0.1", resolve);
    });
    await waitForReady(baseURL, 60000);
  } catch (error) {
    await stopServer();
    // Пул приложения закрывается ДО удаления собственной test-базы (R3b);
    // принудительный обрыв здесь допустим только как аварийная зачистка.
    const closed = await closeAppPoolAndConnections(target);
    await prepared.teardown();
    if (!closed.clean) {
      console.error(
        `[auth-setup] init cleanup: ${closed.remaining} connection(s) required forced termination`,
      );
    }
    throw error;
  }

  process.env.AUTH_TEST_BASE_URL = baseURL;
  process.env.AUTH_TEST_USER_A_EMAIL = "user-a@orbit.test";
  process.env.AUTH_TEST_USER_A_PASSWORD = userAPassword;
  process.env.AUTH_TEST_USER_B_EMAIL = "user-b@orbit.test";
  process.env.AUTH_TEST_USER_B_PASSWORD = userBPassword;
  process.env.ORBIT_TEST_DB_NAME = target.database;

  return async () => {
    await stopServer();
    // Пул приложения закрывается ДО удаления собственной test-базы (R3b):
    // closeDbPool закрывает фактический пул compiled-бандла (globalThis
    // реестр), затем дожидаемся нуля соединений к СВОЕЙ базе. Аварийный
    // принудительный обрыв (clean:false) превращается в явный сбой teardown
    // — он не считается успешным завершением.
    const closed = await closeAppPoolAndConnections(target);
    await prepared.teardown();
    if (!closed.clean) {
      throw new Error(
        `R3b regression: ${closed.remaining} app connection(s) to the test DB required forced termination after closeDbPool; this is not a clean teardown.`,
      );
    }
  };
}
