import { randomBytes, randomUUID } from "node:crypto";
import { beforeAll, describe, expect, test } from "vitest";
import {
  provisionLocalUser,
  signInLocalUser,
} from "@/server/auth/bootstrap-core";
import {
  authBaseURL,
  authDbConnectionString,
  requireEnv,
  withAuthDbClient,
} from "./helpers";

/**
 * HTTP/PostgreSQL integration tasks (TASK-007) на production Next handler
 * этого auth-запуска. Фикстуры: отдельные синтетические U/V; сессии
 * минтируются server-side (signInLocalUser) — без конкуренции за HTTP
 * sign-in limiter. Побочные fixture-задачи (dated/parent/child/project/
 * recurrence/deleted) вставляются напрямую только в собственную per-run
 * базу, без публичных seed endpoints.
 */

const COLLECTION_PATH = "/api/v1/tasks";

const run = randomUUID();
const uEmail = `tasks-u-${run}@orbit.test`;
const vEmail = `tasks-v-${run}@orbit.test`;
const fixturePassword = randomBytes(12).toString("hex");

let uUserId = "";
let vUserId = "";
let uCookie = "";
let vCookie = "";

type ApiResult = {
  status: number;
  body: unknown;
  cacheControl: string | null;
};

type RequestOptions = {
  cookie?: string;
  origin?: string | null;
  omitOrigin?: boolean;
  contentType?: string | null;
  rawBody?: string;
  payload?: unknown;
  query?: string;
  path?: string;
  method?: "GET" | "POST" | "PATCH" | "DELETE";
};

async function tasksCall(opts: RequestOptions = {}): Promise<ApiResult> {
  const method = opts.method ?? "GET";
  const headers: Record<string, string> = {};
  if (opts.cookie) {
    headers.cookie = opts.cookie;
  }
  if (!opts.omitOrigin) {
    const origin = opts.origin === undefined ? authBaseURL() : opts.origin;
    if (origin !== null) {
      headers.origin = origin;
    }
  }
  if (opts.contentType !== null && method !== "DELETE") {
    headers["content-type"] = opts.contentType ?? "application/json";
  }
  const text =
    opts.rawBody !== undefined
      ? opts.rawBody
      : opts.payload !== undefined
        ? JSON.stringify(opts.payload)
        : undefined;
  const path = opts.path ?? COLLECTION_PATH;
  const response = await fetch(`${authBaseURL()}${path}${opts.query ?? ""}`, {
    method,
    headers,
    body: method === "GET" ? undefined : (text ?? null),
  });
  let body: unknown = null;
  if (response.status !== 204) {
    try {
      body = await response.json();
    } catch {
      body = null;
    }
  }
  return {
    status: response.status,
    body,
    cacheControl: response.headers.get("cache-control"),
  };
}

type TaskDTO = {
  id: string;
  title: string;
  projectId: string | null;
  parentId: string | null;
  completedAt: string | null;
  revision: number;
  createdAt: string;
  updatedAt: string;
};

function taskOf(result: ApiResult, key: "task" | "tasks"): TaskDTO {
  expect(result.body).toBeInstanceOf(Object);
  const container = (result.body as Record<string, unknown>)[key];
  expect(container).toBeTruthy();
  return (Array.isArray(container) ? container[0] : container) as TaskDTO;
}

async function createViaApi(
  cookie: string,
  title: string,
): Promise<TaskDTO> {
  const response = await tasksCall({
    method: "POST",
    cookie,
    payload: { title },
  });
  expect(response.status).toBe(201);
  return taskOf(response, "task");
}

type TaskRow = {
  id: string;
  title: string;
  project_id: string | null;
  parent_id: string | null;
  completed_at: Date | null;
  deleted_at: Date | null;
  revision: number;
  created_at: Date;
  updated_at: Date;
};

async function taskRow(taskId: string): Promise<TaskRow | null> {
  return withAuthDbClient(async (client) => {
    const { rows } = await client.query<TaskRow>(
      `SELECT "id", "title", "project_id", "parent_id", "completed_at", "deleted_at", "revision", "created_at", "updated_at" FROM "tasks" WHERE "id" = $1`,
      [taskId],
    );
    return rows[0] ?? null;
  });
}

type JournalRow = {
  id: string;
  owner_id: string;
  task_id: string;
  occurrence_date: string | null;
  completed_at: Date;
  completed_revision: number;
  idempotency_key: string;
};

async function journalRows(taskId: string): Promise<JournalRow[]> {
  return withAuthDbClient(async (client) => {
    const { rows } = await client.query<JournalRow>(
      `SELECT "id", "owner_id", "task_id", "occurrence_date"::text AS "occurrence_date", "completed_at", "completed_revision", "idempotency_key" FROM "task_completions" WHERE "task_id" = $1 ORDER BY "completed_at"`,
      [taskId],
    );
    return rows;
  });
}

