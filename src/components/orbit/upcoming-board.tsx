"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { TaskItemsList } from "@/components/orbit/task-items-list";
import { useTaskWrites } from "@/components/orbit/use-task-writes";
import type { TaskDTO } from "@/lib/tasks";
import { addCivilDays, formatCivilDateDisplay } from "@/lib/calendar";
import { groupUpcomingTasks, type UpcomingDayGroup } from "@/lib/task-view";
import { ru } from "@/lib/i18n/ru";

type StatusMode = "open" | "completed" | "all";

type UpcomingPayload = {
  tasks: TaskDTO[];
  context: {
    timezone: string;
    today: string;
    asOf: string;
    startDate?: string;
    endDate?: string;
  };
};

/**
 * Реальный экран Предстоящее (TASK-008): 7 инклюзивных civil-day групп по
 * plannedDate, prev/next/current навигация с диапазоном в URL
 * (history.replaceState — reload сохраняет диапазон через SSR), complete/
 * reopen в completed-режиме с нейтральными датами, shared rows/actions
 * через useTaskWrites. Quick-add отсутствует по scope; latest request
 * wins (requestSeq), stale suppression по mounted/actor. R2b2: status и
 * диапазон не меняются при pending записи или открытой форме — disabled по
 * реактивным флагам и синхронный ref-guard в switchMode/navigate до
 * setState/refetch/replaceState; failed Save держит mode lock (форма
 * открыта), Cancel/успешный Save освобождают. listPending политика
 * prev/next/current сохранена; sequencing чтений — R3. R5: переходы
 * разрешены только в полностью допустимое окно (start..start+6 в
 * 1900..2199) — prev/next disabled на границах, guard до effects,
 * вычисление доступности на render без исключений.
 */
