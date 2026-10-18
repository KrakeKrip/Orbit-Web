import { randomBytes } from "node:crypto";
import { describe, expect, test } from "vitest";
import { provisionLocalUser } from "@/server/auth/bootstrap-core";
import { authDbConnectionString } from "./helpers";

/**
 * R1/R1b-регрессия: атомарность и компенсация provisioning.
 *  - отказ credential INSERT (fault injection триггером) не оставляет orphan
 *    user/account/session — транзакция adapter'а откатывается целиком;
 *  - ошибка ПОСЛЕ создания account (unexpected session, injection триггером)
 *    откатывает подтверждённо собственные rows этого вызова — 0/0/0, без
 *    удаления чужих строк;
 *  - дубликат email в любом регистре и гонка двух конкурентных вызовов
 *    сохраняют чужие rows и password;
 *  - совместимость успешного provisioning со знаком в HTTP доказана в
 *    auth-flow.auth.test.ts (пользователи A/B созданы тем же core);
 *    здесь HTTP sign-in не используется, чтобы не конкурировать с общим
 *    in-memory rate limiter'ом runtime-инстанса (ключ по IP, 10/60s).
 * База — уникальная база этого auth-запуска, чужие ресурсы не затрагиваются.
 */

async function installAccountInsertFault(): Promise<void> {
  const { Client } = await import("pg");
  const client = new Client({ connectionString: authDbConnectionString() });
  await client.connect();
  try {
    // Имена fault-объектов — фиксированные константы теста.
    await client.query(`
      CREATE FUNCTION orbit_test_fail_account_insert() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          RAISE EXCEPTION 'orbit fault injection: account insert rejected';
        END;
      $$;
    `);
    await client.query(
      `CREATE TRIGGER orbit_test_fail_account_insert_trg BEFORE INSERT ON "account" FOR EACH ROW EXECUTE FUNCTION orbit_test_fail_account_insert()`,
    );
  } finally {
    await client.end();
  }
}

async function removeAccountInsertFault(): Promise<void> {
  const { Client } = await import("pg");
  const client = new Client({ connectionString: authDbConnectionString() });
  await client.connect();
  try {
    await client.query(
      `DROP TRIGGER IF EXISTS orbit_test_fail_account_insert_trg ON "account"`,
    );
    await client.query(
      `DROP FUNCTION IF EXISTS orbit_test_fail_account_insert()`,
    );
  } finally {
    await client.end();
  }
}

/**
 * R1b fault injection: AFTER INSERT на account добавляет synthetic session
 * созданному пользователю. Транзакция signUpEmail завершается успешно
 * (commit user+account+session) — аномалия обнаруживается post-check
 * provisioning core, компенсация обязана убрать все строки этого вызова.
 */
async function installSessionInjectionFault(): Promise<void> {
  const { Client } = await import("pg");
  const client = new Client({ connectionString: authDbConnectionString() });
  await client.connect();
  try {
    await client.query(`
      CREATE FUNCTION orbit_test_inject_session() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          INSERT INTO "session"
            ("id", "expires_at", "token", "user_id", "created_at", "updated_at")
          VALUES
            ('orbit-test-injected-session',
             now() + interval '1 hour',
             'orbit-test-injected-token',
             NEW."user_id", now(), now());
          RETURN NEW;
        END;
      $$;
    `);
    await client.query(
      `CREATE TRIGGER orbit_test_inject_session_trg AFTER INSERT ON "account" FOR EACH ROW EXECUTE FUNCTION orbit_test_inject_session()`,
    );
  } finally {
    await client.end();
  }
}

async function removeSessionInjectionFault(): Promise<void> {
  const { Client } = await import("pg");
  const client = new Client({ connectionString: authDbConnectionString() });
  await client.connect();
  try {
    await client.query(
      `DROP TRIGGER IF EXISTS orbit_test_inject_session_trg ON "account"`,
    );
    await client.query(
      `DROP FUNCTION IF EXISTS orbit_test_inject_session()`,
    );
  } finally {
    await client.end();
  }
}

async function countRows(email: string): Promise<{
  users: number;
  accounts: number;
  sessions: number;
}> {
  const { Client } = await import("pg");
  const client = new Client({ connectionString: authDbConnectionString() });
  await client.connect();
  try {
    const users = await client.query<{ count: string }>(
      `SELECT count(*)::text AS "count" FROM "user" WHERE "email" = $1`,
      [email],
    );
    const accounts = await client.query<{ count: string }>(
      `SELECT count(*)::text AS "count" FROM "account" WHERE "user_id" IN (SELECT "id" FROM "user" WHERE "email" = $1)`,
      [email],
    );
    const sessions = await client.query<{ count: string }>(
      `SELECT count(*)::text AS "count" FROM "session" WHERE "user_id" IN (SELECT "id" FROM "user" WHERE "email" = $1)`,
      [email],
    );
    return {
      users: Number(users.rows[0].count),
      accounts: Number(accounts.rows[0].count),
      sessions: Number(sessions.rows[0].count),
    };
  } finally {
    await client.end();
  }
}

