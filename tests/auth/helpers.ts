import { Client } from "pg";
import { loadDotEnv, resolveTestDatabaseTarget } from "../db/db-target";
import { runnerTarget } from "../db/helpers";

/**
 * Помощники auth integration suite: база, созданная global-setup этого
 * запуска (ORBIT_TEST_DB_NAME), и проверенный base URL in-process сервера.
 * Подключения собираются из проверенных частей, без сырого URL в pg.
 */

export function authBaseURL(): string {
  const baseURL = process.env.AUTH_TEST_BASE_URL;
  if (!baseURL) {
    throw new Error(
      "AUTH_TEST_BASE_URL is not set by the runner: run the auth suite via npm run test:auth.",
    );
  }
  return baseURL;
}

export function authDbConfig(): {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
} {
  loadDotEnv();
  // Валидация TEST_DATABASE_URL выполняется повторно намеренно: target без
  // проверенного namespace не используется даже для чтения.
  resolveTestDatabaseTarget();
  return runnerTarget();
}

export function authDbConnectionString(): string {
  const { host, port, user, password, database } = authDbConfig();
  return `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(
    password,
  )}@${host}:${port}/${database}`;
}

export async function withAuthDbClient<T>(
  fn: (client: Client) => Promise<T>,
): Promise<T> {
  const { host, port, user, password, database } = authDbConfig();
  const client = new Client({ host, port, user, password, database });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set by the runner.`);
  }
  return value;
}

export type FetchResult = {
  status: number;
  body: unknown;
  headers: Headers;
  setCookie: string[];
};

export async function fetchJson(
  path: string,
  init: RequestInit & { cookie?: string } = {},
): Promise<FetchResult> {
  const { cookie, ...rest } = init;
  const headers = new Headers(rest.headers);
  if (rest.body !== undefined) {
    headers.set("content-type", "application/json");
  }
  if (cookie) {
    headers.set("cookie", cookie);
  }
  const response = await fetch(`${authBaseURL()}${path}`, { ...rest, headers });
  const setCookie = response.headers.getSetCookie();
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  return { status: response.status, body, headers: response.headers, setCookie };
}

export function collectCookie(setCookie: string[]): string {
  // Собирает пары name=value из Set-Cookie для последующих запросов.
  return setCookie
    .map((line) => line.split(";", 1)[0])
    .filter((pair) => pair.includes("="))
    .join("; ");
}

export async function signIn(
  email: string,
  password: string,
  init: RequestInit & { origin?: string } = {},
): Promise<FetchResult> {
  const { origin, ...rest } = init;
  const headers: Record<string, string> = {};
  if (origin) {
    headers.origin = origin;
  }
  return fetchJson("/api/auth/sign-in/email", {
    method: "POST",
    headers,
    body: JSON.stringify({ email, password }),
    ...rest,
  });
}

export async function currentUser(
  cookie: string,
  extra: { query?: string; headers?: Record<string, string> } = {},
): Promise<FetchResult> {
  return fetchJson(`/api/v1/me${extra.query ?? ""}`, {
    headers: extra.headers,
    cookie,
  });
}
