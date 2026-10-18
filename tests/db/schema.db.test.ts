import type { Client } from "pg";
import { describe, expect, test } from "vitest";
import {
  createUsers,
  expectPgError,
  withDbClient,
} from "./helpers";

/**
 * Интеграционные тесты физической схемы на реальном PostgreSQL:
 * успешные и отвергнутые INSERT/UPDATE с двумя синтетическими
 * пользователями. Никаких моков драйвера и text matching SQL.
 * SQLSTATE: 23503 — foreign key violation, 23505 — unique violation,
 * 23514 — check violation, 22P02 — invalid enum value.
 */

type Users = { userA: string; userB: string };

async function withUsers(fn: (client: Client, users: Users) => Promise<void>) {
  await withDbClient(async (client) => {
    const users = await createUsers(client);
    await fn(client, users);
  });
}

describe("auth core schema (Better Auth generated)", () => {
  test("пользователи создаются, email_verified по умолчанию false", async () => {
    await withDbClient(async (client) => {
      const { userA } = await createUsers(client);
      const { rows } = await client.query<{ email_verified: boolean }>(
        `SELECT "email_verified" FROM "user" WHERE "id" = $1`,
        [userA],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].email_verified).toBe(false);
    });
  });

  test("дубликат email отвергается", async () => {
    await withDbClient(async (client) => {
      const { userA } = await createUsers(client);
      await expectPgError(async () => {
        await client.query(
          `INSERT INTO "user" ("id", "name", "email") VALUES ('x', 'X', (SELECT "email" FROM "user" WHERE "id" = $1))`,
          [userA],
        );
      }, "23505");
    });
  });
});

describe("user_settings", () => {
  test("defaults: timezone UTC, theme system, timestamps заполнены", async () => {
    await withUsers(async (client, { userA }) => {
      await client.query(`INSERT INTO "user_settings" ("user_id") VALUES ($1)`, [
        userA,
      ]);
      const { rows } = await client.query<{
        timezone: string;
        theme: string;
        created_at: Date;
        updated_at: Date;
      }>(`SELECT * FROM "user_settings" WHERE "user_id" = $1`, [userA]);
      expect(rows[0].timezone).toBe("UTC");
      expect(rows[0].theme).toBe("system");
      expect(rows[0].created_at).toBeInstanceOf(Date);
      expect(rows[0].updated_at).toBeInstanceOf(Date);
    });
  });

  test("невалидная тема и дубликат PK отвергаются", async () => {
    await withUsers(async (client, { userA, userB }) => {
      await client.query(
        `INSERT INTO "user_settings" ("user_id") VALUES ($1)`,
        [userA],
      );
      await expectPgError(
        () =>
          client.query(
            `INSERT INTO "user_settings" ("user_id", "theme") VALUES ($1, 'sepia')`,
            [userB],
          ),
        "22P02",
      );
      await expectPgError(
        () =>
          client.query(
            `INSERT INTO "user_settings" ("user_id", "timezone", "theme") VALUES ($1, 'Europe/Berlin', 'dark')`,
            [userA],
          ),
        "23505",
      );
    });
  });

  test("theme light/dark принимаются, blank timezone отвергается, FK на неизвестного пользователя", async () => {
    await withUsers(async (client, { userA, userB }) => {
      for (const theme of ["light", "dark"]) {
        const id = `user-c-${crypto.randomUUID()}`;
        await client.query(
          `INSERT INTO "user" ("id", "name", "email") VALUES ($1, 'C', $2)`,
          [id, `${id}@example.test`],
        );
        await client.query(
          `INSERT INTO "user_settings" ("user_id", "theme") VALUES ($1, $2)`,
          [id, theme],
        );
      }
      await expectPgError(
        () =>
          client.query(
            `INSERT INTO "user_settings" ("user_id", "timezone") VALUES ($1, '   ')`,
            [userA],
          ),
        "23514",
      );
      await expectPgError(
        () =>
          client.query(
            `INSERT INTO "user_settings" ("user_id") VALUES ('no-such-user')`,
          ),
        "23503",
      );
      void userB;
    });
  });
});

