import { and, eq } from "drizzle-orm";
import { APIError, betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { account, session, user, verification } from "../db/schema.auth.ts";

/**
 * Provisioning core для локальной одноразовой bootstrap-процедуры и
 * синтетических аккаунтов в тестах. CLI-only: этот модуль НЕ импортируется
 * HTTP-обработчиками приложения и не управляется browser request/env —
 * production runtime всегда disableSignUp=true (см. auth/instance.ts).
 * Здесь нет своего password hashing и session протокола: аккаунт создаётся
 * поддерживаемым Better Auth API, поэтому формат совместим с runtime signIn.
 *
 * Атомарность и компенсация (R1/R1b):
 *  - drizzle adapter (transaction: true) выполняет весь signUpEmail в одной
 *    транзакции: любое исключение внутри endpoint откатывает её целиком,
 *    собственных строк не остаётся — компенсация на throw-пути не нужна;
 *  - при autoSignIn: false дубликат email НЕ бросает исключение: signUpEmail
 *    возвращает synthetic-ответ 200 { user } со свежесгенерированным id,
 *    которого в БД нет (поведение установленной 1.7.7 сверено по исходникам).
 *    Поэтому доказательство создания — не сам id из ответа, а строка user
 *    с этим id и нормализованным email: реальный id возвращает только вызов,
 *    создавший строку; synthetic id в БД не встречается;
 *  - компенсация выполняется только при подтверждённом создании этим
 *    вызовом: DELETE по первичному ключу, каскад FK убирает account и
 *    session. Поиск по email/времени и удаление чужих строк не выполняются;
 *    дубликат/гонка всегда завершаются отказом без изменения чужих rows.
 */

export class ProvisioningError extends Error {
  readonly code: "EMAIL_EXISTS" | "PROVISIONING_FAILED";

  constructor(code: "EMAIL_EXISTS" | "PROVISIONING_FAILED", message: string) {
    super(message);
    this.name = "ProvisioningError";
    this.code = code;
  }
}

export type ProvisionedUser = {
  userId: string;
  email: string;
};

/**
 * Серверный sign-in для синтетических fixtures integration-тестов: сессия
 * создаётся поддерживаемым Better Auth API (sign-in endpoint, без
 * собственного session protocol) с ТЕМ ЖЕ секретом, что и runtime
 * instance, поэтому cookie валидна для реального HTTP этого запуска.
 * Нужно потому, что HTTP sign-in лимитер runtime (10/60s на IP) намеренно
 * исчерпывается auth-flow suite, а порядок vitest-файлов по размеру
 * недетерминирован: fixtures не должны конкурировать за production bucket.
 * Сама лимитер-защита не ослабляется и продолжает тестироваться
 * HTTP-сценариями auth-flow.
 */
export async function signInLocalUser(
  connectionString: string,
  input: { email: string; password: string; secret: string },
): Promise<{ sessionCookie: string }> {
  const pool = new Pool({ connectionString, max: 1 });
  try {
    const auth = betterAuth({
      database: drizzleAdapter(drizzle(pool), {
        provider: "pg",
        schema: { user, session, account, verification },
        transaction: true,
      }),
      secret: input.secret,
      emailAndPassword: {
        enabled: true,
        autoSignIn: false,
      },
      telemetry: {
        enabled: false,
      },
    });
    const result = await auth.api.signInEmail({
      body: { email: input.email, password: input.password },
      returnHeaders: true,
    });
    const cookies = result.headers?.getSetCookie() ?? [];
    const sessionCookie = cookies
      .map((line) => line.split(";", 1)[0])
      .filter((pair) => pair.includes("="))
      .join("; ");
    if (sessionCookie === "") {
      throw new ProvisioningError(
        "PROVISIONING_FAILED",
        "Sign-in did not return a session cookie.",
      );
    }
    return { sessionCookie };
  } finally {
    await pool.end();
  }
}

export async function provisionLocalUser(
  connectionString: string,
  input: { email: string; password: string; name: string },
): Promise<ProvisionedUser> {
  const pool = new Pool({ connectionString, max: 1 });

  try {
    const db = drizzle(pool);
    const auth = betterAuth({
      database: drizzleAdapter(drizzle(pool), {
        provider: "pg",
        schema: { user, session, account, verification },
        transaction: true,
      }),
      // Регистрация разрешена ТОЛЬКО в этом CLI/provisioning instance.
      emailAndPassword: {
        enabled: true,
        autoSignIn: false,
      },
      telemetry: {
        enabled: false,
      },
    });

    // Better Auth нормализует email к нижнему регистру (sign-up: toLowerCase),
    // поэтому pre-check и все сравнения — по нормализованному значению:
    // повторный запуск с существующим email в любом регистре отказывает без
    // изменения password/account и без нового user/session.
    const normalizedEmail = input.email.toLowerCase();
    const existing = await db
      .select({ id: user.id })
      .from(user)
      .where(eq(user.email, normalizedEmail))
      .limit(1);
    if (existing.length > 0) {
      throw new ProvisioningError(
        "EMAIL_EXISTS",
        "A user with this email already exists: nothing was changed.",
      );
    }

    let createdUserId: string | null = null;
    let returnedUserId: string | null = null;
    try {
      const result = await auth.api.signUpEmail({
        body: {
          email: input.email,
          password: input.password,
          name: input.name,
        },
      });
      returnedUserId = result?.user?.id ?? null;
      if (!returnedUserId) {
        throw new ProvisioningError(
          "PROVISIONING_FAILED",
          "Provisioning did not return a user.",
        );
      }

      // Доказательство создания (см. комментарий модуля): synthetic duplicate
      // ответ несёт id, которого в БД нет, — это отказ EMAIL_EXISTS без
      // каких-либо изменений; чужие rows не считаются созданными нами.
      const created = await db
        .select({ id: user.id })
        .from(user)
        .where(and(eq(user.id, returnedUserId), eq(user.email, normalizedEmail)))
        .limit(1);
      if (created.length === 0) {
        throw new ProvisioningError(
          "EMAIL_EXISTS",
          "A user with this email already exists: nothing was changed.",
        );
      }
      createdUserId = returnedUserId;

      // Целостность после создания: credential account существует, активная
      // сессия не создавалась. Любая аномалия уходит в компенсацию ниже.
      const accounts = await db
        .select({ id: account.id })
        .from(account)
        .where(
          and(eq(account.userId, createdUserId), eq(account.providerId, "credential")),
        );
      if (accounts.length === 0) {
        throw new ProvisioningError(
          "PROVISIONING_FAILED",
          "Credential account was not created.",
        );
      }
      const sessions = await db
        .select({ id: session.id })
        .from(session)
        .where(eq(session.userId, createdUserId));
      if (sessions.length > 0) {
        throw new ProvisioningError(
          "PROVISIONING_FAILED",
          "Unexpected active session after provisioning.",
        );
      }

      return { userId: createdUserId, email: normalizedEmail };
    } catch (error) {
      // Компенсация только подтверждённо собственных строк этого вызова:
      // удаление по первичному ключу возвращённого id (каскад убирает
      // account/session). Если создание не подтверждено (synthetic duplicate,
      // отказ API, сбой внутри транзакции) — ничего не удаляется: броски
      // внутри signUpEmail откатывают транзакцию целиком (transaction: true),
      // а чужие rows по email/времени не ищутся и не изменяются.
      if (returnedUserId !== null) {
        try {
          await db
            .delete(user)
            .where(
              and(
                eq(user.id, returnedUserId),
                eq(user.email, normalizedEmail),
              ),
            );
        } catch (cleanupError) {
          console.error(
            "[bootstrap] compensation of the user created by this call failed:",
            cleanupError instanceof Error ? cleanupError.message : cleanupError,
          );
        }
      }
      // 422 от signUpEmail — email занят (pre-existing или создан конкурентным
      // вызовом между pre-check и INSERT): транзакция откатилась, отказ как
      // дубликат. У APIError числовой код — statusCode; status — строка.
      if (error instanceof APIError && error.statusCode === 422) {
        throw new ProvisioningError(
          "EMAIL_EXISTS",
          "A user with this email already exists: nothing was changed.",
        );
      }
      throw error;
    }
  } finally {
    await pool.end();
  }
}
