/**
 * Pure civil calendar contracts (TASK-008): DATE YYYY-MM-DD и TIME HH:mm —
 * календарные значения, не UTC event timestamps. Диапазон 1900-01-01..
 * 2199-12-31 (Gregorian); високосные 1900/2100 — не leap, 2000 — leap.
 * instant→local date через явную IANA зону (Intl, gregory/latn, без
 * process.env.TZ); невалидная зона — fail closed. Никаких date libraries.
 */

export const CIVIL_DATE_MIN = "1900-01-01";
export const CIVIL_DATE_MAX = "2199-12-31";

function pad2(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

/** Разбор уже проверенной YYYY-MM-DD в компоненты. */
function toComponents(date: string): { year: number; month: number; day: number } {
  return {
    year: Number(date.slice(0, 4)),
    month: Number(date.slice(5, 7)),
    day: Number(date.slice(8, 10)),
  };
}

function fromComponents(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, "0")}-${pad2(month)}-${pad2(day)}`;
}

export type CivilDateParseResult =
  | { ok: true; value: string }
  | { ok: false };

/**
 * Строгий разбор civil DATE: ровно YYYY-MM-DD, существующий день Gregorian
 * календаря, диапазон 1900-01-01..2199-12-31. Whitespace, coercion, ISO
 * timestamp, offset, пустая строка и не-строчные типы отвергаются.
 */
export function parseCivilDate(input: unknown): CivilDateParseResult {
  if (typeof input !== "string") {
    return { ok: false };
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(input);
  if (match === null) {
    return { ok: false };
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1) {
    return { ok: false };
  }
  // Date.UTC корректно обрабатывает Gregorian високосность (1900/2100 —
  // не leap, 2000 — leap): день 29+ несуществующего февраля даст март.
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (day > lastDay) {
    return { ok: false };
  }
  if (input < CIVIL_DATE_MIN || input > CIVIL_DATE_MAX) {
    return { ok: false };
  }
  return { ok: true, value: input };
}

export type CivilTimeParseResult =
  | { ok: true; value: string }
  | { ok: false };

/** Строгий разбор civil TIME: HH:mm, 00:00..23:59; без seconds/offset/Z. */
export function parseCivilTime(input: unknown): CivilTimeParseResult {
  if (typeof input !== "string") {
    return { ok: false };
  }
  if (/^([01]\d|2[0-3]):[0-5]\d$/.test(input)) {
    return { ok: true, value: input };
  }
  return { ok: false };
}

/** Нормализация PostgreSQL TIME 'HH:mm:ss' (и 'HH:mm') к API 'HH:mm'. */
export function normalizeCivilTime(
  value: string | null | undefined,
): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  return value.slice(0, 5);
}

/**
 * Civil-сдвиг даты на N дней (календарные дни, не 86400000 к instant).
 * Результат обязан оставаться в supported диапазоне, иначе RangeError.
 */
export function addCivilDays(date: string, days: number): string {
  const { year, month, day } = toComponents(date);
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  const value = fromComponents(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth() + 1,
    shifted.getUTCDate(),
  );
  if (value < CIVIL_DATE_MIN || value > CIVIL_DATE_MAX) {
    throw new RangeError(
      `Civil date ${value} is outside the supported range ${CIVIL_DATE_MIN}..${CIVIL_DATE_MAX}.`,
    );
  }
  return value;
}

/**
 * Инклюзивный список из `days` последовательных civil дат от startDate.
 * R5: шаг addCivilDays не выполняется после последнего элемента —
 * диапазон, оканчивающийся на границе supported range (2199-12-31),
 * возвращается без исключения; день за границей по-прежнему отвергается
 * при попытке добавить его в диапазон.
 */
export function civilDateRange(startDate: string, days: number): string[] {
  // R5: старт валидируется как раньше — невалидный формат/вне
  // 1900..2199 отвергается RangeError (раньше это делал первый шаг
  // addCivilDays, который больше не выполняется лишний раз).
  const parsed = parseCivilDate(startDate);
  if (!parsed.ok || parsed.value < CIVIL_DATE_MIN || parsed.value > CIVIL_DATE_MAX) {
    throw new RangeError(
      `Civil date ${startDate} is outside the supported range ${CIVIL_DATE_MIN}..${CIVIL_DATE_MAX}.`,
    );
  }
  const range: string[] = [];
  let cursor = startDate;
  for (let index = 0; index < days; index += 1) {
    if (index > 0) {
      cursor = addCivilDays(cursor, 1);
    }
    range.push(cursor);
  }
  return range;
}

const localDateFormatterCache = new Map<string, Intl.DateTimeFormat>();

/**
 * instant → local civil date в явной IANA зоне (Intl Gregorian/Latin
 * digits). Форматтер кэшируется по зоне; невалидная зона — fail closed
 * (RangeError), никакой зависимости от process.env.TZ.
 */
export function instantToLocalDate(instant: Date, timezone: string): string {
  let formatter = localDateFormatterCache.get(timezone);
  if (formatter === undefined) {
    try {
      formatter = new Intl.DateTimeFormat("en-CA", {
        timeZone: timezone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        calendar: "gregory",
        numberingSystem: "latn",
      });
    } catch {
      throw new RangeError(
        `Unsupported IANA timezone for date conversion: received an invalid zone.`,
      );
    }
    // Fail closed: экзотические ICU-конфигурации, выдающие не-даты.
    const probe = formatter.formatToParts(new Date(0));
    const year = probe.find((part) => part.type === "year")?.value ?? "";
    const month = probe.find((part) => part.type === "month")?.value ?? "";
    const day = probe.find((part) => part.type === "day")?.value ?? "";
    if (!/^\d{4}$/.test(year) || !/^\d{2}$/.test(month) || !/^\d{2}$/.test(day)) {
      throw new RangeError(
        `Unsupported IANA timezone for date conversion: formatter produced non-civil output.`,
      );
    }
    localDateFormatterCache.set(timezone, formatter);
  }
  const parts = formatter.formatToParts(instant);
  const year = parts.find((part) => part.type === "year")?.value ?? "";
  const month = parts.find((part) => part.type === "month")?.value ?? "";
  const day = parts.find((part) => part.type === "day")?.value ?? "";
  const value = `${year}-${month}-${day}`;
  if (parseCivilDate(value).ok === false) {
    throw new RangeError(
      `Unsupported IANA timezone for date conversion: produced invalid civil date.`,
    );
  }
  return value;
}

/** Отображение civil DATE как DD.MM.YYYY (перестановка строк, без Date). */
export function formatCivilDateDisplay(date: string): string {
  return `${date.slice(8, 10)}.${date.slice(5, 7)}.${date.slice(0, 4)}`;
}