describe("projects", () => {
  test("создание с defaults и trailing spaces в имени", async () => {
    await withUsers(async (client, { userA }) => {
      const { rows } = await client.query<{
        id: string;
        sort_order: number;
        archived_at: string | null;
      }>(
        `INSERT INTO "projects" ("owner_id", "name") VALUES ($1, '  Проект  ') RETURNING *`,
        [userA],
      );
      expect(rows[0].sort_order).toBe(0);
      expect(rows[0].archived_at).toBeNull();
      const { rows: archived } = await client.query<{ archived_at: Date }>(
        `UPDATE "projects" SET "archived_at" = now() WHERE "id" = $1 RETURNING "archived_at"`,
        [rows[0].id],
      );
      expect(archived[0].archived_at).toBeInstanceOf(Date);
    });
  });

  test("blank name, длина >120 и неизвестный owner отвергаются", async () => {
    await withUsers(async (client, { userA }) => {
      await expectPgError(
        () =>
          client.query(
            `INSERT INTO "projects" ("owner_id", "name") VALUES ($1, '   ')`,
            [userA],
          ),
        "23514",
      );
      await expectPgError(
        () =>
          client.query(
            `INSERT INTO "projects" ("owner_id", "name") VALUES ($1, $2)`,
            [userA, "п".repeat(121)],
          ),
        "23514",
      );
      await expectPgError(
        () =>
          client.query(
            `INSERT INTO "projects" ("owner_id", "name") VALUES ('no-such-user', 'Проект')`,
          ),
        "23503",
      );
    });
  });
});

describe("tasks: типы, defaults и round trip", () => {
  test("Inbox one-off задача: nullable поля, defaults", async () => {
    await withUsers(async (client, { userA }) => {
      const { rows } = await client.query<{
        project_id: string | null;
        parent_id: string | null;
        priority: number;
        revision: number;
        sort_order: number;
        planned_date: string | null;
        planned_time: string | null;
        deadline_date: string | null;
        recurrence_rule: string | null;
        completed_at: Date | null;
        deleted_at: Date | null;
        created_at: Date;
      }>(
        `INSERT INTO "tasks" ("owner_id", "title") VALUES ($1, 'Купить хлеб') RETURNING *`,
        [userA],
      );
      const row = rows[0];
      expect(row.project_id).toBeNull();
      expect(row.parent_id).toBeNull();
      expect(row.priority).toBe(4);
      expect(row.revision).toBe(0);
      expect(row.sort_order).toBe(0);
      expect(row.planned_date).toBeNull();
      expect(row.planned_time).toBeNull();
      expect(row.deadline_date).toBeNull();
      expect(row.recurrence_rule).toBeNull();
      expect(row.completed_at).toBeNull();
      expect(row.deleted_at).toBeNull();
      expect(row.created_at).toBeInstanceOf(Date);
    });
  });

  test("DATE и TIME сохраняют календарные значения без UTC-перевода", async () => {
    await withUsers(async (client, { userA }) => {
      // Сырой драйвер парсит date в JS Date; календарное значение проверяем
      // явным ::text кастом — физический тип и хранимое значение.
      const { rows } = await client.query<{
        planned_date_text: string;
        planned_time_text: string;
        deadline_date_text: string;
      }>(
        `INSERT INTO "tasks" ("owner_id", "title", "planned_date", "planned_time", "deadline_date")
         VALUES ($1, 'Отчёт', '2026-10-08', '19:30', '2026-10-10')
         RETURNING "planned_date"::text AS "planned_date_text",
                   "planned_time"::text AS "planned_time_text",
                   "deadline_date"::text AS "deadline_date_text"`,
        [userA],
      );
      expect(rows[0].planned_date_text).toBe("2026-10-08");
      expect(rows[0].planned_time_text).toBe("19:30:00");
      expect(rows[0].deadline_date_text).toBe("2026-10-10");
    });
  });

  test("физические типы: DATE, TIME WITHOUT TIME ZONE и timestamptz", async () => {
    await withDbClient(async (client) => {
      const { rows } = await client.query<{
        column_name: string;
        data_type: string;
      }>(
        `SELECT "column_name", "data_type" FROM "information_schema"."columns"
         WHERE "table_name" IN ('tasks', 'task_completions')
           AND "column_name" IN ('planned_date', 'deadline_date', 'occurrence_date',
                                 'planned_time', 'created_at', 'updated_at',
                                 'completed_at', 'deleted_at')`,
      );
      const types = Object.fromEntries(
        rows.map((r) => [r.column_name, r.data_type]),
      );
      expect(types.planned_date).toBe("date");
      expect(types.deadline_date).toBe("date");
      expect(types.occurrence_date).toBe("date");
      expect(types.planned_time).toBe("time without time zone");
      for (const column of [
        "created_at",
        "updated_at",
        "completed_at",
        "deleted_at",
      ]) {
        expect(types[column], column).toBe("timestamp with time zone");
      }
    });
  });

  test("deadline без planned_date допустим (независимый дедлайн)", async () => {
    await withUsers(async (client, { userA }) => {
      const { rowCount } = await client.query(
        `INSERT INTO "tasks" ("owner_id", "title", "deadline_date") VALUES ($1, 'Сдать форму', '2026-11-01')`,
        [userA],
      );
      expect(rowCount).toBe(1);
    });
  });
});

