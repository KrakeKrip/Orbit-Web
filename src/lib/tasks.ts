import {
  addCivilDays,
  CIVIL_DATE_MAX,
  normalizeCivilTime,
  parseCivilDate,
  parseCivilTime,
} from "./calendar";

/**
 * Pure contracts и валидация tasks (TASK-007 Inbox subset + TASK-008
 * planning): без импортов БД/auth и без server-only. Title: trim, 1–500
 * Unicode code points (согласовано с PG char_length, не UTF-16 units); NUL
 * и unpaired surrogates отвергаются до PostgreSQL. Дубликаты разрешены.
 * Write-контракт: create {title, plannedDate?, plannedTime?, deadlineDate?}
 * (отсутствующие planning → NULL), PATCH — непустой subset {title?,
 * completed?, plannedDate?, plannedTime?, deadlineDate?}; null разрешён
 * только для schedule fields; project/parent/notes/priority/recurrence/
 * owner/revision/order через API не меняются.
 */

export const TASK_TITLE_MAX_LENGTH = 500;

/** Streaming JSON body limit задач: 500-code-point emoji title + schedule
 * поля должны помещаться; shared default/Settings/Projects/DELETE — 2 KiB. */
export const TASKS_MAX_JSON_BODY_BYTES = 4096;

export const TASK_LIST_STATUS_VALUES = ["open", "completed", "all"] as const;

export type TaskListStatus = (typeof TASK_LIST_STATUS_VALUES)[number];

export type TaskDTO = {
  id: string;
  title: string;
  projectId: string | null;
  parentId: string | null;
  plannedDate: string | null;
  plannedTime: string | null;
  deadlineDate: string | null;
  completedAt: string | null;
  revision: number;
  createdAt: string;
  updatedAt: string;
};

export type TaskViewName = "inbox" | "today" | "upcoming";

export function isValidTaskListStatus(value: unknown): value is TaskListStatus {
  return (
    typeof value === "string" &&
    (TASK_LIST_STATUS_VALUES as readonly string[]).includes(value)
  );
}

export type TaskCollectionViewQuery = {
  view: TaskViewName;
  status: TaskListStatus;
  /** Только для view=upcoming; undefined → context.today на сервере. */
  startDate?: string;
};

export type TaskCollectionViewParseResult =
  | { ok: true; query: TaskCollectionViewQuery }
  | { ok: false };

/**
 * Разбор query коллекции: view=inbox|today|upcoming (default inbox),
 * status=open|completed|all (default open), start=YYYY-MM-DD только для
 * view=upcoming. Дубликаты/неизвестные keys/значения → invalid; start вне
 * supported диапазона (включая start+6) → invalid.
 */
export function parseTaskCollectionViewQuery(
  searchParams: URLSearchParams,
): TaskCollectionViewParseResult {
  const otherKeys = [...searchParams.keys()].filter(
    (key) => key !== "view" && key !== "status" && key !== "start",
  );
  if (otherKeys.length > 0) {
    return { ok: false };
  }
  const viewValues = searchParams.getAll("view");
  if (viewValues.length > 1) {
    return { ok: false };
  }
  const view = viewValues[0] ?? "inbox";
  if (view !== "inbox" && view !== "today" && view !== "upcoming") {
    return { ok: false };
  }
  const statusValues = searchParams.getAll("status");
  if (statusValues.length > 1) {
    return { ok: false };
  }
  const status = statusValues[0] ?? "open";
  if (status !== "open" && status !== "completed" && status !== "all") {
    return { ok: false };
  }
  const startValues = searchParams.getAll("start");
  if (startValues.length > 1) {
    return { ok: false };
  }
  let startDate: string | undefined;
  if (startValues.length === 1) {
    if (view !== "upcoming") {
      return { ok: false };
    }
    const parsed = parseCivilDate(startValues[0]);
    if (!parsed.ok) {
      return { ok: false };
    }
    // Весь диапазон start..start+6 обязан быть в supported датах.
    try {
      if (addCivilDays(parsed.value, 6) > CIVIL_DATE_MAX) {
        return { ok: false };
      }
    } catch {
      return { ok: false };
    }
    startDate = parsed.value;
  }
  return { ok: true, query: { view, status, startDate } };
}