describe("R1: атомарность provisioning", () => {
  const faultEmail = `fault-inject-${crypto.randomUUID()}@orbit.test`;

  test("отказ credential INSERT не оставляет partial user/account/session", async () => {
    await installAccountInsertFault();
    try {
      await expect(
        provisionLocalUser(authDbConnectionString(), {
          email: faultEmail,
          password: randomBytes(12).toString("hex"),
          name: "Fault Injection",
        }),
      ).rejects.toThrowError();

      const state = await countRows(faultEmail);
      expect(state.users).toBe(0);
      expect(state.accounts).toBe(0);
      expect(state.sessions).toBe(0);
    } finally {
      await removeAccountInsertFault();
    }
  });

  test("повтор после сбоя и успешный bootstrap дают валидный аккаунт", async () => {
    const email = `retry-ok-${crypto.randomUUID()}@orbit.test`;
    const password = randomBytes(12).toString("hex");

    await provisionLocalUser(authDbConnectionString(), {
      email,
      password,
      name: "Retry OK",
    });
    const state = await countRows(email);
    expect(state.users).toBe(1);
    expect(state.accounts).toBe(1);
    expect(state.sessions).toBe(0);
    // Совместимость provision → sign-in дополнительно доказана в
    // auth-flow.auth.test.ts (пользователи A/B, созданные тем же core).
  });
});

describe("R1b: компенсация после создания account", () => {
  test("unexpected session после создания account откатывает user/account/session этого вызова", async () => {
    const email = `session-inject-${crypto.randomUUID()}@orbit.test`;
    const password = randomBytes(12).toString("hex");

    await installSessionInjectionFault();
    try {
      await expect(
        provisionLocalUser(authDbConnectionString(), {
          email,
          password,
          name: "Session Inject",
        }),
      ).rejects.toMatchObject({ code: "PROVISIONING_FAILED" });

      // Компенсация подтверждённо собственных строк: ровно 0/0/0 по этому
      // email — пользователь, credential account и injected session убраны.
      const state = await countRows(email);
      expect(state.users).toBe(0);
      expect(state.accounts).toBe(0);
      expect(state.sessions).toBe(0);
    } finally {
      await removeSessionInjectionFault();
    }

    // Повтор того же email после сбоя успешен: компенсация убрала все
    // строки этого вызова, ничего не блокирует повторный provisioning.
    await provisionLocalUser(authDbConnectionString(), {
      email,
      password,
      name: "Session Inject",
    });
    const retryState = await countRows(email);
    expect(retryState.users).toBe(1);
    expect(retryState.accounts).toBe(1);
    expect(retryState.sessions).toBe(0);
  });

  test("дубликат в другом регистре сохраняет чужие rows и password", async () => {
    const base = `case-dup-${crypto.randomUUID()}`;
    const existingEmail = `${base}@orbit.test`;
    const existingPassword = randomBytes(12).toString("hex");

    await provisionLocalUser(authDbConnectionString(), {
      email: existingEmail,
      password: existingPassword,
      name: "Existing User",
    });

    const { Client } = await import("pg");
    const client = new Client({ connectionString: authDbConnectionString() });
    await client.connect();
    let hashBefore: string;
    try {
      const rows = await client.query<{ password: string }>(
        `SELECT "password" FROM "account" WHERE "user_id" = (SELECT "id" FROM "user" WHERE "email" = $1) AND "provider_id" = 'credential'`,
        [existingEmail],
      );
      hashBefore = rows.rows[0].password;
    } finally {
      await client.end();
    }

    // Нормализация email (toLowerCase, как в better-auth) даёт отказ ещё
    // до вызова API; synthetic duplicate ответ не создаёт строк.
    await expect(
      provisionLocalUser(authDbConnectionString(), {
        email: `${base.toUpperCase()}@ORBIT.TEST`,
        password: randomBytes(12).toString("hex"),
        name: "Duplicate Attempt",
      }),
    ).rejects.toMatchObject({ code: "EMAIL_EXISTS" });

    const state = await countRows(existingEmail);
    expect(state.users).toBe(1);
    expect(state.accounts).toBe(1);
    expect(state.sessions).toBe(0);

    const clientAfter = new Client({
      connectionString: authDbConnectionString(),
    });
    await clientAfter.connect();
    try {
      const rows = await clientAfter.query<{ password: string }>(
        `SELECT "password" FROM "account" WHERE "user_id" = (SELECT "id" FROM "user" WHERE "email" = $1) AND "provider_id" = 'credential'`,
        [existingEmail],
      );
      expect(rows.rows[0].password).toBe(hashBefore);
    } finally {
      await clientAfter.end();
    }
  });

  test("гонка двух вызовов: один успех, другой отказ, чужие rows целы", async () => {
    const email = `race-${crypto.randomUUID()}@orbit.test`;
    const passwordOne = randomBytes(12).toString("hex");
    const passwordTwo = randomBytes(12).toString("hex");

    const settled = await Promise.allSettled([
      provisionLocalUser(authDbConnectionString(), {
        email,
        password: passwordOne,
        name: "Race One",
      }),
      provisionLocalUser(authDbConnectionString(), {
        email,
        password: passwordTwo,
        name: "Race Two",
      }),
    ]);

    const fulfilled = settled.filter((s) => s.status === "fulfilled");
    const rejected = settled.filter(
      (s) => s.status === "rejected",
    ) as PromiseRejectedResult[];
    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);
    // Проигравший вызов получает отказ-дубликат: synthetic duplicate ответ
    // (id нет в БД) либо 422 от уникального индекса — чужие rows не тронуты.
    expect((rejected[0].reason as { code?: string }).code).toBe("EMAIL_EXISTS");

    const state = await countRows(email);
    expect(state.users).toBe(1);
    expect(state.accounts).toBe(1);
    expect(state.sessions).toBe(0);
    // Ровно одна строка пользователя с одним credential account: в БД
    // остался только победитель, его password hash не изменялся другими
    // вызовами; сохранность пароля доказана hash-сравнением в duplicate-тесте.
  });
});
