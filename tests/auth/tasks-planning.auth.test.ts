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
 * HTTP/PostgreSQL integration planning (TASK-008) на production Next
 * handler: atomic planning merge, view/status/start/context, 4KiB limit,
 * timezone context, fault/concurrency regressions. Фикстуры — отдельные
 * синтетические пользователи U/V этого запуска; даты строятся от
 * context.today (никакой привязки к часам машины).
 */

const COLLECTION_PATH = "/api/v1/tasks";

const run = randomUUID();
const uEmail = `plan-u-${run}@orbit.test`;
const vEmail = `plan-v-${run}@orbit.test`;
const fixturePassword = randomBytes(12).toString("hex");

let uUserId = "";
let vUserId = "";
let uCookie = "";
let vCookie = "";

type ApiResult = { status: number; body: unknown; cacheControl: string | null };

type RequestOptions = {
  cookie?: string;
  origin?: string | null;
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
  if (opts.origin !== null) {
    headers.origin = opts.origin ?? authBaseURL();
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

async function patchTask(
  cookie: string,
  taskId: string,
  payload: Record<string, unknown>,
): Promise<ApiResult> {
  return tasksCall({
    method: "PATCH",
    cookie,
    path: `${COLLECTION_PATH}/${taskId}`,
    payload,
  });
}

type TaskDTO = {
  id: string;
  title: string;
  plannedDate: string | null;
  plannedTime: string | null;
  deadlineDate: string | null;
  completedAt: string | null;
  revision: number;
};

function taskOf(result: ApiResult, key: "task" | "tasks"): TaskDTO {
  expect(result.body).toBeInstanceOf(Object);
  const container = (result.body as Record<string, unknown>)[key];
  expect(container).toBeTruthy();
  return (Array.isArray(container) ? container[0] : container) as TaskDTO;
}

type ContextPayload = {
  timezone: string;
  today: string;
  asOf: string;
  view: string;
  startDate?: string;
  endDate?: string;
};

function contextOf(result: ApiResult): ContextPayload {
  return (result.body as { context: ContextPayload }).context;
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

async function taskRaw(taskId: string): Promise<{
  title: string;
  planned_date: string | null;
  planned_time: string | null;
  deadline_date: string | null;
  completed_at: Date | null;
  deleted_at: Date | null;
  revision: number;
  updated_at: Date;
} | null> {
  return withAuthDbClient(async (client) => {
    const { rows } = await client.query<{
      title: string;
      planned_date: string | null;
      planned_time: string | null;
      deadline_date: string | null;
      completed_at: Date | null;
      deleted_at: Date | null;
      revision: number;
      updated_at: Date;
    }>(
      `SELECT "title", "planned_date"::text AS "planned_date", "planned_time"::text AS "planned_time", "deadline_date"::text AS "deadline_date", "completed_at", "deleted_at", "revision", "updated_at" FROM "tasks" WHERE "id" = $1`,
      [taskId],
    );
    return rows[0] ?? null;
  });
}

async function createTask(
  cookie: string,
  payload: Record<string, unknown>,
): Promise<TaskDTO> {
  const response = await tasksCall({ method: "POST", cookie, payload });
  expect(response.status).toBe(201);
  return taskOf(response, "task");
}

beforeAll(async () => {
  const u = await provisionLocalUser(authDbConnectionString(), {
    email: uEmail,
    password: fixturePassword,
    name: "Planning U",
  });
  uUserId = u.userId;
  const v = await provisionLocalUser(authDbConnectionString(), {
    email: vEmail,
    password: fixturePassword,
    name: "Planning V",
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
});

describe("create с planning fields и 4KiB", () => {
  test("title-only: defaults planning NULL (прежний Inbox create)", async () => {
    const task = await createTask(uCookie, { title: "Title only" });
    expect(task.plannedDate).toBeNull();
    expect(task.plannedTime).toBeNull();
    expect(task.deadlineDate).toBeNull();
    expect(task.revision).toBe(0);
  });

  test("create с датой/временем/дедлайном: DTO и DB точность", async () => {
    const task = await createTask(uCookie, {
      title: "С датами",
      plannedDate: "2026-03-05",
      plannedTime: "09:30",
      deadlineDate: "2026-03-10",
    });
    expect(task.plannedDate).toBe("2026-03-05");
    expect(task.plannedTime).toBe("09:30");
    expect(task.deadlineDate).toBe("2026-03-10");
    const raw = await taskRaw(task.id);
    expect(raw?.planned_date).toBe("2026-03-05");
    // TIME колонка хранит секунды, DTO/API нормализует до HH:mm.
    expect(raw?.planned_time?.startsWith("09:30")).toBe(true);
    expect(raw?.deadline_date).toBe("2026-03-10");
  });

  test("time без date → 400 field=plannedTime; невалидные даты → 400 без записи", async () => {
    const before = await countTasks(uUserId);
    const timeOnly = await tasksCall({
      method: "POST",
      cookie: uCookie,
      payload: { title: "Time only", plannedTime: "10:00" },
    });
    expect(timeOnly.status).toBe(400);
    expect(timeOnly.body).toMatchObject({
      error: { code: "VALIDATION_ERROR", field: "plannedTime" },
    });
    for (const payload of [
      { title: "X", plannedDate: "2026-02-30" },
      { title: "X", plannedDate: "2026-02-29" }, // 2026 не leap
      { title: "X", plannedDate: "1899-12-31" },
      { title: "X", deadlineDate: "2200-01-01" },
      { title: "X", plannedTime: "24:00", plannedDate: "2026-01-01" },
      { title: "X", plannedTime: "10:00:00", plannedDate: "2026-01-01" },
      { title: "X", plannedDate: " 2026-01-01" },
      { title: "X", plannedDate: 20260101 },
    ]) {
      const response = await tasksCall({
        method: "POST",
        cookie: uCookie,
        payload,
      });
      expect(response.status, JSON.stringify(payload)).toBe(400);
    }
    expect(await countTasks(uUserId)).toBe(before);
  });

  test("500 emoji title + schedule поля помещаются в 4KiB; >4KiB → 413", async () => {
    const longTitle = "🦄".repeat(500);
    const ok = await tasksCall({
      method: "POST",
      cookie: uCookie,
      payload: {
        title: longTitle,
        plannedDate: "2026-06-01",
        plannedTime: "08:00",
        deadlineDate: "2026-06-30",
      },
    });
    expect(ok.status).toBe(201);
    expect(taskOf(ok, "task").title).toBe(longTitle);
    expect(ok.body as unknown).toBeDefined();
    const rawJson = JSON.stringify({
      title: longTitle,
      plannedDate: "2026-06-01",
      plannedTime: "08:00",
      deadlineDate: "2026-06-30",
    });
    // JSON с 500 emoji (~4 байта UTF-8) + schedule помещается в 4 KiB.
    expect(Buffer.byteLength(rawJson, "utf8")).toBeLessThanOrEqual(4096);

    const oversize = await tasksCall({
      method: "POST",
      cookie: uCookie,
      rawBody: `{"title":"${"a".repeat(5000)}"}`,
    });
    expect(oversize.status).toBe(413);
  });

  test("неизвестные planning-смежные поля (snake_case/priority/notes) → 400", async () => {
    for (const payload of [
      { title: "X", project_id: null },
      { title: "X", priority: 1 },
      { title: "X", notes: "" },
      { title: "X", recurrence_rule: "DAILY" },
      { title: "X", planned_time: "10:00" },
      { title: "X", deadline_date: "2026-01-01" },
    ]) {
      const response = await tasksCall({
        method: "POST",
        cookie: uCookie,
        payload,
      });
      expect(response.status, JSON.stringify(payload)).toBe(400);
    }
  });
});

describe("context: timezone/today/asOf", () => {
  test("default UTC без settings INSERT; asOf — один instant; view/range", async () => {
    const response = await tasksCall({
      cookie: vCookie,
      query: "?view=upcoming",
    });
    expect(response.status).toBe(200);
    const context = contextOf(response);
    expect(context.timezone).toBe("UTC");
    expect(context.view).toBe("upcoming");
    expect(context.startDate).toBe(context.today);
    expect(context.endDate).not.toBeUndefined();
    // start+6 = endDate (civil).
    const [y, m, d] = (context.startDate ?? "").split("-").map(Number);
    const end = new Date(Date.UTC(y, m - 1, d + 6));
    expect(context.endDate).toBe(end.toISOString().slice(0, 10));
    expect(/^\d{4}-\d{2}-\d{2}T/.test(context.asOf)).toBe(true);
    // settings row не создан чтением.
    const settingsCount = await withAuthDbClient(async (client) => {
      const { rows } = await client.query<{ count: string }>(
        `SELECT count(*)::text AS "count" FROM "user_settings" WHERE "user_id" = $1`,
        [vUserId],
      );
      return Number(rows[0].count);
    });
    expect(settingsCount).toBe(0);
  });

  test("timezone от saved account settings; смена tz переписывает только today/context", async () => {
    // R6: прежняя зона фиксируется через GET и восстанавливается в finally
    // (точный 200 + GET-подтверждение); никакой привязки к времени суток.
    const initialSettings = await fetch(`${authBaseURL()}/api/v1/settings`, {
      method: "GET",
      headers: { cookie: uCookie },
    });
    expect(initialSettings.status).toBe(200);
    const initialZone = (
      (await initialSettings.json()) as { settings: { timezone: string } }
    ).settings.timezone;

    // Локальная дата собственного asOf в заданной зоне.
    const localDate = (asOf: string, zone: string): string =>
      new Intl.DateTimeFormat("en-CA", {
        timeZone: zone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date(asOf));

    // Задача с фиксированным планом; неизменность полей проверяем через
    // GET item до/после, не через попадание в Today.
    const task = await createTask(uCookie, {
      title: "TZ task",
      plannedDate: "2026-06-10",
    });
    const beforeItem = taskOf(
      await tasksCall({
        cookie: uCookie,
        path: `${COLLECTION_PATH}/${task.id}`,
      }),
      "task",
    );

    const before = await tasksCall({
      cookie: uCookie,
      query: "?view=today&status=all",
    });
    expect(before.status).toBe(200);
    const beforeContext = contextOf(before);
    expect(beforeContext.timezone).toBe(initialZone);
    expect(beforeContext.today).toBe(
      localDate(beforeContext.asOf, initialZone),
    );

    try {
      // Смена зоны: правильный Origin, точный 200 + GET-подтверждение.
      const settingsPatch = await fetch(`${authBaseURL()}/api/v1/settings`, {
        method: "PATCH",
        headers: {
          cookie: uCookie,
          origin: authBaseURL(),
          "content-type": "application/json",
        },
        body: JSON.stringify({ timezone: "Europe/Moscow" }),
      });
      expect(settingsPatch.status).toBe(200);
      const confirmPatch = await fetch(`${authBaseURL()}/api/v1/settings`, {
        method: "GET",
        headers: { cookie: uCookie },
      });
      expect(confirmPatch.status).toBe(200);
      expect(
        (
          (await confirmPatch.json()) as { settings: { timezone: string } }
        ).settings.timezone,
      ).toBe("Europe/Moscow");

      const after = await tasksCall({
        cookie: uCookie,
        query: "?view=today&status=all",
      });
      expect(after.status).toBe(200);
      const afterContext = contextOf(after);
      // R6: today сравнивается с local date СОБСТВЕННОГО asOf в зоне
      // ответа — без предположения, что UTC today и Moscow today
      // обязательно различны.
      expect(afterContext.timezone).toBe("Europe/Moscow");
      expect(afterContext.today).toBe(
        localDate(afterContext.asOf, "Europe/Moscow"),
      );

      // Сохранённые поля задачи не переписаны сменой timezone (GET item).
      const afterItem = taskOf(
        await tasksCall({
          cookie: uCookie,
          path: `${COLLECTION_PATH}/${task.id}`,
        }),
        "task",
      );
      expect(afterItem.title).toBe(beforeItem.title);
      expect(afterItem.plannedDate).toBe(beforeItem.plannedDate);
      expect(afterItem.plannedTime).toBe(beforeItem.plannedTime);
      expect(afterItem.deadlineDate).toBe(beforeItem.deadlineDate);
    } finally {
      // Восстановление прежней зоны: точный 200 + GET-подтверждение.
      const restore = await fetch(`${authBaseURL()}/api/v1/settings`, {
        method: "PATCH",
        headers: {
          cookie: uCookie,
          origin: authBaseURL(),
          "content-type": "application/json",
        },
        body: JSON.stringify({ timezone: initialZone }),
      });
      expect(restore.status).toBe(200);
      const confirmRestore = await fetch(`${authBaseURL()}/api/v1/settings`, {
        method: "GET",
        headers: { cookie: uCookie },
      });
      expect(confirmRestore.status).toBe(200);
      expect(
        (
          (await confirmRestore.json()) as { settings: { timezone: string } }
        ).settings.timezone,
      ).toBe(initialZone);
    }
  });

  test("client timezone/today/owner overrides не принимаются", async () => {
    const response = await tasksCall({
      cookie: uCookie,
      query: "?view=today&timezone=Asia/Tokyo&today=2030-01-01",
    });
    // timezone/today — неизвестные keys → 400.
    expect(response.status).toBe(400);
  });
});

describe("R7: Today raw API ordering", () => {
  test("raw GET view=today: ranks/within-rank как в UI-контракте, тот же порядок в open/completed/all", async () => {
    const context = contextOf(
      await tasksCall({ cookie: uCookie, query: "?view=today&status=all" }),
    );
    const today = context.today;
    const past = (days: number): string => shift(today, -days);
    const future = (days: number): string => shift(today, days);

    // Перемешанный порядок создания = базовый sort_order (стабильный
    // tie-break контролируем собственными fixture rows).
    const specs: Record<string, Record<string, unknown>> = {
      p4: { title: "R7 p4", plannedDate: past(1), plannedTime: "09:00", deadlineDate: future(5) },
      e2: { title: "R7 e2", plannedDate: null, plannedTime: null, deadlineDate: today },
      p1: { title: "R7 p1", plannedDate: past(2), plannedTime: "09:00", deadlineDate: null },
      d2: { title: "R7 d2", plannedDate: future(30), plannedTime: null, deadlineDate: past(1) },
      p7: { title: "R7 p7", plannedDate: today, plannedTime: "09:00", deadlineDate: null },
      p5: { title: "R7 p5", plannedDate: past(3), plannedTime: null, deadlineDate: null },
      e1: { title: "R7 e1", plannedDate: null, plannedTime: null, deadlineDate: today },
      p8: { title: "R7 p8", plannedDate: today, plannedTime: "10:00", deadlineDate: null },
      d3: { title: "R7 d3", plannedDate: null, plannedTime: null, deadlineDate: past(2) },
      p2: { title: "R7 p2", plannedDate: past(2), plannedTime: null, deadlineDate: null },
      d1: { title: "R7 d1", plannedDate: null, plannedTime: null, deadlineDate: past(2) },
      p6: { title: "R7 p6", plannedDate: today, plannedTime: null, deadlineDate: null },
      p3: { title: "R7 p3", plannedDate: past(1), plannedTime: "10:00", deadlineDate: null },
    };
    const created: Record<string, TaskDTO> = {};
    for (const [key, payload] of Object.entries(specs)) {
      created[key] = await createTask(uCookie, payload);
    }
    // Чужая задача не проникает в Today пользователя U.
    const foreign = await createTask(vCookie, {
      title: "R7 foreign",
      plannedDate: today,
    });

    // rank1 plannedDate ASC + time NULLS LAST; rank2 time NULLS LAST;
    // rank3 deadline ASC со стабильным tie по созданию (d3 раньше d1);
    // rank4 stable по созданию (e2 раньше e1). Без дублей.
    const expectedOrder = [
      created.p5.id,
      created.p1.id,
      created.p2.id,
      created.p4.id,
      created.p3.id,
      created.p7.id,
      created.p8.id,
      created.p6.id,
      created.d3.id,
      created.d1.id,
      created.d2.id,
      created.e2.id,
      created.e1.id,
    ];
    expect(new Set(expectedOrder).size).toBe(expectedOrder.length);

    const idsOf = (result: ApiResult): string[] =>
      (result.body as { tasks: TaskDTO[] }).tasks.map((task) => task.id);
    // Скоуп assertions на свои fixture ids (чужие строки других тестов
    // этого файла не влияют на относительный порядок).
    const subset = (ids: string[]): string[] =>
      ids.filter((id) => expectedOrder.includes(id));

    const open = await tasksCall({
      cookie: uCookie,
      query: "?view=today&status=open",
    });
    expect(open.status).toBe(200);
    const openIds = idsOf(open);
    expect(subset(openIds)).toEqual(expectedOrder);
    expect(openIds).not.toContain(foreign.id);

    // Завершаем все fixtures: completed/all используют тот же порядок.
    for (const task of Object.values(created)) {
      const patched = await tasksCall({
        method: "PATCH",
        cookie: uCookie,
        path: `${COLLECTION_PATH}/${task.id}`,
        payload: { completed: true },
      });
      expect(patched.status).toBe(200);
    }
    for (const status of ["completed", "all"] as const) {
      const result = await tasksCall({
        cookie: uCookie,
        query: `?view=today&status=${status}`,
      });
      expect(result.status).toBe(200);
      expect(subset(idsOf(result))).toEqual(expectedOrder);
    }
  });
});

describe("view/status/start query", () => {
  test("start в не-upcoming view/duplicate/unknown → 400", async () => {
    for (const query of [
      "?view=inbox&start=2026-06-15",
      "?view=today&start=2026-06-15",
      "?view=upcoming&start=2026-06-15&start=2026-06-16",
      "?view=upcoming&start=not-a-date",
      "?view=upcoming&start=1899-12-31",
      "?view=upcoming&start=2199-12-31",
      "?view=bogus",
      "?status=bogus",
      "?foo=1",
    ]) {
      const response = await tasksCall({ cookie: uCookie, query });
      expect(response.status, query).toBe(400);
    }
  });

  test("view=upcoming status=open/completed фильтруют по completed_at", async () => {
    // Планируемая задача в окне [context.today..+6]: создаётся от server today.
    const contextResponse = await tasksCall({ cookie: uCookie });
    const today = contextOf(contextResponse).today;
    const completed = await createTask(uCookie, {
      title: `Completed planned ${run}`,
      plannedDate: today,
    });
    const patch = await patchTask(uCookie, completed.id, { completed: true });
    expect(patch.status).toBe(200);
    const open = await tasksCall({
      cookie: uCookie,
      query: `?view=upcoming&status=open&start=${today}`,
    });
    const openTitles = (open.body as { tasks: TaskDTO[] }).tasks.map(
      (t) => t.title,
    );
    expect(openTitles).not.toContain(`Completed planned ${run}`);
    const completedList = await tasksCall({
      cookie: uCookie,
      query: `?view=upcoming&status=completed&start=${today}`,
    });
    const completedTitles = (completedList.body as { tasks: TaskDTO[] }).tasks.map(
      (t) => t.title,
    );
    expect(completedTitles).toContain(`Completed planned ${run}`);
  });
});

describe("PATCH atomic planning merge", () => {
  let taskId = "";

  beforeAll(async () => {
    taskId = (await createTask(uCookie, { title: "Merge target" })).id;
  });

  test("set plannedDate → revision+1, time остаётся NULL", async () => {
    const response = await patchTask(uCookie, taskId, {
      plannedDate: "2026-07-01",
    });
    expect(response.status).toBe(200);
    const task = taskOf(response, "task");
    expect(task.plannedDate).toBe("2026-07-01");
    expect(task.plannedTime).toBeNull();
    expect(task.revision).toBe(1);
  });

  test("set time only при существующей date → ok", async () => {
    const response = await patchTask(uCookie, taskId, {
      plannedTime: "08:15",
    });
    expect(response.status).toBe(200);
    const task = taskOf(response, "task");
    expect(task.plannedDate).toBe("2026-07-01");
    expect(task.plannedTime).toBe("08:15");
    expect(task.revision).toBe(2);
  });

  test("time only при date=NULL → 400 field=plannedTime без записи", async () => {
    const fresh = await createTask(uCookie, { title: "No date" });
    const response = await patchTask(uCookie, fresh.id, {
      plannedTime: "09:00",
    });
    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({
      error: { code: "VALIDATION_ERROR", field: "plannedTime" },
    });
    const raw = await taskRaw(fresh.id);
    expect(raw?.planned_time).toBeNull();
    expect(raw?.revision).toBe(0);
  });

  test("clearing plannedDate автоматически clears time; deadline сохраняется", async () => {
    const before = await taskRaw(taskId);
    expect(before?.planned_date).toBe("2026-07-01");
    expect(before?.planned_time?.startsWith("08:15")).toBe(true);
    const deadlinePatch = await patchTask(uCookie, taskId, {
      deadlineDate: "2026-08-01",
    });
    expect(deadlinePatch.status).toBe(200);
    const response = await patchTask(uCookie, taskId, {
      plannedDate: null,
    });
    expect(response.status).toBe(200);
    const task = taskOf(response, "task");
    expect(task.plannedDate).toBeNull();
    expect(task.plannedTime).toBeNull();
    expect(task.deadlineDate).toBe("2026-08-01");
    // Два реальных изменения от before (deadline +1, очистка plan+time +1).
    expect(task.revision).toBe((before?.revision ?? 0) + 2);
  });

  test("explicit plannedDate:null + ненулевой time → 400; plan/time не изменены", async () => {
    // Восстанавливаем plan+time, затем пытаемся очистить план с time.
    await patchTask(uCookie, taskId, {
      plannedDate: "2026-07-05",
      plannedTime: "10:00",
    });
    const response = await patchTask(uCookie, taskId, {
      plannedDate: null,
      plannedTime: "11:00",
    });
    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({
      error: { code: "VALIDATION_ERROR", field: "plannedTime" },
    });
    const raw = await taskRaw(taskId);
    expect(raw?.planned_date).toBe("2026-07-05");
    expect(raw?.planned_time?.startsWith("10:00")).toBe(true);
  });

  test("no-op planning PATCH: revision/timestamps не меняются (HH:mm vs HH:mm:00)", async () => {
    const before = await taskRaw(taskId);
    expect(before?.planned_time?.startsWith("10:00")).toBe(true);
    const api = await tasksCall({
      path: `${COLLECTION_PATH}/${taskId}`,
      cookie: uCookie,
    });
    const dto = taskOf(api, "task");
    const response = await patchTask(uCookie, taskId, {
      plannedDate: "2026-07-05",
      plannedTime: "10:00",
    });
    expect(response.status).toBe(200);
    const after = taskOf(response, "task");
    expect(after.revision).toBe(dto.revision);
    // No-op: DB timestamps не изменились (raw Date сравнение).
    const rawAfter = await taskRaw(taskId);
    expect(rawAfter?.updated_at.getTime()).toBe(before?.updated_at.getTime());
    expect(after.plannedTime).toBe("10:00");
  });

  test("combined title+plannedDate+deadline: одна revision; deadline не сдвигается сменой плана", async () => {
    const before = await taskRaw(taskId);
    const deadlineBefore = before?.deadline_date;
    const response = await patchTask(uCookie, taskId, {
      title: "Merge combined",
      plannedDate: "2026-07-10",
      deadlineDate: "2026-07-01",
    });
    expect(response.status).toBe(200);
    const task = taskOf(response, "task");
    expect(task.title).toBe("Merge combined");
    expect(task.plannedDate).toBe("2026-07-10");
    expect(task.deadlineDate).toBe("2026-07-01");
    expect(task.revision).toBe((before?.revision ?? 0) + 1);
    // Earlier deadline than planned разрешён и не автосдвигается.
    expect((task.deadlineDate ?? "") < (task.plannedDate ?? "")).toBe(true);
    if (deadlineBefore !== null) {
      // Дедлайн изменился только потому, что явно передан в этом PATCH.
      expect(task.deadlineDate).toBe("2026-07-01");
    }
  });

  test("очистка плана не трогает deadline (независимость)", async () => {
    const response = await patchTask(uCookie, taskId, {
      plannedDate: null,
      plannedTime: null,
    });
    expect(response.status).toBe(200);
    const task = taskOf(response, "task");
    expect(task.plannedDate).toBeNull();
    expect(task.plannedTime).toBeNull();
    expect(task.deadlineDate).toBe("2026-07-01");
  });

  test("concurrent schedule vs title: оба сохранены; schedule vs complete: оба сохранены", async () => {
    const fresh = await createTask(uCookie, { title: "Concurrent plan" });
    const [titleResult, scheduleResult] = await Promise.allSettled([
      patchTask(uCookie, fresh.id, { title: "Concurrent plan (renamed)" }),
      patchTask(uCookie, fresh.id, { plannedDate: "2026-09-01" }),
    ]);
    expect(titleResult.status).toBe("fulfilled");
    expect(scheduleResult.status).toBe("fulfilled");
    let row = await taskRaw(fresh.id);
    expect(row?.title).toBe("Concurrent plan (renamed)");
    expect(row?.planned_date).toBe("2026-09-01");

    const [completeResult, schedule2] = await Promise.allSettled([
      patchTask(uCookie, fresh.id, { completed: true }),
      patchTask(uCookie, fresh.id, { plannedDate: "2026-09-02" }),
    ]);
    expect(completeResult.status).toBe("fulfilled");
    expect(schedule2.status).toBe("fulfilled");
    row = await taskRaw(fresh.id);
    expect(row?.completed_at).not.toBeNull();
    expect(row?.planned_date).toBe("2026-09-02");
  });

  test("невалидный merge не меняет task/journal", async () => {
    const journalBefore = await journalCount(taskId);
    const response = await patchTask(uCookie, taskId, {
      plannedDate: null,
      plannedTime: "12:00",
    });
    expect(response.status).toBe(400);
    const raw = await taskRaw(taskId);
    expect(raw?.planned_date).toBeNull();
    expect(await journalCount(taskId)).toBe(journalBefore);
  });
});

describe("Today/Upcoming view fixtures", () => {

  test("полная матрица planned×deadline, один ID на секцию, no duplicates", async () => {
    const contextResponse = await tasksCall({ cookie: uCookie });
    const today = contextOf(contextResponse).today;
    const dayBefore = shift(today, -1);
    const dayAfter = shift(today, 1);

    const created: Array<{ id: string; planned: string | null; deadline: string | null }> = [];
    async function fixture(
      planned: string | null,
      deadline: string | null,
    ): Promise<void> {
      const payload: Record<string, unknown> = { title: `Fix ${randomUUID()}` };
      if (planned !== null) {
        payload.plannedDate = planned;
      }
      if (deadline !== null) {
        payload.deadlineDate = deadline;
      }
      const task = await createTask(uCookie, payload);
      created.push({ id: task.id, planned, deadline });
    }

    // Матрица plan (past/today/future/null) × deadline (past/today/future/null).
    for (const planned of [dayBefore, today, dayAfter, null]) {
      for (const deadline of [dayBefore, today, dayAfter, null]) {
        await fixture(planned, deadline);
      }
    }

    // Today: union по плану/дедлайну; считаем ожидаемые секции по контракту.
    const todayResponse = await tasksCall({
      cookie: uCookie,
      query: "?view=today&status=all",
    });
    expect(todayResponse.status).toBe(200);
    const todayTasks = (todayResponse.body as { tasks: TaskDTO[] }).tasks;
    const ids = todayTasks.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);

    const sectionOf = (t: {
      plannedDate: string | null;
      deadlineDate: string | null;
    }): 1 | 2 | 3 | 4 | null => {
      if (t.plannedDate !== null && t.plannedDate < today) return 1;
      if (t.plannedDate !== null && t.plannedDate === today) return 2;
      if (t.deadlineDate !== null && t.deadlineDate < today) return 3;
      if (t.deadlineDate !== null && t.deadlineDate === today) return 4;
      return null;
    };
    for (const fixtureTask of created) {
      const expected = sectionOf({
        plannedDate: fixtureTask.planned,
        deadlineDate: fixtureTask.deadline,
      });
      const inToday = ids.includes(fixtureTask.id);
      expect(inToday, JSON.stringify(fixtureTask)).toBe(expected !== null);
    }
    // Все включённые в Today распределены по 4 секциям контракта.
    const todayResponseOpen = await tasksCall({
      cookie: uCookie,
      query: "?view=today&status=open",
    });
    const openTasks = (todayResponseOpen.body as { tasks: TaskDTO[] }).tasks;
    for (const t of openTasks) {
      expect(sectionOf(t)).not.toBeNull();
    }
  });

  test("Upcoming: start/end включительно, вне диапазона исключены, диапазон 7 дней", async () => {
    const contextResponse = await tasksCall({ cookie: uCookie });
    const apiToday = contextOf(contextResponse).today;
    const start = shift(apiToday, 2);
    const inside1 = await createTask(uCookie, {
      title: `Up start ${randomUUID()}`,
      plannedDate: start,
    });
    const insideEnd = shift(start, 6);
    const insideEndTask = await createTask(uCookie, {
      title: `Up end ${randomUUID()}`,
      plannedDate: insideEnd,
    });
    const outside = await createTask(uCookie, {
      title: `Up outside ${randomUUID()}`,
      plannedDate: shift(start, 7),
    });
    const response = await tasksCall({
      cookie: uCookie,
      query: `?view=upcoming&status=all&start=${start}`,
    });
    expect(response.status).toBe(200);
    const context = contextOf(response);
    expect(context.startDate).toBe(start);
    expect(context.endDate).toBe(insideEnd);
    const titles = (response.body as { tasks: TaskDTO[] }).tasks.map(
      (t) => t.title,
    );
    expect(titles).toContain(inside1.title);
    expect(titles).toContain(insideEndTask.title);
    expect(titles).not.toContain(outside.title);
  });

});

function shift(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const shifted = new Date(Date.UTC(y, m - 1, d + days));
  return shifted.toISOString().slice(0, 10);
}

async function journalCount(taskId: string): Promise<number> {
  return withAuthDbClient(async (client) => {
    const { rows } = await client.query<{ count: string }>(
      `SELECT count(*)::text AS "count" FROM "task_completions" WHERE "task_id" = $1`,
      [taskId],
    );
    return Number(rows[0].count);
  });
}
