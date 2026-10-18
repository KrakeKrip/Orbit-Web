import { describe, expect, test } from "vitest";
import {
  TASK_TITLE_MAX_LENGTH,
  containsInvalidUnicodeText,
  isValidTaskId,
  isValidTaskListStatus,
  parseTaskCreate,
  parseTaskListStatusQuery,
  parseTaskPatch,
  parseTaskTitle,
  toTaskDTO,
} from "@/lib/tasks";

/**
 * Pure-контракты tasks (TASK-007): title (trim/пустое/граница 500 code
 * points/NUL/unpaired surrogates), строгие create/PATCH payloads, query
 * status, UUID, DTO. Без БД/env — быстрый npm test.
 */

describe("parseTaskTitle", () => {
  test("valid: trim и непустой title", () => {
    expect(parseTaskTitle("Купить хлеб")).toEqual({
      ok: true,
      title: "Купить хлеб",
    });
    expect(parseTaskTitle("  Купить хлеб  ")).toEqual({
      ok: true,
      title: "Купить хлеб",
    });
  });

  test("граница 500 — Unicode code points, не UTF-16 units", () => {
    expect(parseTaskTitle("🦄".repeat(TASK_TITLE_MAX_LENGTH)).ok).toBe(true);
    expect(parseTaskTitle("🦄".repeat(TASK_TITLE_MAX_LENGTH + 1)).ok).toBe(false);
    // 499 обычных символов + emoji = 500 code points (501 UTF-16 unit).
    expect(parseTaskTitle(`${"e".repeat(499)}🦄`).ok).toBe(true);
    expect(parseTaskTitle("e".repeat(TASK_TITLE_MAX_LENGTH)).ok).toBe(true);
    expect(parseTaskTitle("e".repeat(TASK_TITLE_MAX_LENGTH + 1)).ok).toBe(false);
  });

  test("NUL и unpaired surrogates отвергаются до PostgreSQL", () => {
    expect(parseTaskTitle("хлеб\u0000").ok).toBe(false);
    expect(containsInvalidUnicodeText("хлеб\u0000")).toBe(true);
    // Unpaired surrogates.
    expect(parseTaskTitle("\uD800").ok).toBe(false);
    expect(parseTaskTitle("хлеб\uDC00").ok).toBe(false);
    expect(containsInvalidUnicodeText("\uD800ABC")).toBe(true);
    // Валидные surrogate pairs (emoji) — корректный текст.
    expect(parseTaskTitle("🦄 хлеб").ok).toBe(true);
    expect(containsInvalidUnicodeText("🦄 хлеб")).toBe(false);
  });

  test("negative: пустые/пробельные/не-строковые значения", () => {
    expect(parseTaskTitle("").ok).toBe(false);
    expect(parseTaskTitle("   ").ok).toBe(false);
    expect(parseTaskTitle(null).ok).toBe(false);
    expect(parseTaskTitle(42).ok).toBe(false);
    expect(parseTaskTitle(undefined).ok).toBe(false);
    expect(parseTaskTitle(["a"]).ok).toBe(false);
  });
});

