import { describe, expect, test } from "vitest";
import {
  CIVIL_DATE_MAX,
  CIVIL_DATE_MIN,
  addCivilDays,
  civilDateRange,
  formatCivilDateDisplay,
  instantToLocalDate,
  parseCivilDate,
  parseCivilTime,
} from "../src/lib/calendar";
import type { TaskDTO } from "../src/lib/tasks";
import {
  compareTodayOrder,
  groupTodayTasks,
  groupUpcomingTasks,
  todaySectionOf,
} from "../src/lib/task-view";

/**
 * Pure calendar и view-model тесты (TASK-008 фаза A): strict civil
 * DATE/TIME, границы/високосность, civil addDays, instant→local date в
 * разных зонах (один instant), Today 4 секции без дублей, Upcoming 7
 * инклюзивных дней. Fixed instant — никакого чтения часов.
 */

describe("parseCivilDate", () => {
  test("valid: границы и високосность Gregorian", () => {
    expect(parseCivilDate("1900-01-01")).toEqual({ ok: true, value: "1900-01-01" });
    expect(parseCivilDate("2199-12-31")).toEqual({ ok: true, value: "2199-12-31" });
    expect(parseCivilDate("2000-02-29").ok).toBe(true); // leap (div 400)
    expect(parseCivilDate("2024-02-29").ok).toBe(true); // leap (div 4)
    expect(parseCivilDate("1900-02-29").ok).toBe(false); // не leap (div 100)
    expect(parseCivilDate("2100-02-29").ok).toBe(false); // не leap (div 100)
    expect(parseCivilDate("2026-04-30").ok).toBe(true);
    expect(parseCivilDate("2026-04-31").ok).toBe(false);
  });

  test("negative: формат/коэрция/timestamp/offset/пробелы", () => {
    expect(parseCivilDate("2026-1-5").ok).toBe(false);
    expect(parseCivilDate(" 2026-01-05").ok).toBe(false);
    expect(parseCivilDate("2026-01-05 ").ok).toBe(false);
    expect(parseCivilDate("2026-01-05T00:00:00Z").ok).toBe(false);
    expect(parseCivilDate("2026-01-05+03:00").ok).toBe(false);
    expect(parseCivilDate("2026-13-01").ok).toBe(false);
    expect(parseCivilDate("2026-00-10").ok).toBe(false);
    expect(parseCivilDate("2026-01-00").ok).toBe(false);
    expect(parseCivilDate("").ok).toBe(false);
    expect(parseCivilDate(42).ok).toBe(false);
    expect(parseCivilDate(null).ok).toBe(false);
    expect(parseCivilDate(undefined).ok).toBe(false);
    expect(parseCivilDate(["2026-01-05"]).ok).toBe(false);
  });

  test("диапазон 1900-01-01..2199-12-31", () => {
    expect(parseCivilDate("1899-12-31").ok).toBe(false);
    expect(parseCivilDate("2200-01-01").ok).toBe(false);
    expect(CIVIL_DATE_MIN).toBe("1900-01-01");
    expect(CIVIL_DATE_MAX).toBe("2199-12-31");
  });
});

describe("parseCivilTime", () => {
  test("valid HH:mm", () => {
    expect(parseCivilTime("00:00")).toEqual({ ok: true, value: "00:00" });
    expect(parseCivilTime("23:59")).toEqual({ ok: true, value: "23:59" });
    expect(parseCivilTime("09:05")).toEqual({ ok: true, value: "09:05" });
  });

  test("negative: seconds/offset/границы/типы", () => {
    expect(parseCivilTime("24:00").ok).toBe(false);
    expect(parseCivilTime("12:60").ok).toBe(false);
    expect(parseCivilTime("12:30:00").ok).toBe(false);
    expect(parseCivilTime("12:30Z").ok).toBe(false);
    expect(parseCivilTime("9:30").ok).toBe(false);
    expect(parseCivilTime("").ok).toBe(false);
    expect(parseCivilTime(null).ok).toBe(false);
    expect(parseCivilTime(930).ok).toBe(false);
  });
});

