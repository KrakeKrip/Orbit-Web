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
 * HTTP/PostgreSQL integration projects (TASK-006) на production Next
 * handler этого auth-запуска. Фикстуры: отдельные синтетические пользователи
 * U/V (не общие A/B), сессии минтируются server-side через поддерживаемый
 * API (см. signInLocalUser) — suite не конкурирует за HTTP sign-in limiter.
 * Mutable project fixtures изолированы по owners этого запуска.
 *
 * Порядок проверок documentирован в routes (transport → auth → origin →
 * validation → mutation) и здесь фиксируется тестами.
 */

const COLLECTION_PATH = "/api/v1/projects";

const run = randomUUID();
const uEmail = `projects-u-${run}@orbit.test`;
const vEmail = `projects-v-${run}@orbit.test`;
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
};

async function projectsCall(
  method: "GET" | "POST" | "PATCH",
  opts: RequestOptions = {},
): Promise<ApiResult> {
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
  if (opts.contentType !== null) {
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
    body: method === "GET" ? undefined : (text ?? ""),
  });
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  return {
    status: response.status,
    body,
    cacheControl: response.headers.get("cache-control"),
  };
}

type ProjectDTO = {
  id: string;
  name: string;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

function projectOf(result: ApiResult, key: "project" | "projects"): ProjectDTO {
  expect(result.body).toBeInstanceOf(Object);
  const container = (result.body as Record<string, unknown>)[key];
  expect(container).toBeTruthy();
  return (Array.isArray(container) ? container[0] : container) as ProjectDTO;
}

async function countProjects(userId: string): Promise<number> {
  return withAuthDbClient(async (client) => {
    const { rows } = await client.query<{ count: string }>(
      `SELECT count(*)::text AS "count" FROM "projects" WHERE "owner_id" = $1`,
      [userId],
    );
    return Number(rows[0].count);
  });
}

type ProjectRow = {
  id: string;
  name: string;
  archived_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

async function projectRow(projectId: string): Promise<ProjectRow | null> {
  return withAuthDbClient(async (client) => {
    const { rows } = await client.query<ProjectRow>(
      `SELECT "id", "name", "archived_at", "created_at", "updated_at" FROM "projects" WHERE "id" = $1`,
      [projectId],
    );
    return rows[0] ?? null;
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

beforeAll(async () => {
  const u = await provisionLocalUser(authDbConnectionString(), {
    email: uEmail,
    password: fixturePassword,
    name: "Projects U",
  });
  uUserId = u.userId;
  const v = await provisionLocalUser(authDbConnectionString(), {
    email: vEmail,
    password: fixturePassword,
    name: "Projects V",
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

describe("GET /api/v1/projects", () => {
  test("пустой default active list для нового пользователя", async () => {
    const response = await projectsCall("GET", { cookie: uCookie });
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ projects: [] });
    expect(response.cacheControl).toBe("private, no-store");
  });

  test("query: unsupported/unknown/duplicate keys → 400", async () => {
    for (const query of [
      "?status=bogus",
      "?status=active&status=all",
      "?status=active&other=1",
      "?owner_id=x",
    ]) {
      const response = await projectsCall("GET", { cookie: uCookie, query });
      expect(response.status, query).toBe(400);
      expect(response.body).toMatchObject({ error: { code: "VALIDATION_ERROR" } });
    }
  });

  test("анонимный/tampered запрос: 401 без записей", async () => {
    const anonymous = await projectsCall("GET");
    expect(anonymous.status).toBe(401);
    expect(anonymous.body).toMatchObject({ error: { code: "UNAUTHENTICATED" } });
    const tampered = await projectsCall("GET", {
      cookie: "better-auth.session_token=tampered",
    });
    expect(tampered.status).toBe(401);
    expect(await countProjects(uUserId)).toBe(0);
    expect(await countProjects(vUserId)).toBe(0);
  });
});

describe("POST /api/v1/projects", () => {
  test("создание: 201 DTO, DB row (owner/UUID/sort_order 0/archived null), trim имени", async () => {
    const response = await projectsCall("POST", {
      cookie: uCookie,
      payload: { name: "  Мой проект  " },
    });
    expect(response.status).toBe(201);
    const project = projectOf(response, "project");
    expect(project.name).toBe("Мой проект");
    expect(project.archivedAt).toBeNull();
    expect(isValidUuid(project.id)).toBe(true);
    expect(project.createdAt).toBe(project.updatedAt);

    const row = await projectRow(project.id);
    expect(row?.name).toBe("Мой проект");
    expect(row?.archived_at).toBeNull();
    expect(await countProjects(uUserId)).toBe(1);
  });

  test("повторяющиеся имена разрешены; POST не идемпотентен", async () => {
    const first = await projectsCall("POST", {
      cookie: uCookie,
      payload: { name: "Дубликат" },
    });
    const second = await projectsCall("POST", {
      cookie: uCookie,
      payload: { name: "Дубликат" },
    });
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    const firstProject = projectOf(first, "project");
    const secondProject = projectOf(second, "project");
    expect(secondProject.id).not.toBe(firstProject.id);
    expect(await countProjects(uUserId)).toBe(3);
  });

  test("граница 120 Unicode code points: 120 ok, 121 → 400 без записи", async () => {
    const ok = await projectsCall("POST", {
      cookie: uCookie,
      payload: { name: "🦄".repeat(120) },
    });
    expect(ok.status).toBe(201);
    expect(projectOf(ok, "project").name).toBe("🦄".repeat(120));

    const before = await countProjects(uUserId);
    const tooLong = await projectsCall("POST", {
      cookie: uCookie,
      payload: { name: "🦄".repeat(121) },
    });
    expect(tooLong.status).toBe(400);
    expect(tooLong.body).toMatchObject({
      error: { code: "VALIDATION_ERROR", field: "name" },
    });
    expect(await countProjects(uUserId)).toBe(before);
  });

  test("невалидные create payloads → 400 и без записи", async () => {
    const cases: Array<{ payload?: unknown; rawBody?: string; field?: string }> = [
      { payload: {} },
      { payload: { name: "   " }, field: "name" },
      { payload: { name: 42 }, field: "name" },
      { payload: { name: null }, field: "name" },
      { payload: { name: "A", extra: true } },
      { payload: { id: randomUUID(), name: "A" } },
      { payload: { owner_id: vUserId, name: "A" } },
      { payload: { sort_order: 5, name: "A" } },
      { payload: { archived: false, name: "A" } },
      { rawBody: "not json" },
      { rawBody: "null" },
      { rawBody: "" },
    ];
    const before = await countProjects(uUserId);
    for (const { payload, rawBody, field } of cases) {
      const response = await projectsCall("POST", {
        cookie: uCookie,
        payload,
        rawBody,
      });
      expect(response.status, JSON.stringify(payload ?? rawBody)).toBe(400);
      expect(response.body).toMatchObject({
        error: field ? { code: "VALIDATION_ERROR", field } : { code: "VALIDATION_ERROR" },
      });
    }
    expect(await countProjects(uUserId)).toBe(before);
  });

  test("transport: 415 / 413 / Origin 403 без записи; no-store", async () => {
    const before = await countProjects(uUserId);
    const wrongType = await projectsCall("POST", {
      cookie: uCookie,
      contentType: "text/plain",
      payload: { name: "A" },
    });
    expect(wrongType.status).toBe(415);
    const oversize = await projectsCall("POST", {
      cookie: uCookie,
      rawBody: `{"name":"${"a".repeat(3000)}"}`,
    });
    expect(oversize.status).toBe(413);
    for (const origin of ["https://evil.example", "null"]) {
      const hostile = await projectsCall("POST", {
        cookie: uCookie,
        origin,
        payload: { name: "A" },
      });
      expect(hostile.status).toBe(403);
      expect(hostile.body).toMatchObject({ error: { code: "FORBIDDEN_ORIGIN" } });
    }
    const missing = await projectsCall("POST", {
      cookie: uCookie,
      omitOrigin: true,
      payload: { name: "A" },
    });
    expect(missing.status).toBe(403);

    const jsonp = await projectsCall("POST", {
      cookie: uCookie,
      contentType: "application/jsonp",
      payload: { name: "JSONP" },
    });
    expect(jsonp.status).toBe(415);
    expect(jsonp.body).toMatchObject({ error: { code: "UNSUPPORTED_MEDIA_TYPE" } });

    const exact = await projectsCall("POST", {
      cookie: uCookie,
      origin: authBaseURL(),
      payload: { name: "Origin OK" },
    });
    expect(exact.status).toBe(201);
    expect(exact.cacheControl).toBe("private, no-store");
    expect(await countProjects(uUserId)).toBe(before + 1);
  });

  test("markup name сохраняется и возвращается как данные", async () => {
    const response = await projectsCall("POST", {
      cookie: uCookie,
      payload: { name: "<b>Разметка</b> & \"кавычки\"" },
    });
    expect(response.status).toBe(201);
    expect(projectOf(response, "project").name).toBe(
      '<b>Разметка</b> & "кавычки"',
    );
  });
});

describe("list: status filter, stable ordering, owner scope", () => {
  test("active/archived/all и стабильная сортировка", async () => {
    // Текущее состояние U: «Мой проект», 2×«Дубликат», 🦄×120, «Origin OK», markup.
    const all = await projectsCall("GET", {
      cookie: uCookie,
      query: "?status=all",
    });
    expect(all.status).toBe(200);
    const projects = (all.body as { projects: ProjectDTO[] }).projects;
    expect(projects.length).toBe(6);
    // Стабильная сортировка sort_order ASC, created_at ASC, id ASC.
    const expected = [...projects].sort((a, b) => {
      if (a.createdAt !== b.createdAt) {
        return a.createdAt < b.createdAt ? -1 : 1;
      }
      return a.id < b.id ? -1 : 1;
    });
    expect(projects).toEqual(expected);

    const active = await projectsCall("GET", { cookie: uCookie });
    expect((active.body as { projects: ProjectDTO[] }).projects.length).toBe(6);
    const archived = await projectsCall("GET", {
      cookie: uCookie,
      query: "?status=archived",
    });
    expect((archived.body as { projects: ProjectDTO[] }).projects).toEqual([]);
  });

  test("owner scope: списки U и V независимы", async () => {
    const vList = await projectsCall("GET", { cookie: vCookie });
    expect(vList.status).toBe(200);
    expect(vList.body).toEqual({ projects: [] });
  });
});

describe("item GET/PATCH: rename/archive/restore", () => {
  let projectId = "";

  beforeAll(async () => {
    const response = await projectsCall("POST", {
      cookie: uCookie,
      payload: { name: "Item Flow" },
    });
    expect(response.status).toBe(201);
    projectId = projectOf(response, "project").id;
  });

  test("invalid UUID → 400; query → 400", async () => {
    const badId = await projectsCall("GET", {
      cookie: uCookie,
      path: `${COLLECTION_PATH}/not-a-uuid`,
    });
    expect(badId.status).toBe(400);
    expect(badId.body).toMatchObject({
      error: { code: "VALIDATION_ERROR", field: "projectId" },
    });
    const withQuery = await projectsCall("GET", {
      cookie: uCookie,
      path: `${COLLECTION_PATH}/${projectId}`,
      query: "?status=all",
    });
    expect(withQuery.status).toBe(400);
  });

  test("valid unknown и foreign UUID → одинаковый 404 без раскрытия", async () => {
    const unknownId = randomUUID();
    const unknown = await projectsCall("GET", {
      cookie: uCookie,
      path: `${COLLECTION_PATH}/${unknownId}`,
    });
    expect(unknown.status).toBe(404);
    expect(unknown.body).toEqual({ error: { code: "NOT_FOUND" } });
    const foreign = await projectsCall("GET", {
      cookie: uCookie,
      path: `${COLLECTION_PATH}/${projectId}`,
    });
    // (проект U запрошен U — для foreign-сценария см. следующий тест V→U)
    expect(foreign.status).toBe(200);

    const foreignFromV = await projectsCall("GET", {
      cookie: vCookie,
      path: `${COLLECTION_PATH}/${projectId}`,
    });
    expect(foreignFromV.status).toBe(404);
    expect(foreignFromV.body).toEqual(unknown.body);
  });

  test("rename: 200, неизменные id/created_at, updated_at обновлён", async () => {
    const before = await projectRow(projectId);
    expect(before).not.toBeNull();
    await sleep(10);
    const response = await projectsCall("PATCH", {
      cookie: uCookie,
      path: `${COLLECTION_PATH}/${projectId}`,
      payload: { name: "Переименованный" },
    });
    expect(response.status).toBe(200);
    const project = projectOf(response, "project");
    expect(project.name).toBe("Переименованный");
    expect(project.createdAt).toBe(before?.created_at.toISOString());
    expect(project.updatedAt > project.createdAt).toBe(true);
    const after = await projectRow(projectId);
    expect(after?.created_at.getTime()).toBe(before?.created_at.getTime());
    expect(after?.updated_at.getTime()).toBeGreaterThan(
      before?.updated_at.getTime() ?? 0,
    );
  });

  test("combined PATCH {name, archived} атомарен", async () => {
    const response = await projectsCall("PATCH", {
      cookie: uCookie,
      path: `${COLLECTION_PATH}/${projectId}`,
      payload: { name: "Комбинированный", archived: true },
    });
    expect(response.status).toBe(200);
    const project = projectOf(response, "project");
    expect(project.name).toBe("Комбинированный");
    expect(project.archivedAt).not.toBeNull();
  });

  test("повтор archive сохраняет archived_at; restore → null; повтор restore остаётся null", async () => {
    const firstArchived = projectOf(
      await projectsCall("GET", {
        cookie: uCookie,
        path: `${COLLECTION_PATH}/${projectId}`,
      }),
      "project",
    ).archivedAt;
    expect(firstArchived).not.toBeNull();
    await sleep(10);
    const repeat = await projectsCall("PATCH", {
      cookie: uCookie,
      path: `${COLLECTION_PATH}/${projectId}`,
      payload: { archived: true },
    });
    expect(repeat.status).toBe(200);
    expect(projectOf(repeat, "project").archivedAt).toBe(firstArchived);

    const restore = await projectsCall("PATCH", {
      cookie: uCookie,
      path: `${COLLECTION_PATH}/${projectId}`,
      payload: { archived: false },
    });
    expect(restore.status).toBe(200);
    expect(projectOf(restore, "project").archivedAt).toBeNull();
    const restoreAgain = await projectsCall("PATCH", {
      cookie: uCookie,
      path: `${COLLECTION_PATH}/${projectId}`,
      payload: { archived: false },
    });
    expect(projectOf(restoreAgain, "project").archivedAt).toBeNull();

    // Повторное архивирование после restore — новый timestamp.
    await sleep(10);
    const reArchive = await projectsCall("PATCH", {
      cookie: uCookie,
      path: `${COLLECTION_PATH}/${projectId}`,
      payload: { archived: true },
    });
    const newArchivedAt = projectOf(reArchive, "project").archivedAt;
    expect(newArchivedAt).not.toBeNull();
    expect(newArchivedAt).not.toBe(firstArchived);
    // Возврат в активное состояние для последующих сценариев.
    await projectsCall("PATCH", {
      cookie: uCookie,
      path: `${COLLECTION_PATH}/${projectId}`,
      payload: { archived: false },
    });
  });

  test("конкурентные unrelated updates сохраняют оба поля", async () => {
    const [nameResult, archiveResult] = await Promise.allSettled([
      projectsCall("PATCH", {
        cookie: uCookie,
        path: `${COLLECTION_PATH}/${projectId}`,
        payload: { name: "Конкурентное имя" },
      }),
      projectsCall("PATCH", {
        cookie: uCookie,
        path: `${COLLECTION_PATH}/${projectId}`,
        payload: { archived: true },
      }),
    ]);
    expect(nameResult.status).toBe("fulfilled");
    expect(archiveResult.status).toBe("fulfilled");
    const row = await projectRow(projectId);
    expect(row?.name).toBe("Конкурентное имя");
    expect(row?.archived_at).not.toBeNull();
    // Возврат в активное состояние.
    await projectsCall("PATCH", {
      cookie: uCookie,
      path: `${COLLECTION_PATH}/${projectId}`,
      payload: { archived: false },
    });
  });

  test("точный media type: application/jsonp → 415 без мутаций; параметры → success", async () => {
    const rowBefore = await projectRow(projectId);

    const jsonp = await projectsCall("PATCH", {
      cookie: uCookie,
      path: `${COLLECTION_PATH}/${projectId}`,
      contentType: "application/jsonp",
      payload: { name: "JSONP" },
    });
    expect(jsonp.status).toBe(415);
    expect(jsonp.body).toMatchObject({ error: { code: "UNSUPPORTED_MEDIA_TYPE" } });
    expect(await projectRow(projectId)).toEqual(rowBefore);

    const withParams = await projectsCall("PATCH", {
      cookie: uCookie,
      path: `${COLLECTION_PATH}/${projectId}`,
      contentType: "application/json;charset=UTF-8",
      payload: { name: "Параметры Content-Type" },
    });
    expect(withParams.status).toBe(200);
    expect(projectOf(withParams, "project").name).toBe("Параметры Content-Type");
  });

  test("archive не трогает связанную task (fixture в собственной БД)", async () => {
    const taskInsert = await withAuthDbClient(async (client) => {
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO "tasks" ("owner_id", "project_id", "title") VALUES ($1, $2, 'Project task fixture') RETURNING "id"`,
        [uUserId, projectId],
      );
      return rows[0].id;
    });
    const archive = await projectsCall("PATCH", {
      cookie: uCookie,
      path: `${COLLECTION_PATH}/${projectId}`,
      payload: { archived: true },
    });
    expect(archive.status).toBe(200);
    const restore = await projectsCall("PATCH", {
      cookie: uCookie,
      path: `${COLLECTION_PATH}/${projectId}`,
      payload: { archived: false },
    });
    expect(restore.status).toBe(200);
    await withAuthDbClient(async (client) => {
      const { rows } = await client.query<{
        id: string;
        project_id: string;
        deleted_at: Date | null;
        completed_at: Date | null;
      }>(
        `SELECT "id", "project_id", "deleted_at", "completed_at" FROM "tasks" WHERE "id" = $1`,
        [taskInsert],
      );
      expect(rows[0].id).toBe(taskInsert);
      expect(rows[0].project_id).toBe(projectId);
      expect(rows[0].deleted_at).toBeNull();
      expect(rows[0].completed_at).toBeNull();
    });
  });

  test("foreign/unknown PATCH: 404, чужие строки не меняются, ничего не создаётся", async () => {
    const vBefore = await projectRow(projectId);
    const vOwnBefore = await countProjects(vUserId);

    // V переименовывает свой проект (создаём), U пытается тем же id.
    const vProject = projectOf(
      await projectsCall("POST", {
        cookie: vCookie,
        payload: { name: "Проект V" },
      }),
      "project",
    );
    const foreignPatch = await projectsCall("PATCH", {
      cookie: uCookie,
      path: `${COLLECTION_PATH}/${vProject.id}`,
      payload: { name: "Взлом" },
    });
    expect(foreignPatch.status).toBe(404);
    expect(foreignPatch.body).toEqual({ error: { code: "NOT_FOUND" } });
    const vAfter = await projectRow(vProject.id);
    expect(vAfter?.name).toBe("Проект V");

    const unknownPatch = await projectsCall("PATCH", {
      cookie: uCookie,
      path: `${COLLECTION_PATH}/${randomUUID()}`,
      payload: { name: "Фантом" },
    });
    expect(unknownPatch.status).toBe(404);

    // Спуфинг owner в payload отвергается валидацией.
    const spoof = await projectsCall("PATCH", {
      cookie: uCookie,
      path: `${COLLECTION_PATH}/${projectId}`,
      payload: { owner_id: vUserId, name: "Спуфинг" },
    });
    expect(spoof.status).toBe(400);

    expect(await projectRow(projectId)).toEqual(vBefore);
    expect(await countProjects(vUserId)).toBe(vOwnBefore + 1);
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

    const get = await projectsCall("GET", { cookie: uCookie });
    expect(get.status).toBe(401);
    const before = await countProjects(uUserId);
    const post = await projectsCall("POST", {
      cookie: uCookie,
      payload: { name: "После выхода" },
    });
    expect(post.status).toBe(401);
    const patch = await projectsCall("PATCH", {
      cookie: uCookie,
      path: `${COLLECTION_PATH}/${projectId}`,
      payload: { archived: true },
    });
    expect(patch.status).toBe(401);
    expect(await countProjects(uUserId)).toBe(before);
  });
});

function isValidUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    value,
  );
}