describe("parseTaskCreate", () => {
  test("valid: ровно {title} (planning defaults null)", () => {
    expect(parseTaskCreate({ title: " Задача " })).toEqual({
      ok: true,
      value: { title: "Задача", plannedDate: null, plannedTime: null, deadlineDate: null },
    });
    expect(parseTaskCreate({ title: "Задача", plannedDate: null })).toEqual({
      ok: true,
      value: { title: "Задача", plannedDate: null, plannedTime: null, deadlineDate: null },
    });
  });

  test("valid: planning fields + time без date → 400", () => {
    expect(
      parseTaskCreate({
        title: "A",
        plannedDate: "2026-01-05",
        plannedTime: "09:30",
        deadlineDate: "2026-01-10",
      }),
    ).toEqual({
      ok: true,
      value: {
        title: "A",
        plannedDate: "2026-01-05",
        plannedTime: "09:30",
        deadlineDate: "2026-01-10",
      },
    });
    expect(parseTaskCreate({ title: "A", plannedTime: "09:30" })).toEqual({
      ok: false,
      field: "plannedTime",
    });
    const badDate = parseTaskCreate({ title: "A", plannedDate: "2026-13-01" });
    expect(badDate.ok).toBe(false);
    expect(badDate.ok ? undefined : badDate.field).toBe("plannedDate");
    const badDeadline = parseTaskCreate({ title: "A", deadlineDate: "1899-12-31" });
    expect(badDeadline.ok).toBe(false);
    expect(badDeadline.ok ? undefined : badDeadline.field).toBe("deadlineDate");
  });

  test("unknown/identity/fields запрещены", () => {
    expect(parseTaskCreate({}).ok).toBe(false);
    expect(parseTaskCreate({ title: "A", extra: 1 }).ok).toBe(false);
    expect(parseTaskCreate({ id: "11111111-1111-4111-8111-111111111111" }).ok).toBe(false);
    expect(parseTaskCreate({ owner_id: "someone" }).ok).toBe(false);
    expect(parseTaskCreate({ project_id: null, title: "A" }).ok).toBe(false);
    expect(parseTaskCreate({ priority: 1, title: "A" }).ok).toBe(false);
    expect(parseTaskCreate({ completed: false, title: "A" }).ok).toBe(false);
  });

  test("invalid title types/values", () => {
    expect(parseTaskCreate({ title: "   " })).toEqual({ ok: false, field: "title" });
    expect(parseTaskCreate({ title: 42 })).toEqual({ ok: false, field: "title" });
    expect(parseTaskCreate({ title: null })).toEqual({ ok: false, field: "title" });
    expect(parseTaskCreate({ title: "\u0000" })).toEqual({ ok: false, field: "title" });
    expect(parseTaskCreate([]).ok).toBe(false);
    expect(parseTaskCreate(null).ok).toBe(false);
    expect(parseTaskCreate("A").ok).toBe(false);
  });
});

describe("parseTaskPatch", () => {
  test("valid: title/completed/оба", () => {
    expect(parseTaskPatch({ title: " Новое " })).toEqual({
      ok: true,
      patch: { title: "Новое" },
    });
    expect(parseTaskPatch({ completed: true })).toEqual({
      ok: true,
      patch: { completed: true },
    });
    expect(parseTaskPatch({ title: "A", completed: false })).toEqual({
      ok: true,
      patch: { title: "A", completed: false },
    });
  });

  test("invalid: пустой/неизвестные поля/типы/null", () => {
    expect(parseTaskPatch({}).ok).toBe(false);
    expect(parseTaskPatch({ project_id: "x" }).ok).toBe(false);
    expect(parseTaskPatch({ parent_id: "x", title: "A" }).ok).toBe(false);
    expect(parseTaskPatch({ priority: 1 }).ok).toBe(false);
    expect(parseTaskPatch({ notes: "x" }).ok).toBe(false);
    expect(parseTaskPatch({ planned_date: "2026-01-01" }).ok).toBe(false);
    expect(parseTaskPatch({ revision: 5 }).ok).toBe(false);
    expect(parseTaskPatch({ completed: "yes" })).toEqual({
      ok: false,
      field: "completed",
    });
    expect(parseTaskPatch({ completed: null })).toEqual({
      ok: false,
      field: "completed",
    });
    expect(parseTaskPatch({ title: "" })).toEqual({ ok: false, field: "title" });
    expect(parseTaskPatch({ title: "\uD800" })).toEqual({
      ok: false,
      field: "title",
    });
    expect(parseTaskPatch([]).ok).toBe(false);
    expect(parseTaskPatch(null).ok).toBe(false);
    expect(parseTaskPatch({ title: "A", completed: 1 })).toEqual({
      ok: false,
      field: "completed",
    });
  });
});

