/**
 * Чистые view-model helpers для Today/Upcoming (TASK-008): группировка и
 * сортировка внутри секций. Входные списки уже owner-scoped/filtered и
 * отсортированы стабильно (sort_order/created_at/id) сервером; JS sort
 * стабилен, поэтому tie-break наследуется от входного порядка.
 * R7: ранг и внутриранговый порядок Today — единый контракт для UI и
 * raw API (compareTodayOrder), второго расходящегося comparator нет.
 */

import type { TaskDTO } from "./tasks";

export type TodaySectionKey =
  | "planOverdue"
  | "planToday"
  | "deadlineOverdue"
  | "deadlineToday";

/** Минимальная форма задачи, достаточная для Today-порядка (R7). */
export type TodayOrderable = Pick<
  TaskDTO,
  "plannedDate" | "plannedTime" | "deadlineDate"
>;

export type TodaySection = {
  rank: 1 | 2 | 3 | 4;
  key: TodaySectionKey;
  tasks: TaskDTO[];
};

/**
 * Взаимоисключающая секция задачи на Today: каждая task максимум в одной
 * секции по приоритету plan<today → plan=today → deadline<today →
 * deadline=today. null — не входит в Today (future/undated вне deadline).
 */
export function todaySectionOf(
  task: TodayOrderable,
  today: string,
): 1 | 2 | 3 | 4 | null {
  if (task.plannedDate !== null && task.plannedDate < today) {
    return 1;
  }
  if (task.plannedDate !== null && task.plannedDate === today) {
    return 2;
  }
  if (task.deadlineDate !== null && task.deadlineDate < today) {
    return 3;
  }
  if (task.deadlineDate !== null && task.deadlineDate === today) {
    return 4;
  }
  return null;
}

function compareCivilAsc(a: string, b: string): number {
  if (a === b) {
    return 0;
  }
  return a < b ? -1 : 1;
}

function byPlannedDateTimeThenStable(a: TodayOrderable, b: TodayOrderable): number {
  const date = compareCivilAsc(a.plannedDate ?? "", b.plannedDate ?? "");
  if (date !== 0) {
    return date;
  }
  // NULLS LAST
  if (a.plannedTime === null && b.plannedTime !== null) {
    return 1;
  }
  if (a.plannedTime !== null && b.plannedTime === null) {
    return -1;
  }
  if (a.plannedTime !== null && b.plannedTime !== null && a.plannedTime !== b.plannedTime) {
    return a.plannedTime < b.plannedTime ? -1 : 1;
  }
  return 0;
}

function byPlannedTimeThenStable(a: TodayOrderable, b: TodayOrderable): number {
  if (a.plannedTime === null && b.plannedTime !== null) {
    return 1;
  }
  if (a.plannedTime !== null && b.plannedTime === null) {
    return -1;
  }
  if (a.plannedTime !== null && b.plannedTime !== null && a.plannedTime !== b.plannedTime) {
    return a.plannedTime < b.plannedTime ? -1 : 1;
  }
  return 0;
}

function byDeadlineThenStable(a: TodayOrderable, b: TodayOrderable): number {
  const deadline = compareCivilAsc(a.deadlineDate ?? "", b.deadlineDate ?? "");
  if (deadline !== 0) {
    return deadline;
  }
  return 0;
}

/**
 * R7: единый компаратор Today-порядка для UI и raw API — ранг 1..4
 * (plan<today → plan=today → deadline<today → deadline=today), затем
 * внутриранговый порядок контракта (rank1 plannedDate+time NULLS LAST,
 * rank2 time NULLS LAST, rank3 deadlineDate, rank4 stable). Ноль на
 * tie: стабильная сортировка сохраняет входной порядок
 * sort_order/created_at/id.
 */
export function compareTodayOrder(
  a: TodayOrderable,
  b: TodayOrderable,
  today: string,
): number {
  const rankA = todaySectionOf(a, today);
  const rankB = todaySectionOf(b, today);
  if (rankA !== rankB) {
    return (rankA ?? 5) - (rankB ?? 5);
  }
  if (rankA === 1) {
    return byPlannedDateTimeThenStable(a, b);
  }
  if (rankA === 2) {
    return byPlannedTimeThenStable(a, b);
  }
  if (rankA === 3) {
    return byDeadlineThenStable(a, b);
  }
  // rank4 (и вне Today — не сравнивается на экране): stable.
  return 0;
}

const SECTION_KEYS: TodaySectionKey[] = [
  "planOverdue",
  "planToday",
  "deadlineOverdue",
  "deadlineToday",
];

/**
 * Четыре взаимоисключающие секции Today по приоритету 1..4; каждая task
 * ровно один раз. Сортировки внутри секций — единый компаратор
 * compareTodayOrder (ранг внутри секции одинаков, tie-break стабильный
 * из входного порядка).
 */
export function groupTodayTasks(
  tasks: TaskDTO[],
  today: string,
): TodaySection[] {
  const sections: TodaySection[] = SECTION_KEYS.map((key, index) => ({
    rank: (index + 1) as 1 | 2 | 3 | 4,
    key,
    tasks: [],
  }));
  for (const task of tasks) {
    const rank = todaySectionOf(task, today);
    if (rank !== null) {
      sections[rank - 1].tasks.push(task);
    }
  }
  for (const section of sections) {
    section.tasks.sort((a, b) => compareTodayOrder(a, b, today));
  }
  return sections.filter((section) => section.key !== undefined);
}

export type UpcomingDayGroup = {
  date: string;
  tasks: TaskDTO[];
};

/**
 * Группировка Upcoming по plannedDate в инклюзивном диапазоне
 * [startDate..endDate]; ровно (дней в диапазоне) групп, даже если день
 * пуст; сортировка внутри группы plannedTime ASC NULLS LAST + stable.
 * Deadline-only задачи в диапазон не попадают (plannedDate null).
 */
export function groupUpcomingTasks(
  tasks: TaskDTO[],
  startDate: string,
  endDate: string,
): UpcomingDayGroup[] {
  const groups: UpcomingDayGroup[] = [];
  const byDate = new Map<string, TaskDTO[]>();
  for (const task of tasks) {
    if (
      task.plannedDate === null ||
      task.plannedDate < startDate ||
      task.plannedDate > endDate
    ) {
      continue;
    }
    const bucket = byDate.get(task.plannedDate);
    if (bucket === undefined) {
      byDate.set(task.plannedDate, [task]);
    } else {
      bucket.push(task);
    }
  }
  let cursor = startDate;
  while (cursor <= endDate) {
    groups.push({ date: cursor, tasks: byDate.get(cursor) ?? [] });
    const next = addOneCivilDay(cursor);
    if (next === null) {
      break;
    }
    cursor = next;
  }
  for (const group of groups) {
    group.tasks.sort(byPlannedTimeThenStable);
  }
  return groups;
}

function addOneCivilDay(date: string): string | null {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  const day = Number(date.slice(8, 10));
  const shifted = new Date(Date.UTC(year, month - 1, day + 1));
  const value = `${String(shifted.getUTCFullYear()).padStart(4, "0")}-${String(
    shifted.getUTCMonth() + 1,
  ).padStart(2, "0")}-${String(shifted.getUTCDate()).padStart(2, "0")}`;
  if (value > "2199-12-31") {
    return null;
  }
  return value;
}