async function countTasks(ownerId: string): Promise<number> {
  return withAuthDbClient(async (client) => {
    const { rows } = await client.query<{ count: string }>(
      `SELECT count(*)::text AS "count" FROM "tasks" WHERE "owner_id" = $1`,
      [ownerId],
    );
    return Number(rows[0].count);
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isValidUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    value,
  );
}

beforeAll(async () => {
  const u = await provisionLocalUser(authDbConnectionString(), {
    email: uEmail,
    password: fixturePassword,
    name: "Tasks U",
  });
  uUserId = u.userId;
  const v = await provisionLocalUser(authDbConnectionString(), {
    email: vEmail,
    password: fixturePassword,
    name: "Tasks V",
  });
  vUserId = v.userId;

  const secret = requireEnv("BETTER_AUTH_SECRET");
  const uSession = await signInLocalUser(authDbConnectionString(), {
    email: uEmail,
    password: fixturePassword,
    secret,
  });
  uCookie = uSession.sessionCookie;
  const vSession = await signInLocalUser(authDbConnectionString(), {
    email: vEmail,
    password: fixturePassword,
    secret,
  });
  vCookie = vSession.sessionCookie;
  expect(uCookie).not.toBe("");
  expect(vCookie).not.toBe("");
});

describe("GET /api/v1/tasks (Inbox collection)", () => {
  test("пустой default open list с context, no-store", async () => {
    const response = await tasksCall({ cookie: uCookie });
    expect(response.status).toBe(200);
    const payload = response.body as {
      tasks: unknown[];
      context: { timezone: string; today: string; asOf: string; view: string };
    };
    expect(payload.tasks).toEqual([]);
    expect(payload.context.timezone).toBe("UTC");
    expect(payload.context.view).toBe("inbox");
    expect(/^\d{4}-\d{2}-\d{2}$/.test(payload.context.today)).toBe(true);
    expect(response.cacheControl).toBe("private, no-store");
  });

  test("query: unsupported/unknown/duplicate → 400", async () => {
    for (const query of [
      "?status=bogus",
      "?status=open&status=all",
      "?status=open&other=1",
      "?owner_id=x",
      "?project_id=x",
    ]) {
      const response = await tasksCall({ cookie: uCookie, query });
      expect(response.status, query).toBe(400);
      expect(response.body).toMatchObject({ error: { code: "VALIDATION_ERROR" } });
    }
  });

  test("анонимный/tampered запрос: 401 без записей", async () => {
    const anonymous = await tasksCall({});
    expect(anonymous.status).toBe(401);
    expect(anonymous.body).toMatchObject({ error: { code: "UNAUTHENTICATED" } });
    const tampered = await tasksCall({
      cookie: "better-auth.session_token=tampered",
    });
    expect(tampered.status).toBe(401);
    expect(await countTasks(uUserId)).toBe(0);
    expect(await countTasks(vUserId)).toBe(0);
  });
});

describe("POST /api/v1/tasks", () => {
  test("создание: 201 DTO defaults, DB defaults, trim", async () => {
    const response = await tasksCall({
      method: "POST",
      cookie: uCookie,
      payload: { title: "  Купить хлеб  " },
    });
    expect(response.status).toBe(201);
    const task = taskOf(response, "task");
    expect(task.title).toBe("Купить хлеб");
    expect(task.projectId).toBeNull();
    expect(task.parentId).toBeNull();
    expect(task.completedAt).toBeNull();
    expect(task.revision).toBe(0);
    expect(isValidUuid(task.id)).toBe(true);
    expect(task.createdAt).toBe(task.updatedAt);

    const row = await taskRow(task.id);
    expect(row?.title).toBe("Купить хлеб");
    const fullRow = await withAuthDbClient(async (client) => {
      const { rows } = await client.query<{
        priority: number;
        sort_order: number;
        planned_date: string | null;
        notes: string | null;
        recurrence_rule: string | null;
        deleted_at: Date | null;
      }>(
        `SELECT "priority", "sort_order", "planned_date", "notes", "recurrence_rule", "deleted_at" FROM "tasks" WHERE "id" = $1`,
        [task.id],
      );
      return rows[0];
    });
    expect(fullRow.priority).toBe(4);
    expect(fullRow.sort_order).toBe(0);
    expect(fullRow.planned_date).toBeNull();
    expect(fullRow.notes).toBeNull();
    expect(fullRow.recurrence_rule).toBeNull();
    expect(fullRow.deleted_at).toBeNull();
  });

  test("граница 500 code points: 500 ok, 501 → 400 без записи", async () => {
    const ok = await tasksCall({
      method: "POST",
      cookie: uCookie,
      payload: { title: "🦄".repeat(500) },
    });
    expect(ok.status).toBe(201);
    expect(taskOf(ok, "task").title).toBe("🦄".repeat(500));

    const before = await countTasks(uUserId);
    const tooLong = await tasksCall({
      method: "POST",
      cookie: uCookie,
      payload: { title: "🦄".repeat(501) },
    });
    expect(tooLong.status).toBe(400);
    expect(tooLong.body).toMatchObject({
      error: { code: "VALIDATION_ERROR", field: "title" },
    });
    expect(await countTasks(uUserId)).toBe(before);
  });

  test("NUL и unpaired surrogate → 400 (не 500), без записи", async () => {
    const before = await countTasks(uUserId);
    for (const title of ["хлеб\u0000", "\uD800", "хлеб\uDC00"]) {
      const response = await tasksCall({
        method: "POST",
        cookie: uCookie,
        payload: { title },
      });
      expect(response.status, JSON.stringify(title)).toBe(400);
      expect(response.body).toMatchObject({
        error: { code: "VALIDATION_ERROR", field: "title" },
      });
    }
    expect(await countTasks(uUserId)).toBe(before);
  });

  test("дубликаты разрешены; невалидные payloads → 400 без записи", async () => {
    const first = await tasksCall({
      method: "POST",
      cookie: uCookie,
      payload: { title: "Дубликат" },
    });
    const second = await tasksCall({
      method: "POST",
      cookie: uCookie,
      payload: { title: "Дубликат" },
    });
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(taskOf(first, "task").id).not.toBe(taskOf(second, "task").id);

    const cases: Array<{ payload?: unknown; rawBody?: string; field?: string }> = [
      { payload: {} },
      { payload: { title: "   " }, field: "title" },
      { payload: { title: 42 }, field: "title" },
      { payload: { title: "A", extra: true } },
      { payload: { id: randomUUID(), title: "A" } },
      { payload: { owner_id: vUserId, title: "A" } },
      { payload: { project_id: randomUUID(), title: "A" } },
      { payload: { parent_id: randomUUID(), title: "A" } },
      { payload: { priority: 1, title: "A" } },
      { payload: { completed: false, title: "A" } },
      { rawBody: "not json" },
      { rawBody: "null" },
      { rawBody: "" },
    ];
    const before = await countTasks(uUserId);
    for (const { payload, rawBody, field } of cases) {
      const response = await tasksCall({
        method: "POST",
        cookie: uCookie,
        payload,
        rawBody,
      });
      expect(response.status, JSON.stringify(payload ?? rawBody)).toBe(400);
      expect(response.body).toMatchObject({
        error: field
          ? { code: "VALIDATION_ERROR", field }
          : { code: "VALIDATION_ERROR" },
      });
    }
    expect(await countTasks(uUserId)).toBe(before);
  });

  test("transport: jsonp 415 / charset 201 / 413 / Origin 403 без записи; query 400; no-store", async () => {
    const before = await countTasks(uUserId);

    const jsonp = await tasksCall({
      method: "POST",
      cookie: uCookie,
      contentType: "application/jsonp",
      payload: { title: "JSONP" },
    });
    expect(jsonp.status).toBe(415);
    expect(jsonp.body).toMatchObject({ error: { code: "UNSUPPORTED_MEDIA_TYPE" } });

    // TASK-008: task streaming лимит поднят до 4 KiB (title500emoji+schedule).
    const oversize = await tasksCall({
      method: "POST",
      cookie: uCookie,
      rawBody: `{"title":"${"a".repeat(5000)}"}`,
    });
    expect(oversize.status).toBe(413);

    const withQuery = await tasksCall({
      method: "POST",
      cookie: uCookie,
      query: "?status=all",
      payload: { title: "A" },
    });
    expect(withQuery.status).toBe(400);

    for (const origin of ["https://evil.example", "null"]) {
      const hostile = await tasksCall({
        method: "POST",
        cookie: uCookie,
        origin,
        payload: { title: "A" },
      });
      expect(hostile.status).toBe(403);
      expect(hostile.body).toMatchObject({ error: { code: "FORBIDDEN_ORIGIN" } });
    }
    const missingOrigin = await tasksCall({
      method: "POST",
      cookie: uCookie,
      omitOrigin: true,
      payload: { title: "A" },
    });
    expect(missingOrigin.status).toBe(403);

    const charset = await tasksCall({
      method: "POST",
      cookie: uCookie,
      contentType: "application/json;charset=UTF-8",
      payload: { title: "Charset OK" },
    });
    expect(charset.status).toBe(201);
    expect(charset.cacheControl).toBe("private, no-store");
    expect(await countTasks(uUserId)).toBe(before + 1);
  });
});

describe("item GET/PATCH: rename, no-op, completion journal", () => {
  let taskId = "";

  beforeAll(async () => {
    taskId = (await createViaApi(uCookie, "Item task")).id;
  });

  test("invalid UUID → 400; query → 400", async () => {
    const badId = await tasksCall({
      path: `${COLLECTION_PATH}/not-a-uuid`,
      cookie: uCookie,
    });
    expect(badId.status).toBe(400);
    expect(badId.body).toMatchObject({
      error: { code: "VALIDATION_ERROR", field: "taskId" },
    });
    const withQuery = await tasksCall({
      path: `${COLLECTION_PATH}/${taskId}`,
      cookie: uCookie,
      query: "?status=all",
    });
    expect(withQuery.status).toBe(400);
  });

  test("foreign/missing → одинаковый 404; V список пуст", async () => {
    const unknown = await tasksCall({
      path: `${COLLECTION_PATH}/${randomUUID()}`,
      cookie: uCookie,
    });
    expect(unknown.status).toBe(404);
    expect(unknown.body).toEqual({ error: { code: "NOT_FOUND" } });
    const foreign = await tasksCall({
      path: `${COLLECTION_PATH}/${taskId}`,
      cookie: vCookie,
    });
    expect(foreign.status).toBe(404);
    expect(foreign.body).toEqual(unknown.body);
    const vList = await tasksCall({ cookie: vCookie });
    expect((vList.body as { tasks: unknown[] }).tasks).toEqual([]);
  });

  test("rename: revision+1, updated_at обновлён, created_at сохранён", async () => {
    const before = await taskRow(taskId);
    expect(before).not.toBeNull();
    await sleep(10);
    const response = await tasksCall({
      method: "PATCH",
      path: `${COLLECTION_PATH}/${taskId}`,
      cookie: uCookie,
      payload: { title: "Переименованная задача" },
    });
    expect(response.status).toBe(200);
    const task = taskOf(response, "task");
    expect(task.title).toBe("Переименованная задача");
    expect(task.revision).toBe(1);
    expect(task.createdAt).toBe(before?.created_at.toISOString());
    expect(task.updatedAt > task.createdAt).toBe(true);
  });

  test("полный no-op: 200 без изменения revision/timestamps", async () => {
    const before = await taskRow(taskId);
    const response = await tasksCall({
      method: "PATCH",
      path: `${COLLECTION_PATH}/${taskId}`,
      cookie: uCookie,
      payload: { title: "Переименованная задача" },
    });
    expect(response.status).toBe(200);
    const task = taskOf(response, "task");
    expect(task.revision).toBe(before?.revision);
    expect(task.updatedAt).toBe(before?.updated_at.toISOString());
    expect((await journalRows(taskId)).length).toBe(0);
  });

  test("combined title+completed: одна revision, один journal, completed_revision = revision до перехода", async () => {
    const before = await taskRow(taskId);
    expect(before?.revision).toBe(1);
    const response = await tasksCall({
      method: "PATCH",
      path: `${COLLECTION_PATH}/${taskId}`,
      cookie: uCookie,
      payload: { title: "Завершённая с новым именем", completed: true },
    });
    expect(response.status).toBe(200);
    const task = taskOf(response, "task");
    expect(task.title).toBe("Завершённая с новым именем");
    expect(task.completedAt).not.toBeNull();
    expect(task.revision).toBe(2);

    const journal = await journalRows(taskId);
    expect(journal.length).toBe(1);
    expect(journal[0].owner_id).toBe(uUserId);
    expect(journal[0].task_id).toBe(taskId);
    expect(journal[0].occurrence_date).toBeNull();
    expect(journal[0].completed_revision).toBe(1);
    expect(isValidUuid(journal[0].idempotency_key)).toBe(true);
    expect(journal[0].completed_at.toISOString()).toBe(task.completedAt);
  });

  test("повтор completed=true: no-op без нового log/revision/timestamp", async () => {
    const before = await taskRow(taskId);
    const response = await tasksCall({
      method: "PATCH",
      path: `${COLLECTION_PATH}/${taskId}`,
      cookie: uCookie,
      payload: { completed: true },
    });
    expect(response.status).toBe(200);
    const task = taskOf(response, "task");
    expect(task.revision).toBe(before?.revision);
    expect(task.completedAt ?? "").toBe(before?.completed_at?.toISOString() ?? "");
    expect((await journalRows(taskId)).length).toBe(1);
  });

  test("конкурентный complete того же открытого task → ровно один log", async () => {
    const fresh = await createViaApi(uCookie, `Конкурент ${run}`);
    const [first, second] = await Promise.allSettled([
      tasksCall({
        method: "PATCH",
        path: `${COLLECTION_PATH}/${fresh.id}`,
        cookie: uCookie,
        payload: { completed: true },
      }),
      tasksCall({
        method: "PATCH",
        path: `${COLLECTION_PATH}/${fresh.id}`,
        cookie: uCookie,
        payload: { completed: true },
      }),
    ]);
    expect(first.status).toBe("fulfilled");
    expect(second.status).toBe("fulfilled");
    if (first.status === "fulfilled") {
      expect(first.value.status).toBe(200);
      expect(taskOf(first.value, "task").completedAt).not.toBeNull();
    }
    if (second.status === "fulfilled") {
      expect(second.value.status).toBe(200);
      expect(taskOf(second.value, "task").completedAt).not.toBeNull();
    }
    const journal = await journalRows(fresh.id);
    expect(journal.length).toBe(1);
    const row = await taskRow(fresh.id);
    expect(row?.revision).toBe(1);
  });

  test("concurrent title+complete разных полей: оба результата сохранены", async () => {
    const fresh = await createViaApi(uCookie, `Оба поля ${run}`);
    const [titleResult, completeResult] = await Promise.allSettled([
      tasksCall({
        method: "PATCH",
        path: `${COLLECTION_PATH}/${fresh.id}`,
        cookie: uCookie,
        payload: { title: `Оба поля ${run} (переименовано)` },
      }),
      tasksCall({
        method: "PATCH",
        path: `${COLLECTION_PATH}/${fresh.id}`,
        cookie: uCookie,
        payload: { completed: true },
      }),
    ]);
    expect(titleResult.status).toBe("fulfilled");
    expect(completeResult.status).toBe("fulfilled");
    const row = await taskRow(fresh.id);
    // Атомарные независимые PATCH: оба поля применены, каждая транзакция +1.
    expect(row?.title).toBe(`Оба поля ${run} (переименовано)`);
    expect(row?.completed_at).not.toBeNull();
    expect(row?.revision).toBe(2);
  });

  test("reopen: completed_at NULL, revision+1, журнал сохранён; повтор reopen no-op", async () => {
    const before = await taskRow(taskId);
    const reopen = await tasksCall({
      method: "PATCH",
      path: `${COLLECTION_PATH}/${taskId}`,
      cookie: uCookie,
      payload: { completed: false },
    });
    expect(reopen.status).toBe(200);
    const task = taskOf(reopen, "task");
    expect(task.completedAt).toBeNull();
    expect(task.revision).toBe((before?.revision ?? 0) + 1);
    expect((await journalRows(taskId)).length).toBe(1);

    const repeat = await tasksCall({
      method: "PATCH",
      path: `${COLLECTION_PATH}/${taskId}`,
      cookie: uCookie,
      payload: { completed: false },
    });
    expect(projectRevision(repeat)).toBe(task.revision);
    expect((await journalRows(taskId)).length).toBe(1);
  });

  test("re-complete после reopen: новый log с новой completed_revision", async () => {
    await sleep(10);
    const response = await tasksCall({
      method: "PATCH",
      path: `${COLLECTION_PATH}/${taskId}`,
      cookie: uCookie,
      payload: { completed: true },
    });
    expect(response.status).toBe(200);
    const journal = await journalRows(taskId);
    expect(journal.length).toBe(2);
    expect(journal[0].completed_revision).not.toBe(journal[1].completed_revision);
  });

  test("fault injection journal INSERT → task/revision/журнал откачены", async () => {
    const fresh = await createViaApi(uCookie, `Fault ${run}`);
    await withAuthDbClient(async (client) => {
      await client.query(`
        CREATE FUNCTION orbit_test_fail_completion_insert() RETURNS trigger LANGUAGE plpgsql AS $$
          BEGIN
            RAISE EXCEPTION 'orbit fault injection: completion insert rejected';
          END;
        $$;
      `);
      await client.query(
        `CREATE TRIGGER orbit_test_fail_completion_trg BEFORE INSERT ON "task_completions" FOR EACH ROW EXECUTE FUNCTION orbit_test_fail_completion_insert()`,
      );
    });
    try {
      const response = await tasksCall({
        method: "PATCH",
        path: `${COLLECTION_PATH}/${fresh.id}`,
        cookie: uCookie,
        payload: { completed: true },
      });
      expect(response.status).toBe(500);
      expect(response.body).toMatchObject({ error: { code: "INTERNAL" } });
      const row = await taskRow(fresh.id);
      expect(row?.completed_at).toBeNull();
      expect(row?.revision).toBe(0);
      expect((await journalRows(fresh.id)).length).toBe(0);
    } finally {
      await withAuthDbClient(async (client) => {
        await client.query(
          `DROP TRIGGER IF EXISTS orbit_test_fail_completion_trg ON "task_completions"`,
        );
        await client.query(
          `DROP FUNCTION IF EXISTS orbit_test_fail_completion_insert()`,
        );
      });
    }
  });
});

function projectRevision(result: ApiResult): number | undefined {
  return taskOf(result, "task").revision;
}

describe("Inbox filters и fixtures (dated/parent/archived/child/recurrence)", () => {
  let projectId = "";
  let archivedProjectId = "";
  let projectTaskId = "";
  let archivedProjectTaskId = "";
  let childTaskId = "";
  let recurrenceTaskId = "";
  let parentTaskId = "";

  beforeAll(async () => {
    // Project fixtures (владелец U) + задачи в них.
    await withAuthDbClient(async (client) => {
      const project = await client.query<{ id: string }>(
        `INSERT INTO "projects" ("owner_id", "name") VALUES ($1, 'Projects fixture') RETURNING "id"`,
        [uUserId],
      );
      projectId = project.rows[0].id;
      const archivedProject = await client.query<{ id: string }>(
        `INSERT INTO "projects" ("owner_id", "name", "archived_at") VALUES ($1, 'Archived project fixture', now()) RETURNING "id"`,
        [uUserId],
      );
      archivedProjectId = archivedProject.rows[0].id;

      const projectTask = await client.query<{ id: string }>(
        `INSERT INTO "tasks" ("owner_id", "project_id", "title") VALUES ($1, $2, 'Project task') RETURNING "id"`,
        [uUserId, projectId],
      );
      projectTaskId = projectTask.rows[0].id;
      const archivedProjectTask = await client.query<{ id: string }>(
        `INSERT INTO "tasks" ("owner_id", "project_id", "title") VALUES ($1, $2, 'Archived project task') RETURNING "id"`,
        [uUserId, archivedProjectId],
      );
      archivedProjectTaskId = archivedProjectTask.rows[0].id;

      const parent = await client.query<{ id: string }>(
        `INSERT INTO "tasks" ("owner_id", "title") VALUES ($1, 'Parent task') RETURNING "id"`,
        [uUserId],
      );
      parentTaskId = parent.rows[0].id;
      const child = await client.query<{ id: string }>(
        `INSERT INTO "tasks" ("owner_id", "parent_id", "title") VALUES ($1, $2, 'Child task') RETURNING "id"`,
        [uUserId, parentTaskId],
      );
      childTaskId = child.rows[0].id;

      // Dated task без сохранения id: проверяется только исключением из Inbox.
      await client.query(
        `INSERT INTO "tasks" ("owner_id", "title", "planned_date") VALUES ($1, 'Dated task', '2026-01-01')`,
        [uUserId],
      );

      const recurrence = await client.query<{ id: string }>(
        `INSERT INTO "tasks" ("owner_id", "title", "planned_date", "recurrence_rule") VALUES ($1, 'Recurring task', '2026-01-01', 'DAILY') RETURNING "id"`,
        [uUserId],
      );
      recurrenceTaskId = recurrence.rows[0].id;
    });
  });

  test("Inbox исключает dated/child/archived-project задачи; project task входит", async () => {
    const response = await tasksCall({ cookie: uCookie, query: "?status=all" });
    expect(response.status).toBe(200);
    const titles = (response.body as { tasks: Array<{ title: string }> }).tasks.map(
      (t) => t.title,
    );
    expect(titles).toContain("Project task");
    expect(titles).not.toContain("Dated task");
    expect(titles).not.toContain("Child task");
    expect(titles).not.toContain("Archived project task");
  });

  test("child и recurrence mutation → 409 UNSUPPORTED_TASK без изменений/журнала", async () => {
    for (const targetId of [childTaskId, recurrenceTaskId]) {
      const patch = await tasksCall({
        method: "PATCH",
        path: `${COLLECTION_PATH}/${targetId}`,
        cookie: uCookie,
        payload: { title: "X" },
      });
      expect(patch.status).toBe(409);
      expect(patch.body).toMatchObject({ error: { code: "UNSUPPORTED_TASK" } });
      const complete = await tasksCall({
        method: "PATCH",
        path: `${COLLECTION_PATH}/${targetId}`,
        cookie: uCookie,
        payload: { completed: true },
      });
      expect(complete.status).toBe(409);
      const remove = await tasksCall({
        method: "DELETE",
        path: `${COLLECTION_PATH}/${targetId}`,
        cookie: uCookie,
      });
      expect(remove.status).toBe(409);
      const journal = await journalRows(targetId);
      expect(journal.length).toBe(0);
    }
  });

  test("задача архивного проекта: mutation → 409 PROJECT_ARCHIVED; restore возвращает доступ", async () => {
    const patch = await tasksCall({
      method: "PATCH",
      path: `${COLLECTION_PATH}/${archivedProjectTaskId}`,
      cookie: uCookie,
      payload: { title: "X" },
    });
    expect(patch.status).toBe(409);
    expect(patch.body).toMatchObject({ error: { code: "PROJECT_ARCHIVED" } });

    // Restore проекта (принятый projects API) возвращает задачу к мутациям.
    const restore = await fetch(
      `${authBaseURL()}/api/v1/projects/${archivedProjectId}`,
      {
        method: "PATCH",
        headers: {
          cookie: uCookie,
          origin: authBaseURL(),
          "content-type": "application/json",
        },
        body: JSON.stringify({ archived: false }),
      },
    );
    expect(restore.status).toBe(200);
    const afterRestore = await tasksCall({
      method: "PATCH",
      path: `${COLLECTION_PATH}/${archivedProjectTaskId}`,
      cookie: uCookie,
      payload: { title: "После restore" },
    });
    expect(afterRestore.status).toBe(200);
    expect(taskOf(afterRestore, "task").title).toBe("После restore");
    // Вернуть проект в архив, чтобы Inbox-фильтры оставались детерминированными.
    const archive = await fetch(
      `${authBaseURL()}/api/v1/projects/${archivedProjectId}`,
      {
        method: "PATCH",
        headers: {
          cookie: uCookie,
          origin: authBaseURL(),
          "content-type": "application/json",
        },
        body: JSON.stringify({ archived: true }),
      },
    );
    expect(archive.status).toBe(200);
  });

  test("row lock проекта сериализует task mutation с конкурентным archive", async () => {
    // Клиент-«архиватор» держит не закоммиченный UPDATE projects; task PATCH
    // обязан блокироваться на row lock проекта и увидеть архив только после
    // коммита (архив не может вклиниться между проверкой и записью).
    const archiver = new (await import("pg")).Client({
      connectionString: authDbConnectionString(),
    });
    await archiver.connect();
    try {
      await archiver.query("BEGIN");
      await archiver.query(
        `UPDATE "projects" SET "archived_at" = now() WHERE "id" = $1`,
        [projectId],
      );

      const patchPromise = tasksCall({
        method: "PATCH",
        path: `${COLLECTION_PATH}/${projectTaskId}`,
        cookie: uCookie,
        payload: { title: "Race patch" },
      });

      // Детерминированное ожидание блокировки: запрос PATCH виден ждущим.
      let blocked = false;
      for (let i = 0; i < 100 && !blocked; i += 1) {
        blocked = await withAuthDbClient(async (client) => {
          const { rows } = await client.query<{ locked: boolean }>(
            `SELECT EXISTS (
               SELECT 1 FROM "pg_stat_activity"
               WHERE "datname" = current_database()
                 AND "pid" <> pg_backend_pid()
                 AND "wait_event_type" = 'Lock'
             ) AS "locked"`,
          );
          return rows[0].locked;
        });
        if (!blocked) {
          await sleep(100);
        }
      }
      expect(blocked).toBe(true);

      await archiver.query("COMMIT");
      const patch = await patchPromise;
      expect(patch.status).toBe(409);
      expect(patch.body).toMatchObject({ error: { code: "PROJECT_ARCHIVED" } });
      const row = await taskRow(projectTaskId);
      expect(row?.title).toBe("Project task");
      expect(row?.revision).toBe(0);
    } finally {
      await archiver.query("ROLLBACK").catch(() => undefined);
      await archiver.end();
    }
    // COMMIT закрепил архив: вернём проект в активное состояние своей
    // зачисткой fixture, после чего mutation успешна.
    await withAuthDbClient(async (client) => {
      await client.query(
        `UPDATE "projects" SET "archived_at" = NULL WHERE "id" = $1`,
        [projectId],
      );
    });
    const patch = await tasksCall({
      method: "PATCH",
      path: `${COLLECTION_PATH}/${projectTaskId}`,
      cookie: uCookie,
      payload: { title: "Race patch после снятия архива" },
    });
    expect(patch.status).toBe(200);
    expect(taskOf(patch, "task").title).toBe("Race patch после снятия архива");
  });
});

describe("DELETE: soft delete с каскадом direct children", () => {
  let parentId = "";
  let activeChildId = "";
  let preDeletedChildId = "";
  let cascadeChildDeletedAt: Date | null = null;

  beforeAll(async () => {
    const parent = await createViaApi(uCookie, `Родитель ${run}`);
    parentId = parent.id;
    await withAuthDbClient(async (client) => {
      const active = await client.query<{ id: string }>(
        `INSERT INTO "tasks" ("owner_id", "parent_id", "title") VALUES ($1, $2, 'Активный ребёнок') RETURNING "id"`,
        [uUserId, parentId],
      );
      activeChildId = active.rows[0].id;
      const preDeleted = await client.query<{ id: string }>(
        `INSERT INTO "tasks" ("owner_id", "parent_id", "title", "deleted_at") VALUES ($1, $2, 'Удалённый ребёнок', now()) RETURNING "id", "deleted_at", "revision"`,
        [uUserId, parentId],
      );
      preDeletedChildId = preDeleted.rows[0].id;
    });
  });

  test("родитель complete не завершает ребёнка", async () => {
    const complete = await tasksCall({
      method: "PATCH",
      path: `${COLLECTION_PATH}/${parentId}`,
      cookie: uCookie,
      payload: { completed: true },
    });
    expect(complete.status).toBe(200);
    const child = await taskRow(activeChildId);
    expect(child?.completed_at).toBeNull();
    // Вернуть родителю открытый статус перед delete-сценарием.
    const reopen = await tasksCall({
      method: "PATCH",
      path: `${COLLECTION_PATH}/${parentId}`,
      cookie: uCookie,
      payload: { completed: false },
    });
    expect(reopen.status).toBe(200);
  });

  test("DELETE root: 204, root+активный child одним timestamp с revision+1, pre-deleted child нетронут", async () => {
    const activeChildBefore = await taskRow(activeChildId);
    const preDeletedBefore = await taskRow(preDeletedChildId);
    // Завершаем root, чтобы проверить: delete сохраняет completed_at/журнал.
    await tasksCall({
      method: "PATCH",
      path: `${COLLECTION_PATH}/${parentId}`,
      cookie: uCookie,
      payload: { completed: true },
    });
    const rootBefore = await taskRow(parentId);
    const journalBefore = await journalRows(parentId);
    // complete → reopen → повторный complete: по журналу на каждый переход.
    expect(journalBefore.length).toBeGreaterThanOrEqual(2);

    await sleep(10);
    const response = await tasksCall({
      method: "DELETE",
      path: `${COLLECTION_PATH}/${parentId}`,
      cookie: uCookie,
    });
    expect(response.status).toBe(204);
    expect(response.cacheControl).toBe("private, no-store");

    const root = await taskRow(parentId);
    expect(root?.deleted_at).not.toBeNull();
    expect(root?.revision).toBe((rootBefore?.revision ?? 0) + 1);
    expect(root?.completed_at?.toISOString()).toBe(
      rootBefore?.completed_at?.toISOString(),
    );
    const activeChild = await taskRow(activeChildId);
    expect(activeChild?.deleted_at).not.toBeNull();
    // Один timestamp у root и нового удалённого child.
    expect(activeChild?.deleted_at?.getTime()).toBe(
      root?.deleted_at?.getTime(),
    );
    expect(activeChild?.revision).toBe(
      (activeChildBefore?.revision ?? 0) + 1,
    );
    cascadeChildDeletedAt = activeChild?.deleted_at ?? null;
    const preDeleted = await taskRow(preDeletedChildId);
    expect(preDeleted).toEqual(preDeletedBefore);
    expect((await journalRows(parentId)).length).toBe(journalBefore.length);
  });

  test("deleted task: 404 на GET/PATCH, отсутствует во всех списках; повтор DELETE → 204 no-op", async () => {
    const get = await tasksCall({
      path: `${COLLECTION_PATH}/${parentId}`,
      cookie: uCookie,
    });
    expect(get.status).toBe(404);
    const patch = await tasksCall({
      method: "PATCH",
      path: `${COLLECTION_PATH}/${parentId}`,
      cookie: uCookie,
      payload: { title: "X" },
    });
    expect(patch.status).toBe(404);
    for (const status of ["open", "completed", "all"]) {
      const list = await tasksCall({ cookie: uCookie, query: `?status=${status}` });
      const titles = (list.body as { tasks: Array<{ title: string }> }).tasks.map(
        (t) => t.title,
      );
      expect(titles).not.toContain(`Родитель ${run}`);
    }

    const rootBefore = await taskRow(parentId);
    const repeat = await tasksCall({
      method: "DELETE",
      path: `${COLLECTION_PATH}/${parentId}`,
      cookie: uCookie,
    });
    expect(repeat.status).toBe(204);
    const rootAfter = await taskRow(parentId);
    expect(rootAfter?.deleted_at?.getTime()).toBe(
      rootBefore?.deleted_at?.getTime(),
    );
    expect(rootAfter?.revision).toBe(rootBefore?.revision);
  });

  test("DELETE errors: body → 400, oversize → 413, query → 400, foreign → 404", async () => {
    const withBody = await tasksCall({
      method: "DELETE",
      path: `${COLLECTION_PATH}/${activeChildId}`,
      cookie: uCookie,
      rawBody: "{}",
    });
    expect(withBody.status).toBe(400);
    const oversize = await tasksCall({
      method: "DELETE",
      path: `${COLLECTION_PATH}/${activeChildId}`,
      cookie: uCookie,
      rawBody: "x".repeat(3000),
    });
    expect(oversize.status).toBe(413);
    const withQuery = await tasksCall({
      method: "DELETE",
      path: `${COLLECTION_PATH}/${activeChildId}`,
      cookie: uCookie,
      query: "?force=1",
    });
    expect(withQuery.status).toBe(400);
    const foreign = await tasksCall({
      method: "DELETE",
      path: `${COLLECTION_PATH}/${activeChildId}`,
      cookie: vCookie,
    });
    expect(foreign.status).toBe(404);
    const anonymous = await tasksCall({
      method: "DELETE",
      path: `${COLLECTION_PATH}/${activeChildId}`,
    });
    expect(anonymous.status).toBe(401);
    // Ни один ошибочный DELETE ничего не удалил.
    // Child уже скрыт каскадом удаления root: ошибочные DELETE не изменили
    // его deleted_at.
    const child = await taskRow(activeChildId);
    expect(child?.deleted_at?.getTime()).toBe(
      cascadeChildDeletedAt?.getTime(),
    );
  });
});

describe("owner isolation и revoked session", () => {
  test("V не видит и не мутирует задачи U", async () => {
    const uTasks = await tasksCall({ cookie: uCookie, query: "?status=all" });
    const list = (uTasks.body as { tasks: TaskDTO[] }).tasks;
    expect(list.length).toBeGreaterThan(0);
    const target = list[0];
    const vGet = await tasksCall({
      path: `${COLLECTION_PATH}/${target.id}`,
      cookie: vCookie,
    });
    expect(vGet.status).toBe(404);
    const vPatch = await tasksCall({
      method: "PATCH",
      path: `${COLLECTION_PATH}/${target.id}`,
      cookie: vCookie,
      payload: { title: "Взлом" },
    });
    expect(vPatch.status).toBe(404);
    const vDelete = await tasksCall({
      method: "DELETE",
      path: `${COLLECTION_PATH}/${target.id}`,
      cookie: vCookie,
    });
    expect(vDelete.status).toBe(404);
    const uAfter = await tasksCall({
      path: `${COLLECTION_PATH}/${target.id}`,
      cookie: uCookie,
    });
    expect(uAfter.status).toBe(200);
    expect(taskOf(uAfter, "task").title).toBe(target.title);
  });

  test("revoked session: 401 без мутаций", async () => {
    const signOut = await fetch(`${authBaseURL()}/api/auth/sign-out`, {
      method: "POST",
      headers: {
        cookie: uCookie,
        origin: authBaseURL(),
        "content-type": "application/json",
      },
      body: JSON.stringify({}),
    });
    expect(signOut.status).toBe(200);

    const list = await tasksCall({ cookie: uCookie });
    expect(list.status).toBe(401);
    const before = await countTasks(uUserId);
    const create = await tasksCall({
      method: "POST",
      cookie: uCookie,
      payload: { title: "После выхода" },
    });
    expect(create.status).toBe(401);
    expect(await countTasks(uUserId)).toBe(before);
  });
});
