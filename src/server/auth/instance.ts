import "server-only";

import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { drizzle } from "drizzle-orm/node-postgres";
import { getDbPool } from "@/server/db/core";
import { account, session, user, verification } from "@/server/db/schema.auth";
import { readAuthRuntimeConfig } from "./env";

/**
 * Server-only runtime Better Auth instance (HTTP app).
 *
 * - Публичная регистрация отключена на сервере без env-переключателя:
 *   прямой POST /sign-up отвергается независимо от наличия формы.
 * - trustedOrigins — только явно сконфигурированный baseURL; wildcard и
 *   доверие любому Host/forwarded заголовку отсутствуют.
 * - Session cookie cache выключен явно: отозванная/истёкшая сессия не
 *   принимается по cookie-снимку, валидация выполняется на каждом запросе.
 * - Sign-in rate limiting включён явно (однопроцессное memory хранилище —
 *   локальная основа; перед deployment требуется пересмотр proxy/IP и
 *   durable storage).
 * - Телеметрия выключена; рантайм не делает внешних сетевых запросов.
 * - Инициализация ленивая: import модуля не требует env и не подключается
 *   к БД; при отсутствии конфигурации первый auth-запрос падает с понятной
 *   ошибкой (fail-closed), workspace анонимным не становится.
 *
 * Cookies: HttpOnly + SameSite по умолчанию better-auth; secure включается
 * при https base URL — loopback HTTP development поддерживается.
 */

let authInstance: ReturnType<typeof createAuth> | null = null;

function createAuth() {
  const config = readAuthRuntimeConfig();

  return betterAuth({
    baseURL: config.baseURL,
    secret: config.secret,
    trustedOrigins: [config.baseURL],
    database: drizzleAdapter(drizzle(getDbPool()), {
      provider: "pg",
      schema: { user, session, account, verification },
    }),
    emailAndPassword: {
      enabled: true,
      // Публичный signup запрещён на сервере (без env-переключателя).
      disableSignUp: true,
    },
    session: {
      // Cookie snapshot сессии отключён: revoked/expired session отклоняется
      // при каждом запросе.
      cookieCache: {
        enabled: false,
      },
    },
    rateLimit: {
      enabled: true,
      window: 60,
      // Общий лимит для остальных маршрутов.
      max: 10,
    },
    plugins: [
      {
        // Документированный sign-in лимит (переопределяет встроенное
        // special-правило better-auth 3/10s): 10 попыток/60s на IP — запас
        // для browser-сценариев того же процесса. Memory storage, один
        // процесс; перед deployment — пересмотр trusted proxy/IP и
        // durable storage.
        id: "orbit-sign-in-rate-limit",
        rateLimit: [
          {
            pathMatcher: (path: string) => path.startsWith("/sign-in"),
            window: 60,
            max: 10,
          },
        ],
      },
    ],
    telemetry: {
      enabled: false,
    },
  });
}

export function getAuth() {
  if (!authInstance) {
    authInstance = createAuth();
  }
  return authInstance;
}
