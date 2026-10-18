import { randomBytes } from "node:crypto";
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
 * HTTP/DB интеграция account settings (TASK-005) на реальном PostgreSQL и
 * production Next handler этого auth-запуска.
 *
 * Изоляция mutable fixtures: используются ОТДЕЛЬНЫЕ синтетические
 * пользователи U/V этого запуска (не общие A/B), каждый входит ровно один
 * раз (не ослабляя sign-in limiter), cookies переиспользуются тестами
 * файла. Settings-мутации не задевают общие A/B и остальные suite.
 * Порядок проверок документа задокументирован в route.ts и проверяется
 * здесь (parsing → auth → origin → validation → mutation).
 */

const SETTINGS_PATH = "/api/v1/settings";

const run = crypto.randomUUID();
const uEmail = `settings-u-${run}@orbit.test`;
const vEmail = `settings-v-${run}@orbit.test`;
const fixturePassword = randomBytes(12).toString("hex");

let uUserId = "";
let vUserId = "";
let uCookie = "";
let vCookie = "";

type SettingsResponse = {
  status: number;
  body: unknown;
  cacheControl: string | null;
};

type SettingsRequest = {
  cookie?: string;
  /** undefined → корректный Origin; null → Origin: null; omit → без Origin. */
  origin?: string | null;
  omitOrigin?: boolean;
  contentType?: string | null;
  rawBody?: string;
  payload?: unknown;
  query?: string;
};

