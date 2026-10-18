import { describe, expect, test } from "vitest";
import {
  DEFAULT_SETTINGS,
  SETTINGS_THEME_VALUES,
  SETTINGS_TIMEZONE_MAX_LENGTH,
  isValidTheme,
  parseSettingsPatch,
  resolveCanonicalTimezone,
} from "@/lib/settings";

/**
 * Pure-контракты settings (TASK-005): theme enum, канонизация IANA timezone
 * через Intl runtime, строгий разбор PATCH body. Без БД/env — часть быстрого
 * npm test suite; HTTP/DB поведение покрыто отдельной integration suite.
 */

describe("isValidTheme", () => {
  test("допускает только строгий enum light/dark/system", () => {
    expect([...SETTINGS_THEME_VALUES].sort()).toEqual(["dark", "light", "system"]);
    for (const value of SETTINGS_THEME_VALUES) {
      expect(isValidTheme(value)).toBe(true);
    }
    expect(isValidTheme("blue")).toBe(false);
    expect(isValidTheme("LIGHT")).toBe(false);
    expect(isValidTheme("")).toBe(false);
    expect(isValidTheme(null)).toBe(false);
    expect(isValidTheme(1)).toBe(false);
    expect(isValidTheme(undefined)).toBe(false);
  });
});

describe("resolveCanonicalTimezone", () => {
  test("positive: UTC и именованные IANA зоны", () => {
    expect(resolveCanonicalTimezone("UTC")).toBe("UTC");
    expect(resolveCanonicalTimezone("Europe/Moscow")).toBe("Europe/Moscow");
    expect(resolveCanonicalTimezone("America/New_York")).toBe(
      "America/New_York",
    );
    expect(resolveCanonicalTimezone("Asia/Tokyo")).toBe("Asia/Tokyo");
  });

  test("trim и регистр: канонизируется через Intl", () => {
    expect(resolveCanonicalTimezone("  Asia/Tokyo  ")).toBe("Asia/Tokyo");
    // Intl сравнивает имена зон без учёта регистра; сохраняется
    // каноническое resolved значение.
    expect(resolveCanonicalTimezone(" europe/moscow ")).toBe("Europe/Moscow");
  });

  test("поддерживаемые named aliases канонизируются в одну зону", () => {
    const alias = resolveCanonicalTimezone("Asia/Calcutta");
    const canonical = resolveCanonicalTimezone("Asia/Kolkata");
    // aliases и canonical имена указывают на одну зону; результат —
    // resolved Intl идентификатор, одинаковый для обоих написаний.
    expect(alias).not.toBeNull();
    expect(alias).toBe(canonical);
  });

  test("negative: offset-подобные формы, неизвестные имена, мусор", () => {
    expect(resolveCanonicalTimezone("")).toBeNull();
    expect(resolveCanonicalTimezone("   ")).toBeNull();
    expect(resolveCanonicalTimezone("Mars")).toBeNull();
    expect(resolveCanonicalTimezone("Olympus")).toBeNull();
    expect(resolveCanonicalTimezone("+03:00")).toBeNull();
    expect(resolveCanonicalTimezone("UTC+3")).toBeNull();
    expect(resolveCanonicalTimezone("GMT+3")).toBeNull();
    expect(resolveCanonicalTimezone("-08:00")).toBeNull();
    expect(resolveCanonicalTimezone("Z")).toBeNull();
    expect(resolveCanonicalTimezone("З")).toBeNull();
    expect(resolveCanonicalTimezone("Europe/Moscow; DROP TABLE user_settings")).toBeNull();
  });

  test("ограничение длины до Intl-проверки", () => {
    expect(resolveCanonicalTimezone("A".repeat(SETTINGS_TIMEZONE_MAX_LENGTH + 1))).toBeNull();
    expect(SETTINGS_TIMEZONE_MAX_LENGTH).toBe(100);
  });

  test("не-строковые типы отвергаются без исключений", () => {
    expect(resolveCanonicalTimezone(null)).toBeNull();
    expect(resolveCanonicalTimezone(42)).toBeNull();
    expect(resolveCanonicalTimezone({})).toBeNull();
    expect(resolveCanonicalTimezone(["UTC"])).toBeNull();
    expect(resolveCanonicalTimezone(undefined)).toBeNull();
  });
});

describe("parseSettingsPatch", () => {
  test("valid: каждое поле по отдельности и вместе", () => {
    expect(parseSettingsPatch({ theme: "dark" })).toEqual({
      ok: true,
      patch: { theme: "dark" },
    });
    expect(parseSettingsPatch({ timezone: "Asia/Tokyo" })).toEqual({
      ok: true,
      patch: { timezone: "Asia/Tokyo" },
    });
    expect(parseSettingsPatch({ timezone: "UTC", theme: "system" })).toEqual({
      ok: true,
      patch: { timezone: "UTC", theme: "system" },
    });
  });

  test("timezone канонизируется при разборе", () => {
    expect(parseSettingsPatch({ timezone: " asia/tokyo " })).toEqual({
      ok: true,
      patch: { timezone: "Asia/Tokyo" },
    });
  });

  test("invalid: пустой object, неизвестные/identity поля, типы, enum", () => {
    expect(parseSettingsPatch({}).ok).toBe(false);
    expect(parseSettingsPatch([]).ok).toBe(false);
    expect(parseSettingsPatch(null).ok).toBe(false);
    expect(parseSettingsPatch("UTC").ok).toBe(false);
    expect(parseSettingsPatch(42).ok).toBe(false);
    expect(parseSettingsPatch(undefined).ok).toBe(false);
    expect(parseSettingsPatch({ theme: "dark", extra: 1 }).ok).toBe(false);
    expect(parseSettingsPatch({ user_id: "someone" })).toEqual({ ok: false });
    expect(parseSettingsPatch({ owner_id: "someone", theme: "light" }).ok).toBe(false);
    expect(parseSettingsPatch({ id: "x", timezone: "UTC" }).ok).toBe(false);
    expect(parseSettingsPatch({ timezone: 5 })).toEqual({
      ok: false,
      field: "timezone",
    });
    expect(parseSettingsPatch({ timezone: null })).toEqual({
      ok: false,
      field: "timezone",
    });
    expect(parseSettingsPatch({ timezone: ["UTC"] })).toEqual({
      ok: false,
      field: "timezone",
    });
    expect(parseSettingsPatch({ theme: "blue" })).toEqual({
      ok: false,
      field: "theme",
    });
    expect(parseSettingsPatch({ theme: null })).toEqual({
      ok: false,
      field: "theme",
    });
    // Ошибка одного поля не маскируется другим валидным.
    expect(parseSettingsPatch({ theme: "dark", timezone: "Mars" })).toEqual({
      ok: false,
      field: "timezone",
    });
  });
});

describe("DEFAULT_SETTINGS", () => {
  test("новый аккаунт: UTC/system, без наследования чужой локальной темы", () => {
    expect(DEFAULT_SETTINGS).toEqual({ timezone: "UTC", theme: "system" });
  });
});
