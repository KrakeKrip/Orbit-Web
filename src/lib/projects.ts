/**
 * Чистые контракты и валидация projects (TASK-006): без импортов БД/auth и
 * без server-only — используются сервером (routes/service), UI и
 * pure-тестами. Имя проекта: trim, непустое, <=120 Unicode code points
 * (согласовано с PostgreSQL char_length, не UTF-16 units); повторяющиеся
 * имена разрешены. Sort input/reorder и DELETE в контрактах отсутствуют.
 */

export const PROJECT_NAME_MAX_LENGTH = 120;

export const PROJECT_LIST_STATUS_VALUES = [
  "active",
  "archived",
  "all",
] as const;

export type ProjectListStatus = (typeof PROJECT_LIST_STATUS_VALUES)[number];

export type ProjectDTO = {
  id: string;
  name: string;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export function isValidProjectListStatus(value: unknown): value is ProjectListStatus {
  return (
    typeof value === "string" &&
    (PROJECT_LIST_STATUS_VALUES as readonly string[]).includes(value)
  );
}

/**
 * Разбор единственного поддерживаемого query collection-endpoint:
 * отсутствие параметров → default "active"; ровно один key "status" со
 * значением enum. Другие keys, дубликаты и неизвестные значения отвергаются.
 */
export function parseProjectListStatusQuery(
  searchParams: URLSearchParams,
): { ok: true; status: ProjectListStatus } | { ok: false } {
  const values = searchParams.getAll("status");
  const otherKeys = [...searchParams.keys()].filter((key) => key !== "status");
  if (otherKeys.length > 0 || values.length > 1) {
    return { ok: false };
  }
  if (values.length === 0) {
    return { ok: true, status: "active" };
  }
  if (!isValidProjectListStatus(values[0])) {
    return { ok: false };
  }
  return { ok: true, status: values[0] };
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Строгая синтаксическая проверка UUID (доменный id проектов). */
export function isValidProjectId(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

/**
 * Валидация имени проекта: строка, trim, непустое, <=120 Unicode code
 * points (Array.from считает code points, не UTF-16 units — граница
 * согласована с PG char_length). Возвращает trimmed значение.
 */
export function parseProjectName(input: unknown): { ok: true; name: string } | { ok: false } {
  if (typeof input !== "string") {
    return { ok: false };
  }
  const trimmed = input.trim();
  const codePoints = Array.from(trimmed).length;
  if (codePoints === 0 || codePoints > PROJECT_NAME_MAX_LENGTH) {
    return { ok: false };
  }
  return { ok: true, name: trimmed };
}

export type ProjectPatch = {
  name?: string;
  archived?: boolean;
};

export type ProjectPatchField = "name" | "archived";

export type ProjectPatchParseResult =
  | { ok: true; patch: ProjectPatch }
  | { ok: false; field?: ProjectPatchField };

/**
 * Строгий разбор PATCH: непустой plain object с подмножеством ключей
 * name/archived и корректными типами; неизвестные поля (включая id/
 * owner_id/sort_order), null, массивы и неверные типы отвергаются; raw
 * input в результат не попадает. Имя канонизируется (trim).
 */
export function parseProjectPatch(input: unknown): ProjectPatchParseResult {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return { ok: false };
  }
  const record = input as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.length === 0) {
    return { ok: false };
  }
  const patch: ProjectPatch = {};
  for (const key of keys) {
    if (key !== "name" && key !== "archived") {
      return { ok: false };
    }
    if (key === "archived") {
      if (typeof record[key] !== "boolean") {
        return { ok: false, field: "archived" };
      }
      patch.archived = record[key] as boolean;
      continue;
    }
    const parsed = parseProjectName(record[key]);
    if (!parsed.ok) {
      return { ok: false, field: "name" };
    }
    patch.name = parsed.name;
  }
  return { ok: true, patch };
}

/**
 * Строгий разбор create body: ровно {name:string} — неизвестные поля
 * (id/owner_id/sort_order/archived/...) запрещены. Успех гарантированно
 * несёт канонизованное имя.
 */
export function parseProjectCreate(
  input: unknown,
): { ok: true; name: string } | { ok: false; field?: "name" } {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return { ok: false };
  }
  const keys = Object.keys(input as Record<string, unknown>);
  if (keys.length !== 1 || keys[0] !== "name") {
    return { ok: false };
  }
  const parsed = parseProjectName((input as Record<string, unknown>).name);
  if (!parsed.ok) {
    return { ok: false, field: "name" };
  }
  return { ok: true, name: parsed.name };
}

/** Преобразование строки БД в DTO (timestamps ISO8601, owner не отдаётся). */
export function toProjectDTO(row: {
  id: string;
  name: string;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): ProjectDTO {
  return {
    id: row.id,
    name: row.name,
    archivedAt: row.archivedAt === null ? null : row.archivedAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