async function settingsCall(
  method: "GET" | "PATCH",
  opts: SettingsRequest = {},
): Promise<SettingsResponse> {
  const headers: Record<string, string> = {};
  const cookie = opts.cookie;
  if (cookie) {
    headers.cookie = cookie;
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
  const response = await fetch(`${authBaseURL()}${SETTINGS_PATH}${opts.query ?? ""}`, {
    method,
    headers,
    body: method === "PATCH" ? (text ?? "") : undefined,
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

type SettingsRow = {
  timezone: string;
  theme: string;
  createdAt: Date;
  updatedAt: Date;
};

async function settingsRow(userId: string): Promise<SettingsRow | null> {
  return withAuthDbClient(async (client) => {
    const { rows } = await client.query<{
      timezone: string;
      theme: string;
      created_at: Date;
      updated_at: Date;
    }>(
      `SELECT "timezone", "theme"::text AS "theme", "created_at", "updated_at" FROM "user_settings" WHERE "user_id" = $1`,
      [userId],
    );
    const row = rows[0];
    if (!row) {
      return null;
    }
    return {
      timezone: row.timezone,
      theme: row.theme,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  });
}

function expectErrorBody(
  body: unknown,
  code: string,
  field?: string,
): void {
  expect(body).toMatchObject({
    error: field === undefined ? { code } : { code, field },
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

beforeAll(async () => {
  const u = await provisionLocalUser(authDbConnectionString(), {
    email: uEmail,
    password: fixturePassword,
    name: "Settings U",
  });
  uUserId = u.userId;
  const v = await provisionLocalUser(authDbConnectionString(), {
    email: vEmail,
    password: fixturePassword,
    name: "Settings V",
  });
  vUserId = v.userId;

  // Fixture-сессии минтятся server-side через поддерживаемый API с тем же
  // секретом этого запуска: settings suite не конкурирует за HTTP sign-in
  // limiter (его намеренно исчерпывает auth-flow).
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
  expect(uCookie).not.toBe(vCookie);
});

describe("GET /api/v1/settings", () => {
  test("отсутствующая строка: defaults UTC/system без INSERT", async () => {
    expect(await settingsRow(uUserId)).toBeNull();
    const first = await settingsCall("GET", { cookie: uCookie });
    expect(first.status).toBe(200);
    expect(first.body).toEqual({
      settings: { timezone: "UTC", theme: "system" },
    });
    // Чтение не создаёт данные: повторный GET тоже.
    const second = await settingsCall("GET", { cookie: uCookie });
    expect(second.status).toBe(200);
    expect(second.body).toEqual({
      settings: { timezone: "UTC", theme: "system" },
    });
    expect(await settingsRow(uUserId)).toBeNull();
  });

  test("все ответы private, no-store", async () => {
    const ok = await settingsCall("GET", { cookie: uCookie });
    expect(ok.cacheControl).toBe("private, no-store");
    const anonymous = await settingsCall("GET");
    expect(anonymous.cacheControl).toBe("private, no-store");
  });

  test("query parameters не поддерживаются: 400", async () => {
    const response = await settingsCall("GET", {
      cookie: uCookie,
      query: "?timezone=Europe/Moscow",
    });
    expect(response.status).toBe(400);
    expectErrorBody(response.body, "VALIDATION_ERROR");
  });
});

describe("PATCH: сессия и анонимные вызовы", () => {
  test("анонимный вызов: 401, row не создаётся", async () => {
    const response = await settingsCall("PATCH", {
      payload: { theme: "dark" },
    });
    expect(response.status).toBe(401);
    expectErrorBody(response.body, "UNAUTHENTICATED");
    // Задокументированный порядок: session проверяется раньше Origin, поэтому
    // аноним + hostile Origin — тоже 401 (не 403).
    const hostile = await settingsCall("PATCH", {
      origin: "https://evil.example",
      payload: { theme: "dark" },
    });
    expect(hostile.status).toBe(401);
    expectErrorBody(hostile.body, "UNAUTHENTICATED");
    expect(await settingsRow(vUserId)).toBeNull();
  });

  test("поддельный cookie: 401", async () => {
    const response = await settingsCall("PATCH", {
      cookie: "better-auth.session_token=tampered-value",
      payload: { theme: "dark" },
    });
    expect(response.status).toBe(401);
    expectErrorBody(response.body, "UNAUTHENTICATED");
  });

  test("невалидный payload отклоняется и не создаёт row (parsing → auth → validation)", async () => {
    expect(await settingsRow(uUserId)).toBeNull();
    const cases: Array<{ opts: SettingsRequest; field?: string }> = [
      { opts: { cookie: uCookie, payload: {} } },
      { opts: { cookie: uCookie, payload: [] } },
      { opts: { cookie: uCookie, rawBody: "null" } },
      { opts: { cookie: uCookie, rawBody: '"UTC"' } },
      { opts: { cookie: uCookie, rawBody: "" } },
      { opts: { cookie: uCookie, rawBody: "{not json" } },
      { opts: { cookie: uCookie, payload: { user_id: vUserId, theme: "dark" } } },
      { opts: { cookie: uCookie, payload: { owner_id: vUserId } } },
      { opts: { cookie: uCookie, payload: { theme: "dark", timezone: "UTC", extra: true } } },
      { opts: { cookie: uCookie, payload: { theme: "blue" } }, field: "theme" },
      { opts: { cookie: uCookie, payload: { theme: 1 } }, field: "theme" },
      { opts: { cookie: uCookie, payload: { timezone: "Mars" } }, field: "timezone" },
      { opts: { cookie: uCookie, payload: { timezone: "+03:00" } }, field: "timezone" },
      { opts: { cookie: uCookie, payload: { timezone: "UTC+3" } }, field: "timezone" },
      { opts: { cookie: uCookie, payload: { timezone: "GMT+3" } }, field: "timezone" },
      { opts: { cookie: uCookie, payload: { timezone: "" } }, field: "timezone" },
      {
        opts: {
          cookie: uCookie,
          payload: { timezone: `A`.repeat(101) },
        },
        field: "timezone",
      },
    ];
    for (const { opts, field } of cases) {
      const response = await settingsCall("PATCH", opts);
      expect(response.status, JSON.stringify(opts.payload ?? opts.rawBody)).toBe(400);
      expectErrorBody(response.body, "VALIDATION_ERROR", field);
    }
    // Ни один отказ не создал row и ничего не изменил.
    expect(await settingsRow(uUserId)).toBeNull();
  });
});

describe("PATCH: создание, частичные обновления, timestamps", () => {
  test("theme-only создаёт строку с defaults для остальных полей", async () => {
    const response = await settingsCall("PATCH", {
      cookie: uCookie,
      payload: { theme: "dark" },
    });
    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      settings: { timezone: "UTC", theme: "dark" },
    });
    const row = await settingsRow(uUserId);
    expect(row).not.toBeNull();
    expect(row?.timezone).toBe("UTC");
    expect(row?.theme).toBe("dark");
  });

  test("timezone-only сохраняет theme; created_at сохраняется, updated_at обновляется", async () => {
    const before = await settingsRow(uUserId);
    expect(before).not.toBeNull();
    await sleep(10);
    const response = await settingsCall("PATCH", {
      cookie: uCookie,
      payload: { timezone: "Europe/Moscow" },
    });
    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      settings: { timezone: "Europe/Moscow", theme: "dark" },
    });
    const after = await settingsRow(uUserId);
    expect(after?.theme).toBe("dark");
    expect(after?.timezone).toBe("Europe/Moscow");
    expect(after?.createdAt.getTime()).toBe(before?.createdAt.getTime());
    expect(after?.updatedAt.getTime()).toBeGreaterThan(
      before?.updatedAt.getTime() ?? 0,
    );
  });

  test("timezone канонизируется на сервере", async () => {
    const response = await settingsCall("PATCH", {
      cookie: uCookie,
      payload: { timezone: "  asia/tokyo " },
    });
    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      settings: { timezone: "Asia/Tokyo", theme: "dark" },
    });
    expect((await settingsRow(uUserId))?.timezone).toBe("Asia/Tokyo");
  });

  test("повтор корректного PATCH безопасен: одна строка, те же значения", async () => {
    const response = await settingsCall("PATCH", {
      cookie: uCookie,
      payload: { timezone: "Asia/Tokyo", theme: "dark" },
    });
    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      settings: { timezone: "Asia/Tokyo", theme: "dark" },
    });
    const rows = await withAuthDbClient(async (client) => {
      const result = await client.query<{ count: string }>(
        `SELECT count(*)::text AS "count" FROM "user_settings" WHERE "user_id" = $1`,
        [uUserId],
      );
      return Number(result.rows[0].count);
    });
    expect(rows).toBe(1);
  });

  test("конкурентные обновления разных полей сохраняют оба изменения", async () => {
    const [themeResult, timezoneResult] = await Promise.allSettled([
      settingsCall("PATCH", { cookie: uCookie, payload: { theme: "light" } }),
      settingsCall("PATCH", {
        cookie: uCookie,
        payload: { timezone: "America/New_York" },
      }),
    ]);
    expect(themeResult.status).toBe("fulfilled");
    expect(timezoneResult.status).toBe("fulfilled");
    if (themeResult.status === "fulfilled") {
      expect(themeResult.value.status).toBe(200);
    }
    if (timezoneResult.status === "fulfilled") {
      expect(timezoneResult.value.status).toBe(200);
    }
    const row = await settingsRow(uUserId);
    // Atomic field-specific upsert: unrelated fields не теряются.
    expect(row?.theme).toBe("light");
    expect(row?.timezone).toBe("America/New_York");
  });

  test("конкурентная запись одного поля: завершившийся последним побеждает", async () => {
    const results = await Promise.allSettled([
      settingsCall("PATCH", { cookie: uCookie, payload: { theme: "dark" } }),
      settingsCall("PATCH", { cookie: uCookie, payload: { theme: "system" } }),
    ]);
    for (const result of results) {
      expect(result.status).toBe("fulfilled");
      if (result.status === "fulfilled") {
        expect(result.value.status).toBe(200);
      }
    }
    const row = await settingsRow(uUserId);
    expect(["dark", "system"]).toContain(row?.theme);
    expect(row?.timezone).toBe("America/New_York");
  });
});