describe("tasks: checks", () => {
  test("planned_time без planned_date отвергается", async () => {
    await withUsers(async (client, { userA }) => {
      await expectPgError(
        () =>
          client.query(
            `INSERT INTO "tasks" ("owner_id", "title", "planned_time") VALUES ($1, 'T', '10:00')`,
            [userA],
          ),
        "23514",
      );
    });
  });

  test("recurrence требует planned_date и отвергает deadline", async () => {
    await withUsers(async (client, { userA }) => {
      await expectPgError(
        () =>
          client.query(
            `INSERT INTO "tasks" ("owner_id", "title", "recurrence_rule") VALUES ($1, 'T', 'DAILY')`,
            [userA],
          ),
        "23514",
      );
      await expectPgError(
        () =>
          client.query(
            `INSERT INTO "tasks" ("owner_id", "title", "planned_date", "deadline_date", "recurrence_rule")
             VALUES ($1, 'T', '2026-10-08', '2026-10-09', 'DAILY')`,
            [userA],
          ),
        "23514",
      );
    });
  });

  test("recurring задача не хранит постоянный completed_at", async () => {
    await withUsers(async (client, { userA }) => {
      await expectPgError(
        () =>
          client.query(
            `INSERT INTO "tasks" ("owner_id", "title", "planned_date", "recurrence_rule", "completed_at")
             VALUES ($1, 'T', '2026-10-08', 'WEEKLY', now())`,
            [userA],
          ),
        "23514",
      );
    });
  });

  test("priority 0 и 5 отвергаются, 1 и 4 допустимы", async () => {
    await withUsers(async (client, { userA }) => {
      for (const priority of [0, 5]) {
        await expectPgError(
          () =>
            client.query(
              `INSERT INTO "tasks" ("owner_id", "title", "priority") VALUES ($1, 'T', $2)`,
              [userA, priority],
            ),
          "23514",
        );
      }
      for (const priority of [1, 4]) {
        const { rowCount } = await client.query(
          `INSERT INTO "tasks" ("owner_id", "title", "priority") VALUES ($1, 'T', $2)`,
          [userA, priority],
        );
        expect(rowCount).toBe(1);
      }
    });
  });

  test("revision отрицательный отвергается", async () => {
    await withUsers(async (client, { userA }) => {
      await expectPgError(
        () =>
          client.query(
            `INSERT INTO "tasks" ("owner_id", "title", "revision") VALUES ($1, 'T', -1)`,
            [userA],
          ),
        "23514",
      );
    });
  });

  test("blank title, длина >500 и notes >10000 отвергаются", async () => {
    await withUsers(async (client, { userA }) => {
      await expectPgError(
        () =>
          client.query(
            `INSERT INTO "tasks" ("owner_id", "title") VALUES ($1, '  ')`,
            [userA],
          ),
        "23514",
      );
      await expectPgError(
        () =>
          client.query(
            `INSERT INTO "tasks" ("owner_id", "title") VALUES ($1, $2)`,
            [userA, "т".repeat(501)],
          ),
        "23514",
      );
      await expectPgError(
        () =>
          client.query(
            `INSERT INTO "tasks" ("owner_id", "title", "notes") VALUES ($1, 'T', $2)`,
            [userA, "n".repeat(10001)],
          ),
        "23514",
      );
      const { rowCount } = await client.query(
        `INSERT INTO "tasks" ("owner_id", "title", "notes") VALUES ($1, 'T', $2)`,
        [userA, "n".repeat(10000)],
      );
      expect(rowCount).toBe(1);
    });
  });

  test("self-parent отвергается", async () => {
    await withUsers(async (client, { userA }) => {
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO "tasks" ("owner_id", "title") VALUES ($1, 'Родитель') RETURNING "id"`,
        [userA],
      );
      await expectPgError(
        () =>
          client.query(
            `UPDATE "tasks" SET "parent_id" = "id" WHERE "id" = $1`,
            [rows[0].id],
          ),
        "23514",
      );
    });
  });

  test("валидный DAILY/WEEKDAYS/WEEKLY сохраняются", async () => {
    await withUsers(async (client, { userA }) => {
      for (const rule of ["DAILY", "WEEKDAYS", "WEEKLY"]) {
        const { rowCount } = await client.query(
          `INSERT INTO "tasks" ("owner_id", "title", "planned_date", "recurrence_rule")
           VALUES ($1, 'Повтор', '2026-10-08', $2)`,
          [userA, rule],
        );
        expect(rowCount).toBe(1);
      }
    });
  });
});

describe("tasks: ownership composite FK", () => {
  test("проект другого пользователя отвергается (вставка и UPDATE owner)", async () => {
    await withUsers(async (client, { userA, userB }) => {
      const { rows: project } = await client.query<{ id: string }>(
        `INSERT INTO "projects" ("owner_id", "name") VALUES ($1, 'Проект A') RETURNING "id"`,
        [userA],
      );
      await expectPgError(
        () =>
          client.query(
            `INSERT INTO "tasks" ("owner_id", "title", "project_id") VALUES ($1, 'Чужой проект', $2)`,
            [userB, project[0].id],
          ),
        "23503",
      );
      const { rows: task } = await client.query<{ id: string }>(
        `INSERT INTO "tasks" ("owner_id", "title", "project_id") VALUES ($1, 'Своя', $2) RETURNING "id"`,
        [userA, project[0].id],
      );
      await expectPgError(
        () =>
          client.query(
            `UPDATE "tasks" SET "owner_id" = $2 WHERE "id" = $1`,
            [task[0].id, userB],
          ),
        "23503",
      );
    });
  });

  test("родитель другого пользователя отвергается; свой родитель допустим", async () => {
    await withUsers(async (client, { userA, userB }) => {
      const { rows: parent } = await client.query<{ id: string }>(
        `INSERT INTO "tasks" ("owner_id", "title") VALUES ($1, 'Родитель A') RETURNING "id"`,
        [userA],
      );
      await expectPgError(
        () =>
          client.query(
            `INSERT INTO "tasks" ("owner_id", "title", "parent_id") VALUES ($1, 'Ребёнок B', $2)`,
            [userB, parent[0].id],
          ),
        "23503",
      );
      const { rowCount } = await client.query(
        `INSERT INTO "tasks" ("owner_id", "title", "parent_id") VALUES ($1, 'Ребёнок A', $2)`,
        [userA, parent[0].id],
      );
      expect(rowCount).toBe(1);
    });
  });

  test("у каждого пользователя свой проект с tasks; смена owner проекта при живых задачах отвергается", async () => {
    await withUsers(async (client, { userA, userB }) => {
      const { rows: project } = await client.query<{ id: string }>(
        `INSERT INTO "projects" ("owner_id", "name") VALUES ($1, 'Проект') RETURNING "id"`,
        [userA],
      );
      await client.query(
        `INSERT INTO "tasks" ("owner_id", "title", "project_id") VALUES ($1, 'Задача', $2)`,
        [userA, project[0].id],
      );
      await expectPgError(
        () =>
          client.query(
            `UPDATE "projects" SET "owner_id" = $2 WHERE "id" = $1`,
            [project[0].id, userB],
          ),
        "23503",
      );
    });
  });

  test("nullable project_id (Inbox) не мешает нескольким задачам", async () => {
    await withUsers(async (client, { userA, userB }) => {
      for (const owner of [userA, userB]) {
        const { rowCount } = await client.query(
          `INSERT INTO "tasks" ("owner_id", "title") VALUES ($1, 'Inbox задача')`,
          [owner],
        );
        expect(rowCount).toBe(1);
      }
    });
  });
});

describe("task_completions", () => {
  test("валидная one-off completion с occurrence_date и round trip", async () => {
    await withUsers(async (client, { userA }) => {
      const { rows: task } = await client.query<{ id: string; revision: number }>(
        `INSERT INTO "tasks" ("owner_id", "title") VALUES ($1, 'Одноразовая') RETURNING "id", "revision"`,
        [userA],
      );
      const { rows } = await client.query<{
        occurrence_date_text: string;
        completed_revision: number;
      }>(
        `INSERT INTO "task_completions" ("owner_id", "task_id", "occurrence_date", "completed_at", "completed_revision", "idempotency_key")
         VALUES ($1, $2, '2026-10-08', now(), $3, 'key-1') RETURNING "occurrence_date"::text AS "occurrence_date_text", "completed_revision"`,
        [userA, task[0].id, task[0].revision],
      );
      expect(rows[0].occurrence_date_text).toBe("2026-10-08");
      expect(rows[0].completed_revision).toBe(0);
    });
  });

  test("completion чужой задачи отвергается (task+owner composite)", async () => {
    await withUsers(async (client, { userA, userB }) => {
      const { rows: task } = await client.query<{ id: string }>(
        `INSERT INTO "tasks" ("owner_id", "title") VALUES ($1, 'Задача A') RETURNING "id"`,
        [userA],
      );
      await expectPgError(
        () =>
          client.query(
            `INSERT INTO "task_completions" ("owner_id", "task_id", "completed_at", "completed_revision", "idempotency_key")
             VALUES ($1, $2, now(), 0, 'key-b')`,
            [userB, task[0].id],
          ),
        "23503",
      );
    });
  });

  test("дубликаты (owner, idempotency_key) и (task, completed_revision) отвергаются", async () => {
    await withUsers(async (client, { userA }) => {
      const { rows: task } = await client.query<{ id: string }>(
        `INSERT INTO "tasks" ("owner_id", "title") VALUES ($1, 'Задача') RETURNING "id"`,
        [userA],
      );
      const insert = (key: string, revision: number) =>
        client.query(
          `INSERT INTO "task_completions" ("owner_id", "task_id", "completed_at", "completed_revision", "idempotency_key")
           VALUES ($1, $2, now(), $3, $4)`,
          [userA, task[0].id, revision, key],
        );
      await insert("key-dup", 0);
      await expectPgError(() => insert("key-dup", 1), "23505");
      await expectPgError(() => insert("key-other", 0), "23505");
    });
  });

  test("idempotency_key: blank и >128 отвергаются; negative completed_revision отвергается", async () => {
    await withUsers(async (client, { userA }) => {
      const { rows: task } = await client.query<{ id: string }>(
        `INSERT INTO "tasks" ("owner_id", "title") VALUES ($1, 'Задача') RETURNING "id"`,
        [userA],
      );
      const insert = (key: string, revision: number) =>
        client.query(
          `INSERT INTO "task_completions" ("owner_id", "task_id", "completed_at", "completed_revision", "idempotency_key")
           VALUES ($1, $2, now(), $3, $4)`,
          [userA, task[0].id, revision, key],
        );
      await expectPgError(() => insert("   ", 0), "23514");
      await expectPgError(() => insert("k".repeat(129), 0), "23514");
      await expectPgError(() => insert("ok", -1), "23514");
      const { rowCount } = await insert("k".repeat(128), 0);
      expect(rowCount).toBe(1);
    });
  });

  test("completion разных задач одного владельца с разными ключами допустимы", async () => {
    await withUsers(async (client, { userA }) => {
      const first = await client.query<{ id: string }>(
        `INSERT INTO "tasks" ("owner_id", "title") VALUES ($1, 'Первая') RETURNING "id"`,
        [userA],
      );
      const second = await client.query<{ id: string }>(
        `INSERT INTO "tasks" ("owner_id", "title") VALUES ($1, 'Вторая') RETURNING "id"`,
        [userA],
      );
      await client.query(
        `INSERT INTO "task_completions" ("owner_id", "task_id", "completed_at", "completed_revision", "idempotency_key")
         VALUES ($1, $2, now(), 0, 'key-1')`,
        [userA, first.rows[0].id],
      );
      const { rowCount } = await client.query(
        `INSERT INTO "task_completions" ("owner_id", "task_id", "completed_at", "completed_revision", "idempotency_key")
         VALUES ($1, $2, now(), 0, 'key-2')`,
        [userA, second.rows[0].id],
      );
      expect(rowCount).toBe(1);
    });
  });
});
