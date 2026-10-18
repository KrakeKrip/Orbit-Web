import { randomBytes } from "node:crypto";

/**
 * Единая валидация эффективной конфигурации подключения test-раннера (R2).
 *
 * Правила:
 *  - разрешение на test-режим — только явный TEST_DATABASE_URL из переданного
 *    окружения; никакого fallback на DATABASE_URL;
 *  - только протоколы postgresql/postgres;
 *  - query-параметры запрещены целиком: pg трактует ?host= и другие параметры
 *    как переопределения, поэтому guard проверяет именно эффективную
 *    конфигурацию;
 *  - host, port, user, password, database обязательны явно: переменные
 *    PGHOST/PGUSER и системные defaults пользователя в подключение не попадают;
 *  - подключение собирается из проверенных частей, сырой URL в pg не передаётся.
 *
 * Ошибки не включают user/password/URL.
 */

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);
const TEST_DB_NAMESPACE = "orbit_test";
const CREATED_DB_PATTERN = /^orbit_test_[0-9]+_[a-z0-9]+$/;

export type DbTarget = {
  host: string;
  port: number;
  user: string;
  password: string;
  /** Имя фактически создаваемой базы: уникально для каждого запуска. */
  database: string;
};

export function loadDotEnv(): void {
  try {
    // Не переопределяет уже установленные переменные.
    process.loadEnvFile(".env");
  } catch {
    // .env может отсутствовать: переменные берутся из окружения.
  }
}

function describeHost(host: string): string {
  return host === "" ? "(empty)" : host;
}

/** Чистая валидация: не выполняет сетевых операций и DDL. */
export function resolveTestDatabaseTarget(
  env: NodeJS.ProcessEnv = process.env,
): DbTarget {
  const raw = env.TEST_DATABASE_URL;
  if (!raw || raw.trim() === "") {
    throw new Error(
      "TEST_DATABASE_URL is not set: the DB test runner requires explicit test permission and never falls back to DATABASE_URL. Copy .env.example to .env for local development.",
    );
  }

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("TEST_DATABASE_URL is not a valid URL.");
  }

  if (url.protocol !== "postgresql:" && url.protocol !== "postgres:") {
    throw new Error(
      `Refusing protocol ${url.protocol}: only postgresql:// (or postgres://) is allowed.`,
    );
  }

  const queryKeys = [...url.searchParams.keys()];
  if (queryKeys.length > 0) {
    // Включая ?host=/&port=/&sslmode=: параметры могут перенаправить
    // подключение мимо проверенного loopback-хоста.
    throw new Error(
      `Refusing TEST_DATABASE_URL with query parameters (${queryKeys.join(", ")}): the effective connection must come from the URL authority only.`,
    );
  }

  // raw hostname и его percent-декодирование оба должны быть локальными.
  const rawHost = url.hostname.replace(/^\[|\]$/g, "");
  let decodedHost = rawHost;
  if (rawHost.includes("%")) {
    try {
      decodedHost = decodeURIComponent(rawHost);
    } catch {
      throw new Error("Refusing TEST_DATABASE_URL host: invalid percent-encoding.");
    }
  }
  if (!LOCAL_HOSTS.has(rawHost) || !LOCAL_HOSTS.has(decodedHost)) {
    throw new Error(
      `Refusing non-local test database host: ${describeHost(decodedHost)}. Only localhost/127.0.0.1/::1 are allowed.`,
    );
  }

  if (url.port === "") {
    throw new Error("Refusing TEST_DATABASE_URL without an explicit port.");
  }
  const port = Number(url.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Refusing invalid TEST_DATABASE_URL port: ${url.port}.`);
  }

  // URL не декодирует userinfo автоматически для opaque-схем — декодируем явно.
  let user: string;
  let password: string;
  try {
    user = decodeURIComponent(url.username);
    password = decodeURIComponent(url.password);
  } catch {
    throw new Error("Refusing TEST_DATABASE_URL userinfo: invalid percent-encoding.");
  }
  if (user === "" || password === "") {
    throw new Error(
      "Refusing TEST_DATABASE_URL without explicit user and password: environment defaults (PGUSER/PGPASSWORD/system user) are not accepted.",
    );
  }

  const namespace = url.pathname.replace(/^\//, "");
  if (namespace !== TEST_DB_NAMESPACE) {
    throw new Error(
      `Refusing database namespace ${JSON.stringify(namespace)}: the runner creates per-run databases only for "${TEST_DB_NAMESPACE}".`,
    );
  }

  return {
    host: decodedHost,
    port,
    user,
    password,
    database: createUniqueTestDbName(),
  };
}

export function createUniqueTestDbName(now: Date = new Date()): string {
  return `${TEST_DB_NAMESPACE}_${now.getTime()}_${randomBytes(4).toString("hex")}`;
}

export function isRunnerCreatedDbName(name: string): boolean {
  return CREATED_DB_PATTERN.test(name);
}

/** Проверенное administrative подключение (maintenance-база postgres). */
export function adminTarget(target: DbTarget): DbTarget {
  return { ...target, database: "postgres" };
}