describe("PATCH: Origin защита cookie mutation", () => {
  test("hostile Origin: 403 FORBIDDEN_ORIGIN без мутаций", async () => {
    const before = await settingsRow(uUserId);
    const response = await settingsCall("PATCH", {
      cookie: uCookie,
      origin: "https://evil.example",
      payload: { theme: "light" },
    });
    expect(response.status).toBe(403);
    expectErrorBody(response.body, "FORBIDDEN_ORIGIN");
    const after = await settingsRow(uUserId);
    expect(after).toEqual(before);
  });

  test("Origin: null и отсутствующий Origin: 403 без мутаций", async () => {
    const before = await settingsRow(uUserId);
    const nullOrigin = await settingsCall("PATCH", {
      cookie: uCookie,
      origin: "null",
      payload: { theme: "light" },
    });
    expect(nullOrigin.status).toBe(403);
    expectErrorBody(nullOrigin.body, "FORBIDDEN_ORIGIN");

    const noOrigin = await settingsCall("PATCH", {
      cookie: uCookie,
      omitOrigin: true,
      payload: { theme: "light" },
    });
    expect(noOrigin.status).toBe(403);
    expectErrorBody(noOrigin.body, "FORBIDDEN_ORIGIN");

    const after = await settingsRow(uUserId);
    expect(after).toEqual(before);
  });

  test("точный configured Origin принимается", async () => {
    const response = await settingsCall("PATCH", {
      cookie: uCookie,
      origin: authBaseURL(),
      payload: { theme: "light" },
    });
    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      settings: { timezone: "America/New_York", theme: "light" },
    });
  });
});

