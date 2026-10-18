import { describe, expect, test } from "vitest";
import {
  PROJECT_NAME_MAX_LENGTH,
  isValidProjectId,
  isValidProjectListStatus,
  parseProjectCreate,
  parseProjectListStatusQuery,
  parseProjectName,
  parseProjectPatch,
  toProjectDTO,
} from "@/lib/projects";

/**
 * Pure-контракты projects (TASK-006): имя (trim/пустое/граница 120 Unicode
 * code points — не UTF-16 units), строгий create/PATCH payload, query
 * status, UUID syntax, DTO. Без БД/env — быстрый npm test; HTTP/DB
 * поведение покрыто integration и browser suites.
 */

describe("parseProjectName", () => {
  test("valid: trim и непустое имя", () => {
    expect(parseProjectName("Мой проект")).toEqual({ ok: true, name: "Мой проект" });
    expect(parseProjectName("  Мой проект  ")).toEqual({
      ok: true,
      name: "Мой проект",
    });
    expect(parseProjectName("a")).toEqual({ ok: true, name: "a" });
  });

  test("граница 120 — именно Unicode code points, не UTF-16 units", () => {
    // 🦄 — один code point (два UTF-16 units): 120 emoji допустимы.
    expect(parseProjectName("🦄".repeat(PROJECT_NAME_MAX_LENGTH))).toEqual({
      ok: true,
      name: "🦄".repeat(PROJECT_NAME_MAX_LENGTH),
    });
    expect(parseProjectName("🦄".repeat(PROJECT_NAME_MAX_LENGTH + 1)).ok).toBe(false);
    // 119 обычных символов + emoji = 120 code points (121 UTF-16 unit) — допустимо.
    expect(parseProjectName(`${"e".repeat(119)}🦄`).ok).toBe(true);
    expect(parseProjectName("e".repeat(PROJECT_NAME_MAX_LENGTH)).ok).toBe(true);
    expect(parseProjectName("e".repeat(PROJECT_NAME_MAX_LENGTH + 1)).ok).toBe(false);
  });

  test("negative: пустые/пробельные/не-строковые значения", () => {
    expect(parseProjectName("").ok).toBe(false);
    expect(parseProjectName("   ").ok).toBe(false);
    expect(parseProjectName(null).ok).toBe(false);
    expect(parseProjectName(42).ok).toBe(false);
    expect(parseProjectName(undefined).ok).toBe(false);
    expect(parseProjectName(["a"]).ok).toBe(false);
  });
});

describe("parseProjectCreate", () => {
  test("valid: ровно {name}", () => {
    expect(parseProjectCreate({ name: " Проект " })).toEqual({
      ok: true,
      name: "Проект",
    });
  });

  test("unknown/identity/sort/archived поля запрещены", () => {
    expect(parseProjectCreate({}).ok).toBe(false);
    expect(parseProjectCreate({ name: "A", extra: 1 }).ok).toBe(false);
    expect(parseProjectCreate({ id: "11111111-1111-4111-8111-111111111111" }).ok).toBe(false);
    expect(parseProjectCreate({ owner_id: "someone" }).ok).toBe(false);
    expect(parseProjectCreate({ sort_order: 3 }).ok).toBe(false);
    expect(parseProjectCreate({ archived: false }).ok).toBe(false);
  });

  test("invalid name types/values", () => {
    expect(parseProjectCreate({ name: "   " })).toEqual({ ok: false, field: "name" });
    expect(parseProjectCreate({ name: 42 })).toEqual({ ok: false, field: "name" });
    expect(parseProjectCreate({ name: null })).toEqual({ ok: false, field: "name" });
    expect(parseProjectCreate([]).ok).toBe(false);
    expect(parseProjectCreate(null).ok).toBe(false);
    expect(parseProjectCreate("A").ok).toBe(false);
  });
});

