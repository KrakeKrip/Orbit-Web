/**
 * Чистые контракты и валидация account settings (TASK-005): без импортов
 * БД/auth и без server-only — используется сервером (route/service), UI и
 * pure-тестами. DB settings — источник истины; defaults нового аккаунта —
 * UTC/system, пока пользователь явно не сохранит другое.
 */

export const SETTINGS_THEME_VALUES = ["light", "dark", "system"] as const;

export type SettingsTheme = (typeof SETTINGS_THEME_VALUES)[number];

/** Верхняя граница длины строки timezone до любой Intl-проверки. */
export const SETTINGS_TIMEZONE_MAX_LENGTH = 100;

export const DEFAULT_SETTINGS: { timezone: string; theme: SettingsTheme } = {
  timezone: "UTC",
  theme: "system",
};

export function isValidTheme(value: unknown): value is SettingsTheme {
  return (
    typeof value === "string" &&
    (SETTINGS_THEME_VALUES as readonly string[]).includes(value)
  );
}

/**
 * Валидация и канонизация timezone: только именованная зона IANA, известная
 * Intl в текущем runtime, либо UTC. Trim допускается; поддерживаемые named
 * aliases канонизируются через Intl (resolvedOptions), numeric offset формы
 * (+03:00, UTC+3, GMT+3) и неизвестные имена отвергаются. Возвращает null
 * для невалидного значения; default UTC не выводится из browser/locale/IP.
 */
export function resolveCanonicalTimezone(input: unknown): string | null {
  if (typeof input !== "string") {
    return null;
  }
  const trimmed = input.trim();
  if (
    trimmed === "" ||
    trimmed.length > SETTINGS_TIMEZONE_MAX_LENGTH ||
    // Offset-подобные формы не являются именованной IANA зоной аккаунта;
    // "UTC"/"GMT" без суффикса эта проверка не задевает.
    /^(utc|gmt)[+-]/i.test(trimmed) ||
    /^[+-]\d/.test(trimmed)
  ) {
    return null;
  }
  try {
    const format = new Intl.DateTimeFormat("en-US", { timeZone: trimmed });
    return format.resolvedOptions().timeZone;
  } catch {
    return null;
  }
}

export type SettingsPatch = {
  timezone?: string;
  theme?: SettingsTheme;
};

export type SettingsPatchField = "timezone" | "theme";

export type SettingsPatchParseResult =
  | { ok: true; patch: SettingsPatch }
  | { ok: false; field?: SettingsPatchField };

/**
 * Строгий разбор PATCH body: непустой plain object с подмножеством ключей
 * timezone/theme и корректными типами. Неизвестные поля (включая
 * user_id/owner_id/id), null, массивы, пустой object и неверные типы
 * отвергаются; raw input в результат не попадает. Timezone канонизируется.
 */
export function parseSettingsPatch(input: unknown): SettingsPatchParseResult {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return { ok: false };
  }
  const record = input as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.length === 0) {
    return { ok: false };
  }
  const patch: SettingsPatch = {};
  for (const key of keys) {
    if (key !== "timezone" && key !== "theme") {
      return { ok: false };
    }
    const value = record[key];
    if (key === "theme") {
      if (!isValidTheme(value)) {
        return { ok: false, field: "theme" };
      }
      patch.theme = value;
      continue;
    }
    const canonical = resolveCanonicalTimezone(value);
    if (canonical === null) {
      return { ok: false, field: "timezone" };
    }
    patch.timezone = canonical;
  }
  return { ok: true, patch };
}

/** Формат ответа GET/PATCH /api/v1/settings. */
export type AccountSettingsPayload = {
  settings: {
    timezone: string;
    theme: SettingsTheme;
  };
};
