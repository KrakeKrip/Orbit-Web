/**
 * Чистая валидация runtime-конфигурации auth (без импортов БД/auth и без
 * server-only marker): модуль импортируется pure-тестами. Ошибки не включают
 * значения переменных (секреты/URL не печатаются и не попадают в логи).
 */

export type AuthRuntimeConfig = {
  databaseUrl: string;
  secret: string;
  baseURL: string;
};

const MIN_SECRET_LENGTH = 32;

function requireValue(
  env: Record<string, string | undefined>,
  name: string,
  purpose: string,
): string {
  const value = env[name];
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(
      `${name} is not set: ${purpose} unavailable. Auth requests fail closed until the runtime configuration is provided.`,
    );
  }
  return value;
}

/**
 * Origin настроенного BETTER_AUTH_URL (scheme://host[:port], без пути).
 * Используется cookie-mutation endpoints для точной server-side Origin
 * проверки: разрешённый origin не берётся из Host/X-Forwarded-*.
 */
export function readAuthBaseOrigin(
  env: Record<string, string | undefined> = process.env,
): string {
  const baseURL = requireValue(env, "BETTER_AUTH_URL", "auth runtime");
  let parsedBaseURL: URL;
  try {
    parsedBaseURL = new URL(baseURL);
  } catch {
    throw new Error("BETTER_AUTH_URL is not a valid absolute http(s) URL.");
  }
  if (parsedBaseURL.protocol !== "https:" && parsedBaseURL.protocol !== "http:") {
    throw new Error("BETTER_AUTH_URL must use http or https.");
  }
  return parsedBaseURL.origin;
}

export function readAuthRuntimeConfig(
  env: Record<string, string | undefined> = process.env,
): AuthRuntimeConfig {
  const databaseUrl = requireValue(env, "DATABASE_URL", "database access");
  let parsedDatabaseUrl: URL;
  try {
    parsedDatabaseUrl = new URL(databaseUrl);
  } catch {
    throw new Error("DATABASE_URL is not a valid URL.");
  }
  if (
    parsedDatabaseUrl.protocol !== "postgresql:" &&
    parsedDatabaseUrl.protocol !== "postgres:"
  ) {
    throw new Error("DATABASE_URL must use the postgresql protocol.");
  }

  const secret = requireValue(env, "BETTER_AUTH_SECRET", "auth runtime");

  if (secret.length < MIN_SECRET_LENGTH) {
    throw new Error(
      `BETTER_AUTH_SECRET is too short: generate at least ${MIN_SECRET_LENGTH} characters of randomness (e.g. openssl rand -hex 32).`,
    );
  }

  return { databaseUrl, secret, baseURL: readAuthBaseOrigin(env) };
}