describe("parseTaskListStatusQuery", () => {
  test("отсутствие status → default open", () => {
    expect(parseTaskListStatusQuery(new URLSearchParams())).toEqual({
      ok: true,
      status: "open",
    });
  });

  test("valid: open/completed/all", () => {
    for (const status of ["open", "completed", "all"] as const) {
      expect(
        parseTaskListStatusQuery(new URLSearchParams(`status=${status}`)),
      ).toEqual({ ok: true, status });
    }
    expect(isValidTaskListStatus("open")).toBe(true);
    expect(isValidTaskListStatus("OPEN")).toBe(false);
    expect(isValidTaskListStatus("bogus")).toBe(false);
  });

  test("unsupported/duplicate/extra → invalid", () => {
    expect(parseTaskListStatusQuery(new URLSearchParams("status=bogus")).ok).toBe(false);
    expect(
      parseTaskListStatusQuery(new URLSearchParams("status=open&status=all")).ok,
    ).toBe(false);
    expect(
      parseTaskListStatusQuery(new URLSearchParams("status=open&other=1")).ok,
    ).toBe(false);
    expect(parseTaskListStatusQuery(new URLSearchParams("owner_id=x")).ok).toBe(false);
    expect(
      parseTaskListStatusQuery(new URLSearchParams("project_id=x")).ok,
    ).toBe(false);
  });
});

describe("isValidTaskId", () => {
  test("canonical UUID", () => {
    expect(isValidTaskId("0b8f6c1e-7c14-4f0e-9a51-2b6d9c44f001")).toBe(true);
    expect(isValidTaskId("0B8F6C1E-7C14-4F0E-9A51-2B6D9C44F001")).toBe(true);
    expect(isValidTaskId("nope")).toBe(false);
    expect(isValidTaskId(42)).toBe(false);
    expect(isValidTaskId(null)).toBe(false);
  });
});

describe("toTaskDTO", () => {
  test("Date → ISO8601, completedAt null сохраняется, owner не входит", () => {
    const dto = toTaskDTO({
      id: "0b8f6c1e-7c14-4f0e-9a51-2b6d9c44f001",
      title: "Задача",
      projectId: null,
      parentId: null,
      plannedDate: null,
      plannedTime: null,
      deadlineDate: null,
      completedAt: null,
      revision: 3,
      createdAt: new Date("2026-01-02T03:04:05.678Z"),
      updatedAt: new Date("2026-01-03T03:04:05.678Z"),
    });
    expect(dto).toEqual({
      id: "0b8f6c1e-7c14-4f0e-9a51-2b6d9c44f001",
      title: "Задача",
      projectId: null,
      parentId: null,
      plannedDate: null,
      plannedTime: null,
      deadlineDate: null,
      completedAt: null,
      revision: 3,
      createdAt: "2026-01-02T03:04:05.678Z",
      updatedAt: "2026-01-03T03:04:05.678Z",
    });
    expect("ownerId" in dto).toBe(false);
    const completed = toTaskDTO({
      id: "0b8f6c1e-7c14-4f0e-9a51-2b6d9c44f002",
      title: "Готово",
      projectId: "0b8f6c1e-7c14-4f0e-9a51-2b6d9c44f003",
      parentId: null,
      plannedDate: "2026-01-05",
      plannedTime: null,
      deadlineDate: null,
      completedAt: new Date("2026-02-01T00:00:00.000Z"),
      revision: 1,
      createdAt: new Date("2026-01-02T03:04:05.678Z"),
      updatedAt: new Date("2026-02-01T00:00:00.000Z"),
    });
    expect(completed.completedAt).toBe("2026-02-01T00:00:00.000Z");
    expect(completed.projectId).toBe("0b8f6c1e-7c14-4f0e-9a51-2b6d9c44f003");
    expect(completed.plannedDate).toBe("2026-01-05");
    expect(completed.plannedTime).toBeNull();
  });
});