describe("parseProjectPatch", () => {
  test("valid: name/archived/оба", () => {
    expect(parseProjectPatch({ name: " Новое " })).toEqual({
      ok: true,
      patch: { name: "Новое" },
    });
    expect(parseProjectPatch({ archived: true })).toEqual({
      ok: true,
      patch: { archived: true },
    });
    expect(parseProjectPatch({ name: "A", archived: false })).toEqual({
      ok: true,
      patch: { name: "A", archived: false },
    });
  });

  test("invalid: пустой/неизвестные/null/массив/типы", () => {
    expect(parseProjectPatch({}).ok).toBe(false);
    expect(parseProjectPatch({ id: "x" }).ok).toBe(false);
    expect(parseProjectPatch({ sort_order: 1 }).ok).toBe(false);
    expect(parseProjectPatch({ owner_id: "x", name: "A" }).ok).toBe(false);
    expect(parseProjectPatch({ archived: "yes" })).toEqual({
      ok: false,
      field: "archived",
    });
    expect(parseProjectPatch({ archived: null })).toEqual({
      ok: false,
      field: "archived",
    });
    expect(parseProjectPatch({ name: "" })).toEqual({ ok: false, field: "name" });
    expect(parseProjectPatch({ name: null })).toEqual({ ok: false, field: "name" });
    expect(parseProjectPatch([]).ok).toBe(false);
    expect(parseProjectPatch(null).ok).toBe(false);
    // Ошибка одного поля при валидном втором.
    expect(parseProjectPatch({ name: "A", archived: 1 })).toEqual({
      ok: false,
      field: "archived",
    });
  });
});

describe("parseProjectListStatusQuery", () => {
  test("отсутствие status → default active", () => {
    expect(parseProjectListStatusQuery(new URLSearchParams())).toEqual({
      ok: true,
      status: "active",
    });
  });

  test("valid: active/archived/all", () => {
    for (const status of ["active", "archived", "all"] as const) {
      expect(
        parseProjectListStatusQuery(new URLSearchParams(`status=${status}`)),
      ).toEqual({ ok: true, status });
    }
    expect(isValidProjectListStatus("active")).toBe(true);
    expect(isValidProjectListStatus("ACTIVE")).toBe(false);
    expect(isValidProjectListStatus("bogus")).toBe(false);
  });

  test("unsupported/unknown/duplicate → invalid", () => {
    expect(
      parseProjectListStatusQuery(new URLSearchParams("status=bogus")).ok,
    ).toBe(false);
    expect(
      parseProjectListStatusQuery(new URLSearchParams("status=active&status=all")).ok,
    ).toBe(false);
    expect(
      parseProjectListStatusQuery(new URLSearchParams("status=active&other=1")).ok,
    ).toBe(false);
    expect(parseProjectListStatusQuery(new URLSearchParams("owner_id=x")).ok).toBe(false);
  });
});

describe("isValidProjectId", () => {
  test("canonical UUID v4-подобные строки", () => {
    expect(isValidProjectId("0b8f6c1e-7c14-4f0e-9a51-2b6d9c44f001")).toBe(true);
    expect(isValidProjectId("0B8F6C1E-7C14-4F0E-9A51-2B6D9C44F001")).toBe(true);
    expect(isValidProjectId("not-a-uuid")).toBe(false);
    expect(isValidProjectId("0b8f6c1e7c144f0e9a512b6d9c44f001")).toBe(false);
    expect(isValidProjectId("{0b8f6c1e-7c14-4f0e-9a51-2b6d9c44f001}")).toBe(false);
    expect(isValidProjectId(42)).toBe(false);
    expect(isValidProjectId(null)).toBe(false);
  });
});

describe("toProjectDTO", () => {
  test("Date → ISO8601, null archivedAt сохраняется, owner не входит", () => {
    const dto = toProjectDTO({
      id: "0b8f6c1e-7c14-4f0e-9a51-2b6d9c44f001",
      name: "Проект",
      archivedAt: null,
      createdAt: new Date("2026-01-02T03:04:05.678Z"),
      updatedAt: new Date("2026-01-03T03:04:05.678Z"),
    });
    expect(dto).toEqual({
      id: "0b8f6c1e-7c14-4f0e-9a51-2b6d9c44f001",
      name: "Проект",
      archivedAt: null,
      createdAt: "2026-01-02T03:04:05.678Z",
      updatedAt: "2026-01-03T03:04:05.678Z",
    });
    expect("ownerId" in dto).toBe(false);
    const archived = toProjectDTO({
      id: "0b8f6c1e-7c14-4f0e-9a51-2b6d9c44f002",
      name: "Архив",
      archivedAt: new Date("2026-02-01T00:00:00.000Z"),
      createdAt: new Date("2026-01-02T03:04:05.678Z"),
      updatedAt: new Date("2026-02-01T00:00:00.000Z"),
    });
    expect(archived.archivedAt).toBe("2026-02-01T00:00:00.000Z");
  });
});