describe("PATCH: transport", () => {
  test("неподходящий Content-Type: 415 (с Origin и валидным телом)", async () => {
    const response = await settingsCall("PATCH", {
      cookie: uCookie,
      contentType: "text/plain",
      payload: { theme: "dark" },
    });
    expect(response.status).toBe(415);
    expectErrorBody(response.body, "UNSUPPORTED_MEDIA_TYPE");

    const noType = await settingsCall("PATCH", {
      cookie: uCookie,
      contentType: null,
      payload: { theme: "dark" },
    });
    expect(noType.status).toBe(415);
    expectErrorBody(noType.body, "UNSUPPORTED_MEDIA_TYPE");

    // Похожий media type application/jsonp не принимается (точный match).
    const jsonp = await settingsCall("PATCH", {
      cookie: uCookie,
      contentType: "application/jsonp",
      payload: { theme: "dark" },
    });
    expect(jsonp.status).toBe(415);
    expectErrorBody(jsonp.body, "UNSUPPORTED_MEDIA_TYPE");
  });

  test("oversize body: 413 (не только по Content-Length)", async () => {
    const oversized = `{"theme":"dark","timezone":"${"a".repeat(3000)}"}`;
    expect(oversized.length).toBeGreaterThan(2048);
    const response = await settingsCall("PATCH", {
      cookie: uCookie,
      rawBody: oversized,
    });
    expect(response.status).toBe(413);
    expectErrorBody(response.body, "PAYLOAD_TOO_LARGE");
  });

  test("query parameters: 400 и без мутаций", async () => {
    const before = await settingsRow(uUserId);
    const response = await settingsCall("PATCH", {
      cookie: uCookie,
      query: "?theme=light",
      payload: { theme: "dark" },
    });
    expect(response.status).toBe(400);
    expectErrorBody(response.body, "VALIDATION_ERROR");
    expect(await settingsRow(uUserId)).toEqual(before);
  });
});

describe("изоляция actor и отзыв сессии", () => {
  test("настройки V независимы от U; прямой чужой owner_id отвергается", async () => {
    // V ещё без строки: видит defaults, а не значения U.
    const vGet = await settingsCall("GET", { cookie: vCookie });
    expect(vGet.status).toBe(200);
    expect(vGet.body).toEqual({
      settings: { timezone: "UTC", theme: "system" },
    });

    const vPatch = await settingsCall("PATCH", {
      cookie: vCookie,
      payload: { timezone: "Europe/Berlin", theme: "light" },
    });
    expect(vPatch.status).toBe(200);
    expect(vPatch.body).toEqual({
      settings: { timezone: "Europe/Berlin", theme: "light" },
    });

    // U не видит настройки V.
    const uGet = await settingsCall("GET", { cookie: uCookie });
    expect(uGet.body).toEqual({
      settings: { timezone: "America/New_York", theme: "light" },
    });

    // Прямая попытка записать в чужую строку через body — отклонена.
    const vBefore = await settingsRow(vUserId);
    const hijack = await settingsCall("PATCH", {
      cookie: uCookie,
      payload: { user_id: vUserId, timezone: "UTC" },
    });
    expect(hijack.status).toBe(400);
    expectErrorBody(hijack.body, "VALIDATION_ERROR");
    expect(await settingsRow(vUserId)).toEqual(vBefore);
  });

  test("отозванная сессия: 401 и без мутаций", async () => {
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

    const get = await settingsCall("GET", { cookie: uCookie });
    expect(get.status).toBe(401);
    expectErrorBody(get.body, "UNAUTHENTICATED");

    const before = await settingsRow(uUserId);
    const patch = await settingsCall("PATCH", {
      cookie: uCookie,
      payload: { theme: "dark" },
    });
    expect(patch.status).toBe(401);
    expectErrorBody(patch.body, "UNAUTHENTICATED");
    expect(await settingsRow(uUserId)).toEqual(before);
  });
});