export function parseTaskListStatusQuery(
  searchParams: URLSearchParams,
): { ok: true; status: TaskListStatus } | { ok: false } {
  const values = searchParams.getAll("status");
  const otherKeys = [...searchParams.keys()].filter((key) => key !== "status");
  if (otherKeys.length > 0 || values.length > 1) {
    return { ok: false };
  }
  if (values.length === 0) {
    return { ok: true, status: "open" };
  }
  if (!isValidTaskListStatus(values[0])) {
    return { ok: false };
  }
  return { ok: true, status: values[0] };
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Строгая синтаксическая проверка UUID (доменный id задач). */
export function isValidTaskId(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

/**
 * NUL-байты и unpaired surrogates не являются корректным текстом UTF-8:
 * PostgreSQL отверг бы их с 500, поэтому валидация отсекает их раньше.
 * Valid surrogate pairs разрешены (emoji и другие non-BMP символы).
 */
export function containsInvalidUnicodeText(input: string): boolean {
  if (input.includes("\0")) {
    return true;
  }
  // Убираем валидные surrogate pairs; остаточные lone surrogates невалидны.
  return /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(
    input,
  );
}

export function parseTaskTitle(
  input: unknown,
): { ok: true; title: string } | { ok: false } {
  if (typeof input !== "string") {
    return { ok: false };
  }
  const trimmed = input.trim();
  const codePoints = Array.from(trimmed).length;
  if (
    codePoints === 0 ||
    codePoints > TASK_TITLE_MAX_LENGTH ||
    containsInvalidUnicodeText(trimmed)
  ) {
    return { ok: false };
  }
  return { ok: true, title: trimmed };
}

export type TaskPatch = {
  title?: string;
  completed?: boolean;
  /** undefined = поле не передано; null = явная очистка (только schedule). */
  plannedDate?: string | null;
  plannedTime?: string | null;
  deadlineDate?: string | null;
};

export type TaskPatchField =
  | "title"
  | "completed"
  | "plannedDate"
  | "plannedTime"
  | "deadlineDate";

export type TaskPatchParseResult =
  | { ok: true; patch: TaskPatch }
  | { ok: false; field?: TaskPatchField };

/**
 * Строгий разбор PATCH: непустой plain object с подмножеством ключей
 * title/completed; неизвестные поля (project_id/parent_id/notes/priority/
 * dates/recurrence/owner/revision и т.п.), null, массивы и неверные типы
 * отвергаются; raw input в результат не попадает. Title канонизируется.
 */
export function parseTaskPatch(input: unknown): TaskPatchParseResult {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return { ok: false };
  }
  const record = input as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.length === 0) {
    return { ok: false };
  }
  const patch: TaskPatch = {};
  for (const key of keys) {
    if (
      key !== "title" &&
      key !== "completed" &&
      key !== "plannedDate" &&
      key !== "plannedTime" &&
      key !== "deadlineDate"
    ) {
      return { ok: false };
    }
    if (key === "completed") {
      if (typeof record[key] !== "boolean") {
        return { ok: false, field: "completed" };
      }
      patch.completed = record[key] as boolean;
      continue;
    }
    if (key === "plannedDate" || key === "deadlineDate") {
      const value = record[key];
      if (value === null) {
        patch[key] = null;
        continue;
      }
      const parsed = parseCivilDate(value);
      if (!parsed.ok) {
        return { ok: false, field: key };
      }
      patch[key] = parsed.value;
      continue;
    }
    if (key === "plannedTime") {
      const value = record[key];
      if (value === null) {
        patch.plannedTime = null;
        continue;
      }
      const parsed = parseCivilTime(value);
      if (!parsed.ok) {
        return { ok: false, field: "plannedTime" };
      }
      patch.plannedTime = parsed.value;
      continue;
    }
    const parsed = parseTaskTitle(record[key]);
    if (!parsed.ok) {
      return { ok: false, field: "title" };
    }
    patch.title = parsed.title;
  }
  return { ok: true, patch };
}

export type TaskPlanningValues = {
  plannedDate: string | null;
  plannedTime: string | null;
  deadlineDate: string | null;
};

export type TaskCreateParseResult =
  | { ok: true; value: { title: string } & TaskPlanningValues }
  | {
      ok: false;
      field?: "title" | "plannedDate" | "plannedTime" | "deadlineDate";
    };

/**
 * Строгий разбор create body: {title} + опциональные planning fields.
 * Отсутствующие planning → NULL; явный null → NULL; plannedTime без
 * результирующего plannedDate → 400 (field=plannedTime). Unknown поля —
 * отклонение.
 */
export function parseTaskCreate(input: unknown): TaskCreateParseResult {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return { ok: false };
  }
  const record = input as Record<string, unknown>;
  const keys = Object.keys(record);
  const allowed = new Set([
    "title",
    "plannedDate",
    "plannedTime",
    "deadlineDate",
  ]);
  if (keys.length === 0 || keys.some((key) => !allowed.has(key))) {
    return { ok: false };
  }
  const title = parseTaskTitle(record.title);
  if (!title.ok) {
    return { ok: false, field: "title" };
  }
  let plannedDate: string | null = null;
  if (record.plannedDate !== undefined && record.plannedDate !== null) {
    const parsed = parseCivilDate(record.plannedDate);
    if (!parsed.ok) {
      return { ok: false, field: "plannedDate" };
    }
    plannedDate = parsed.value;
  }
  let plannedTime: string | null = null;
  if (record.plannedTime !== undefined && record.plannedTime !== null) {
    const parsed = parseCivilTime(record.plannedTime);
    if (!parsed.ok) {
      return { ok: false, field: "plannedTime" };
    }
    plannedTime = parsed.value;
  }
  let deadlineDate: string | null = null;
  if (record.deadlineDate !== undefined && record.deadlineDate !== null) {
    const parsed = parseCivilDate(record.deadlineDate);
    if (!parsed.ok) {
      return { ok: false, field: "deadlineDate" };
    }
    deadlineDate = parsed.value;
  }
  if (plannedTime !== null && plannedDate === null) {
    return { ok: false, field: "plannedTime" };
  }
  return {
    ok: true,
    value: { title: title.title, plannedDate, plannedTime, deadlineDate },
  };
}

/** Преобразование строки БД в DTO (timestamps ISO8601; owner/секреты нет). */
export function toTaskDTO(row: {
  id: string;
  title: string;
  projectId: string | null;
  parentId: string | null;
  plannedDate: string | null;
  plannedTime: string | null;
  deadlineDate: string | null;
  completedAt: Date | null;
  revision: number;
  createdAt: Date;
  updatedAt: Date;
}): TaskDTO {
  return {
    id: row.id,
    title: row.title,
    projectId: row.projectId,
    parentId: row.parentId,
    plannedDate: row.plannedDate,
    plannedTime: normalizeCivilTime(row.plannedTime),
    deadlineDate: row.deadlineDate,
    completedAt: row.completedAt === null ? null : row.completedAt.toISOString(),
    revision: row.revision,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