describe("addCivilDays / civilDateRange", () => {
  test("civil дни: месяц/год/високосность", () => {
    expect(addCivilDays("2026-01-31", 1)).toBe("2026-02-01");
    expect(addCivilDays("2025-12-31", 1)).toBe("2026-01-01");
    expect(addCivilDays("2024-02-28", 1)).toBe("2024-02-29");
    expect(addCivilDays("2024-02-29", 1)).toBe("2024-03-01");
    expect(addCivilDays("1900-02-28", 1)).toBe("1900-03-01");
    expect(addCivilDays("2100-02-28", 1)).toBe("2100-03-01");
    expect(addCivilDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(addCivilDays("2026-06-15", 7)).toBe("2026-06-22");
  });

  test("выход за supported диапазон → RangeError", () => {
    expect(() => addCivilDays("2199-12-31", 1)).toThrow(RangeError);
    expect(() => addCivilDays("1900-01-01", -1)).toThrow(RangeError);
  });

  test("civilDateRange инклюзивный", () => {
    expect(civilDateRange("2026-01-30", 3)).toEqual([
      "2026-01-30",
      "2026-01-31",
      "2026-02-01",
    ]);
  });

  test("R5: civilDateRange на верхней границе — ровно 7 дней без исключения", () => {
    // Шаг после последнего элемента больше не выполняется.
    expect(civilDateRange("2199-12-25", 7)).toEqual([
      "2199-12-25",
      "2199-12-26",
      "2199-12-27",
      "2199-12-28",
      "2199-12-29",
      "2199-12-30",
      "2199-12-31",
    ]);
  });

  test("R5: одноэлементный диапазон на верхней границе", () => {
    expect(civilDateRange("2199-12-31", 1)).toEqual(["2199-12-31"]);
  });

  test("R5: civilDateRange на нижней границе — 1900-01-01..07", () => {
    expect(civilDateRange("1900-01-01", 7)).toEqual([
      "1900-01-01",
      "1900-01-02",
      "1900-01-03",
      "1900-01-04",
      "1900-01-05",
      "1900-01-06",
      "1900-01-07",
    ]);
  });

  test("R5: диапазон, реально выходящий за supported range, отвергается", () => {
    // 2199-12-26..2200-01-01 — последний день за границей.
    expect(() => civilDateRange("2199-12-26", 7)).toThrow(RangeError);
    expect(() => civilDateRange("2199-12-31", 2)).toThrow(RangeError);
    // Старт до границы.
    expect(() => civilDateRange("1899-12-31", 7)).toThrow(RangeError);
  });

  test("R7: compareTodayOrder — ранги и внутриранговый порядок контракта", () => {
    const today = "2026-06-15";
    const planOverdue09 = {
      plannedDate: "2026-06-14",
      plannedTime: "09:00",
      deadlineDate: null,
    };
    const planOverdueNull = {
      plannedDate: "2026-06-14",
      plannedTime: null,
      deadlineDate: null,
    };
    const planEarlier = {
      plannedDate: "2026-06-13",
      plannedTime: "10:00",
      deadlineDate: null,
    };
    const planToday = {
      plannedDate: "2026-06-15",
      plannedTime: null,
      deadlineDate: null,
    };
    // rank3: plan future не влияет — порядок только по deadline.
    const deadlineOverdueFuturePlan = {
      plannedDate: "2026-07-01",
      plannedTime: null,
      deadlineDate: "2026-06-10",
    };
    const deadlineOverdueEarlier = {
      plannedDate: null,
      plannedTime: null,
      deadlineDate: "2026-06-09",
    };
    const deadlineToday = {
      plannedDate: null,
      plannedTime: null,
      deadlineDate: "2026-06-15",
    };

    // Ранги: plan<today → plan=today → deadline<today → deadline=today.
    expect(compareTodayOrder(planOverdue09, planToday, today)).toBeLessThan(0);
    expect(
      compareTodayOrder(planToday, deadlineOverdueFuturePlan, today),
    ).toBeLessThan(0);
    expect(
      compareTodayOrder(deadlineOverdueFuturePlan, deadlineToday, today),
    ).toBeLessThan(0);
    // rank1: более ранняя plannedDate прежде поздней; time NULLS LAST.
    expect(compareTodayOrder(planEarlier, planOverdue09, today)).toBeLessThan(0);
    expect(
      compareTodayOrder(planOverdue09, planOverdueNull, today),
    ).toBeLessThan(0);
    // rank3: deadline раньше прежде поздней, planned future не влияет.
    expect(
      compareTodayOrder(deadlineOverdueEarlier, deadlineOverdueFuturePlan, today),
    ).toBeLessThan(0);
    // rank4/tie: ноль — стабильный входной порядок (sort_order/created_at/id).
    expect(compareTodayOrder(deadlineToday, deadlineToday, today)).toBe(0);
  });
});

describe("instantToLocalDate", () => {
  // Один фиксированный instant: 2026-06-15T16:30:00Z.
  const instant = new Date("2026-06-15T16:30:00.000Z");

  test("один instant в разных зонах даёт корректные local dates", () => {
    expect(instantToLocalDate(instant, "UTC")).toBe("2026-06-15");
    expect(instantToLocalDate(instant, "Asia/Tokyo")).toBe("2026-06-16"); // 01:30+1
    expect(instantToLocalDate(instant, "America/Los_Angeles")).toBe("2026-06-15"); // 09:30
    expect(instantToLocalDate(instant, "Asia/Kolkata")).toBe("2026-06-15"); // 22:00 (+5:30)
  });

  test("граница суток: UTC до полуночи, Tokyo после", () => {
    const nearMidnight = new Date("2026-06-15T15:59:00.000Z");
    expect(instantToLocalDate(nearMidnight, "UTC")).toBe("2026-06-15");
    expect(instantToLocalDate(nearMidnight, "Asia/Tokyo")).toBe("2026-06-16"); // 00:59+1
    expect(instantToLocalDate(nearMidnight, "America/Los_Angeles")).toBe(
      "2026-06-15",
    ); // 08:59
  });

  test("DST-переход зональный, не сдвигает civil дату произвольно", () => {
    // 2026-03-08 — DST switch в America/Los_Angeles (02:00→03:00 local).
    const duringGap = new Date("2026-03-08T10:30:00.000Z");
    expect(instantToLocalDate(duringGap, "America/Los_Angeles")).toBe("2026-03-08");
    expect(instantToLocalDate(duringGap, "UTC")).toBe("2026-03-08");
  });

  test("невалидная зона → fail closed", () => {
    expect(() => instantToLocalDate(instant, "Mars/Olympus")).toThrow(RangeError);
    expect(() => instantToLocalDate(instant, "")).toThrow(RangeError);
  });

  test("R6: fixed-instant одинаковый/разный день UTC vs Moscow/Tokyo", () => {
    // Одинаковый день: 2026-01-15T12:00:00Z → 15-е и в UTC, и в Moscow (+3).
    const noon = new Date("2026-01-15T12:00:00.000Z");
    expect(instantToLocalDate(noon, "UTC")).toBe("2026-01-15");
    expect(instantToLocalDate(noon, "Europe/Moscow")).toBe("2026-01-15");
    // Разные дни: 2026-01-15T22:30:00Z → UTC 2026-01-15, Moscow/Tokyo
    // уже 2026-01-16. Явные ожидаемые literals.
    const evening = new Date("2026-01-15T22:30:00.000Z");
    expect(instantToLocalDate(evening, "UTC")).toBe("2026-01-15");
    expect(instantToLocalDate(evening, "Europe/Moscow")).toBe("2026-01-16");
    expect(instantToLocalDate(evening, "Asia/Tokyo")).toBe("2026-01-16");
  });

  test("независимость от process TZ: результат только от явной зоны", () => {
    const previous = process.env.TZ;
    try {
      process.env.TZ = "Pacific/Kiritimati";
      expect(instantToLocalDate(instant, "UTC")).toBe("2026-06-15");
      expect(instantToLocalDate(instant, "Asia/Tokyo")).toBe("2026-06-16");
    } finally {
      if (previous === undefined) {
        delete process.env.TZ;
      } else {
        process.env.TZ = previous;
      }
    }
  });
});

describe("formatCivilDateDisplay", () => {
  test("DD.MM.YYYY без Date/сдвига", () => {
    expect(formatCivilDateDisplay("2026-06-15")).toBe("15.06.2026");
    expect(formatCivilDateDisplay("1900-01-01")).toBe("01.01.1900");
  });
});

function task(
  id: string,
  fields: { plannedDate?: string | null; plannedTime?: string | null; deadlineDate?: string | null },
): TaskDTO {
  const timestamp = "2026-01-01T00:00:00.000Z";
  return {
    id,
    title: id,
    projectId: null,
    parentId: null,
    plannedDate: fields.plannedDate ?? null,
    plannedTime: fields.plannedTime ?? null,
    deadlineDate: fields.deadlineDate ?? null,
    completedAt: null,
    revision: 0,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

const TODAY = "2026-06-15";

describe("groupTodayTasks", () => {
  test("матрица planned × deadline → секция/исключение, каждая task один раз", () => {
    const cases: Array<{
      planned: string | null;
      deadline: string | null;
      expected: 1 | 2 | 3 | 4 | null;
    }> = [
      { planned: "2026-06-14", deadline: null, expected: 1 },
      { planned: "2026-06-14", deadline: "2026-06-15", expected: 1 },
      { planned: "2026-06-14", deadline: "2026-06-16", expected: 1 },
      { planned: "2026-06-14", deadline: "2026-06-14", expected: 1 },
      { planned: TODAY, deadline: null, expected: 2 },
      { planned: TODAY, deadline: "2026-06-14", expected: 2 },
      { planned: TODAY, deadline: TODAY, expected: 2 },
      { planned: TODAY, deadline: "2026-06-20", expected: 2 },
      { planned: null, deadline: "2026-06-14", expected: 3 },
      { planned: "2026-06-20", deadline: "2026-06-14", expected: 3 },
      { planned: null, deadline: TODAY, expected: 4 },
      { planned: "2026-06-20", deadline: TODAY, expected: 4 },
      { planned: null, deadline: null, expected: null },
      { planned: "2026-06-16", deadline: null, expected: null },
      { planned: null, deadline: "2026-06-16", expected: null },
      { planned: "2026-06-16", deadline: "2026-06-16", expected: null },
    ];
    const tasks = cases.map((c, index) =>
      task(`id-${index}`, { plannedDate: c.planned, deadlineDate: c.deadline }),
    );
    const sections = groupTodayTasks(tasks, TODAY);
    expect(sections.length).toBe(4);
    // Каждая включённая задача ровно один раз.
    const all = sections.flatMap((s) => s.tasks.map((t) => t.id));
    expect(new Set(all).size).toBe(all.length);
    const included = cases.filter((c) => c.expected !== null).length;
    expect(all.length).toBe(included);
    // Секция каждой задачи соответствует приоритету.
    for (const c of cases) {
      if (c.expected === null) {
        continue;
      }
      const section = sections[c.expected - 1];
      const index = cases.indexOf(c);
      expect(
        section.tasks.some((t) => t.id === `id-${index}`),
        `case ${JSON.stringify(c)}`,
      ).toBe(true);
    }
    // Пустых секций в результате 4 (структура фиксирована).
    expect(sections.map((s) => s.key)).toEqual([
      "planOverdue",
      "planToday",
      "deadlineOverdue",
      "deadlineToday",
    ]);
  });

  test("todaySectionOf прямые проверки", () => {
    const past = task("a", { plannedDate: "2026-06-10" });
    expect(todaySectionOf(past, TODAY)).toBe(1);
    const deadlineOnlyToday = task("b", { deadlineDate: TODAY });
    expect(todaySectionOf(deadlineOnlyToday, TODAY)).toBe(4);
    const future = task("c", { plannedDate: "2026-06-20" });
    expect(todaySectionOf(future, TODAY)).toBeNull();
  });

  test("сортировки: planned ASC, time NULLS LAST, deadline ASC, stable tie", () => {
    const s1 = groupTodayTasks(
      [
        task("b", { plannedDate: "2026-06-14", plannedTime: "09:00" }),
        task("a", { plannedDate: "2026-06-13" }),
        task("c", { plannedDate: "2026-06-14" }), // NULLS LAST
      ],
      TODAY,
    )[0];
    expect(s1.tasks.map((t) => t.id)).toEqual(["a", "b", "c"]);

    const s2 = groupTodayTasks(
      [
        task("y", { plannedDate: TODAY }), // NULLS LAST
        task("x", { plannedDate: TODAY, plannedTime: "08:00" }),
      ],
      TODAY,
    )[1];
    expect(s2.tasks.map((t) => t.id)).toEqual(["x", "y"]);

    const s3 = groupTodayTasks(
      [
        task("d2", { deadlineDate: "2026-06-11" }),
        task("d1", { deadlineDate: "2026-06-10" }),
      ],
      TODAY,
    )[2];
    expect(s3.tasks.map((t) => t.id)).toEqual(["d1", "d2"]);
  });
});

describe("groupUpcomingTasks", () => {
  test("7 инклюзивных дней, вне диапазона исключены, пустые группы сохранены", () => {
    const tasks = [
      task("in-start", { plannedDate: "2026-06-15" }),
      task("in-mid", { plannedDate: "2026-06-18", plannedTime: "10:00" }),
      task("in-end", { plannedDate: "2026-06-21" }),
      task("before", { plannedDate: "2026-06-14" }),
      task("after", { plannedDate: "2026-06-22" }),
      task("deadline-only", { deadlineDate: "2026-06-17" }),
    ];
    const groups = groupUpcomingTasks(tasks, "2026-06-15", "2026-06-21");
    expect(groups.length).toBe(7);
    expect(groups[0].date).toBe("2026-06-15");
    expect(groups[0].tasks.map((t) => t.id)).toEqual(["in-start"]);
    expect(groups[3].date).toBe("2026-06-18");
    expect(groups[3].tasks.map((t) => t.id)).toEqual(["in-mid"]);
    expect(groups[6].date).toBe("2026-06-21");
    expect(groups[6].tasks.map((t) => t.id)).toEqual(["in-end"]);
    // Пустые дни присутствуют как пустые группы.
    expect(groups[1].tasks).toEqual([]);
    expect(groups[2].tasks).toEqual([]);
  });

  test("time NULLS LAST внутри группы", () => {
    const groups = groupUpcomingTasks(
      [
        task("late", { plannedDate: "2026-06-15", plannedTime: "20:00" }),
        task("nodate-time", { plannedDate: "2026-06-15" }),
        task("early", { plannedDate: "2026-06-15", plannedTime: "07:00" }),
      ],
      "2026-06-15",
      "2026-06-21",
    );
    expect(groups[0].tasks.map((t) => t.id)).toEqual(["early", "late", "nodate-time"]);
  });
});