export function UpcomingBoard({
  initialTasks,
  initialTimezone,
  initialToday,
  initialAsOf,
  initialStart,
  actorId,
}: {
  initialTasks: TaskDTO[];
  initialTimezone: string;
  initialToday: string;
  initialAsOf: string;
  initialStart: string;
  actorId: string;
}) {
  const [tasks, setTasks] = useState(initialTasks);
  const [context, setContext] = useState({
    timezone: initialTimezone,
    today: initialToday,
    asOf: initialAsOf,
  });
  const [startDate, setStartDate] = useState(initialStart);
  const [statusMode, setStatusMode] = useState<StatusMode>("open");
  const [listError, setListError] = useState(false);
  const [listPending, setListPending] = useState(false);

  const mountedRef = useRef(true);
  const actorRef = useRef(actorId);
  const requestSeqRef = useRef(0);

  useEffect(() => {
    actorRef.current = actorId;
  }, [actorId]);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const refetch = useCallback(
    async (mode: StatusMode, rangeStart: string): Promise<boolean> => {
      const requestedActorId = actorRef.current;
      setListPending(true);
      const requestSeq = ++requestSeqRef.current;
      // R3a: исход read применяется только если запрос всё ещё latest —
      // mounted + actor + latest seq, проверяемые после КАЖДОГО await
      // (fetch, JSON parsing), в catch и finally; stale исход ничего не
      // записывает и не снимает pending нового запроса.
      const stillLatest = (): boolean =>
        mountedRef.current &&
        actorRef.current === requestedActorId &&
        requestSeq === requestSeqRef.current;
      try {
        const response = await fetch(
          `/api/v1/tasks?view=upcoming&status=${mode}&start=${rangeStart}`,
        );
        if (!stillLatest()) {
          return false;
        }
        if (!response.ok) {
          setListError(true);
          return false;
        }
        const payload = (await response.json()) as UpcomingPayload;
        // R3a: stale response.json() не перезаписывает tasks/context
        // уже применённого нового read.
        if (!stillLatest()) {
          return false;
        }
        setTasks(payload.tasks);
        setContext({
          timezone: payload.context.timezone,
          today: payload.context.today,
          asOf: payload.context.asOf,
        });
        setListError(false);
        return true;
      } catch {
        // Stale network/JSON reject не показывает ложную ошибку нового read.
        if (stillLatest()) {
          setListError(true);
        }
        return false;
      } finally {
        // Stale finally не снимает pending выполняющегося нового read.
        if (stillLatest()) {
          setListPending(false);
        }
      }
    },
    [],
  );

  const writes = useTaskWrites({
    actorId,
    // Upcoming без create input: логичный control после delete — «Обновить».
    createFocusElementId: "upcoming-refresh-button",
    onConfirmed: useCallback(
      () => refetch(statusMode, startDate),
      [refetch, statusMode, startDate],
    ),
  });

  // R5: весь destination window (newStart..newStart+6) должен попадать в
  // supported range 1900..2199; addCivilDays бросает за границами —
  // перехватываем и возвращаем false (никогда не бросает на render).
  function isWindowReachable(newStart: string): boolean {
    try {
      addCivilDays(newStart, 6);
      return true;
    } catch {
      return false;
    }
  }

  // Доступность prev/next на render: невозможное окно → disabled, без
  // необработанных исключений.
  const canNavigatePrev = (() => {
    try {
      return isWindowReachable(addCivilDays(startDate, -7));
    } catch {
      return false;
    }
  })();
  const canNavigateNext = (() => {
    try {
      return isWindowReachable(addCivilDays(startDate, 7));
    } catch {
      return false;
    }
  })();

  function navigateTo(newStart: string): void {
    // R2b2: guard политики (write/form/listPending) до расчётов окна.
    if (listPending || writes.anyInFlight() || writes.anyFormOpen()) {
      return;
    }
    // R5: переход только в полностью допустимое окно — недопустимая
    // попытка не меняет URL/state и не стартует GET.
    if (!isWindowReachable(newStart)) {
      return;
    }
    // Диапазон в URL: reload через SSR вернёт тот же диапазон.
    window.history.replaceState(null, "", `/upcoming?start=${newStart}`);
    setStartDate(newStart);
    void refetch(statusMode, newStart);
  }

  // R2b2-fix/R5: guard политики до addCivilDays; затем проверяется ВЕСЬ
  // destination window (newStart..newStart+6) — недопустимый переход не
  // выполняет effects/RangeError даже при обходе disabled.
  function navigateByDays(deltaDays: number): void {
    if (listPending || writes.anyInFlight() || writes.anyFormOpen()) {
      return;
    }
    let newStart: string;
    try {
      newStart = addCivilDays(startDate, deltaDays);
    } catch {
      return;
    }
    if (!isWindowReachable(newStart)) {
      return;
    }
    navigateTo(newStart);
  }

  // R2b2: смена status-режима запрещена при write в полёте или открытой
  // форме — иначе активная форма скрывается, а старый write callback читает
  // старый режим. Список listPending (чистое чтение) не блокирует switch —
  // sequencing чтений отдельная коррекция R3.
  function switchMode(mode: StatusMode): void {
    if (writes.anyInFlight() || writes.anyFormOpen()) {
      return;
    }
    setStatusMode(mode);
    void refetch(mode, startDate);
  }

  const endDate = addCivilDays(startDate, 6);
  const groups: UpcomingDayGroup[] = groupUpcomingTasks(
    tasks,
    startDate,
    endDate,
  );

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-2" role="group" aria-label={ru.nav.upcoming}>
          {(["open", "completed", "all"] as const).map((value) => (
            <Button
              key={value}
              type="button"
              variant={statusMode === value ? "default" : "outline"}
              aria-pressed={statusMode === value}
              className="min-h-11 px-4"
              onClick={() => switchMode(value)}
              disabled={writes.anyPending || writes.formOpen}
            >
              {value === "open"
                ? ru.tasks.tabs.open
                : value === "completed"
                  ? ru.tasks.tabs.completed
                  : "Все"}
            </Button>
          ))}
        </div>
        <p className="text-sm text-muted-foreground">
          {context.today} · {context.timezone}
        </p>
        <Button
          type="button"
          variant="outline"
          className="min-h-11 px-4"
          onClick={() => void refetch(statusMode, startDate)}
          disabled={listPending}
          id="upcoming-refresh-button"
        >
          {listPending ? ru.tasks.refreshing : ru.tasks.refresh}
        </Button>
      </div>

      <p className="mt-3 text-sm font-medium leading-6" data-testid="upcoming-range">
        {ru.tasks.upcoming.range(
          formatCivilDateDisplay(startDate),
          formatCivilDateDisplay(endDate),
        )}
      </p>

      {listError ? (
        <div className="mt-4 rounded-xl border bg-card p-4">
          <p role="alert" className="text-sm text-destructive">
            {ru.tasks.listError}
          </p>
          <Button
            type="button"
            variant="outline"
            className="mt-2 min-h-11 px-4"
            onClick={() => void refetch(statusMode, startDate)}
            disabled={listPending}
          >
            {ru.tasks.retry}
          </Button>
        </div>
      ) : null}

      <div className="mt-4 flex flex-col gap-6" data-testid="upcoming-groups">
        {groups.map((group) => (
          <section
            key={group.date}
            aria-label={group.date}
            data-group-date={group.date}
          >
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              {formatCivilDateDisplay(group.date)}
              {group.date === context.today
                ? ` · ${ru.tasks.upcoming.todayMarker}`
                : ""}
            </h2>
            <div className="mt-2">
              <TaskItemsList
                tasks={group.tasks}
                today={context.today}
                timezone={context.timezone}
                completedMode={statusMode === "completed"}
                writes={writes}
                emptyState={{
                  title: ru.pages.upcoming.empty.title,
                  description: ru.pages.upcoming.empty.description,
                }}
              />
            </div>
          </section>
        ))}
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          className="min-h-11 px-4"
          onClick={() => navigateByDays(-7)}
          disabled={listPending || writes.anyPending || writes.formOpen || !canNavigatePrev}
        >
          {ru.tasks.upcoming.prev}
        </Button>
        <Button
          type="button"
          variant="outline"
          className="min-h-11 px-4"
          onClick={() => navigateByDays(7)}
          disabled={listPending || writes.anyPending || writes.formOpen || !canNavigateNext}
        >
          {ru.tasks.upcoming.next}
        </Button>
        <Button
          type="button"
          variant="outline"
          className="min-h-11 px-4"
          onClick={() => navigateTo(context.today)}
          disabled={listPending || writes.anyPending || writes.formOpen}
        >
          {ru.tasks.upcoming.current}
        </Button>
      </div>
    </div>
  );
}
