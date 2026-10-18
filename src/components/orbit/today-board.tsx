"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TaskItemsList } from "@/components/orbit/task-items-list";
import { useTaskWrites } from "@/components/orbit/use-task-writes";
import type { TaskDTO } from "@/lib/tasks";
import {
  groupTodayTasks,
  type TodaySectionKey,
} from "@/lib/task-view";
import { parseTaskTitle } from "@/lib/tasks";
import { ru } from "@/lib/i18n/ru";

type StatusMode = "open" | "completed";

type TodayPayload = {
  tasks: TaskDTO[];
  context: { timezone: string; today: string; asOf: string };
};

/**
 * Реальный экран Сегодня (TASK-008): четыре взаимоисключающие секции по
 * plan/deadline приоритету (pure groupTodayTasks), quick-add с явным
 * plannedDate = displayed server today (клиент зону не выбирает),
 * complete/reopen в completed-режиме с нейтральными заголовками, shared
 * rows/actions через useTaskWrites (R1/R2/R3 инварианты), Обновить
 * перечитывает tasks+context (latest request wins), таймеров/клиентских
 * часов нет. R2b4: режим open/completed не меняется при pending записи или
 * открытой форме — disabled по реактивным флагам и синхронный ref-guard в
 * switchMode до setStatusMode/refetch; listPending режим не блокирует (R3).
 */
export function TodayBoard({
  initialTasks,
  initialTimezone,
  initialToday,
  initialAsOf,
  actorId,
}: {
  initialTasks: TaskDTO[];
  initialTimezone: string;
  initialToday: string;
  initialAsOf: string;
  actorId: string;
}) {
  const [tasks, setTasks] = useState(initialTasks);
  const [context, setContext] = useState({
    timezone: initialTimezone,
    today: initialToday,
    asOf: initialAsOf,
  });
  const [statusMode, setStatusMode] = useState<StatusMode>("open");
  const [listError, setListError] = useState(false);
  const [listPending, setListPending] = useState(false);

  const [createDraft, setCreateDraft] = useState("");
  const [createPending, setCreatePending] = useState(false);
  const [createInvalid, setCreateInvalid] = useState(false);
  const [createError, setCreateError] = useState(false);

  const mountedRef = useRef(true);
  const actorRef = useRef(actorId);
  const requestSeqRef = useRef(0);
  const createInFlight = useRef(false);

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
    async (mode: StatusMode): Promise<boolean> => {
      const requestedActorId = actorRef.current;
      setListPending(true);
      const requestSeq = ++requestSeqRef.current;
      // R3b: исход read применяется только если запрос всё ещё latest —
      // mounted + actor + latest seq после КАЖДОГО await (fetch, JSON
      // parsing), в catch и finally (тот же pattern, что R3a Upcoming).
      const stillLatest = (): boolean =>
        mountedRef.current &&
        actorRef.current === requestedActorId &&
        requestSeq === requestSeqRef.current;
      try {
        const response = await fetch(
          `/api/v1/tasks?view=today&status=${mode}`,
        );
        if (!stillLatest()) {
          return false;
        }
        if (!response.ok) {
          setListError(true);
          return false;
        }
        const payload = (await response.json()) as TodayPayload;
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
        if (stillLatest()) {
          setListError(true);
        }
        return false;
      } finally {
        if (stillLatest()) {
          setListPending(false);
        }
      }
    },
    [],
  );

  const writes = useTaskWrites({
    actorId,
    createFocusElementId: "today-title-input",
    onConfirmed: useCallback(() => refetch(statusMode), [refetch, statusMode]),
  });

  async function refresh(): Promise<void> {
    await refetch(statusMode);
  }

  // R2b4: режим не меняется при pending записи или открытой форме — иначе
  // активная форма скрывается, а старый write callback читает старый mode.
  // Синхронный ref-guard до setStatusMode/refetch; listPending (чистое
  // чтение) режим не блокирует — sequencing чтений отдельная коррекция R3.
  function switchMode(mode: StatusMode): void {
    if (writes.anyInFlight() || writes.anyFormOpen()) {
      return;
    }
    setStatusMode(mode);
    void refetch(mode);
  }

  async function handleCreate(): Promise<void> {
    if (createInFlight.current) {
      return;
    }
    const parsed = parseTaskTitle(createDraft);
    if (!parsed.ok) {
      setCreateInvalid(true);
      setCreateError(false);
      return;
    }
    // R2a: единый write guard — create регистрируется в shared hook
    // синхронно до fetch; любой pending write (row или create) запрещает
    // POST, а row writes видят create и блокируются взаимно.
    if (!writes.create.begin()) {
      return;
    }
    setCreateInvalid(false);
    setCreateError(false);
    setCreatePending(true);
    createInFlight.current = true;
    const requestedActorId = actorRef.current;
    try {
      const response = await fetch("/api/v1/tasks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: parsed.title,
          plannedDate: context.today,
        }),
      });
      if (!mountedRef.current || actorRef.current !== requestedActorId) {
        return;
      }
      if (response.ok) {
        setCreateDraft("");
        await refetch(statusMode);
        return;
      }
      setCreateError(true);
    } catch {
      if (mountedRef.current && actorRef.current === requestedActorId) {
        setCreateError(true);
      }
    } finally {
      createInFlight.current = false;
      writes.create.end();
      if (mountedRef.current && actorRef.current === requestedActorId) {
        setCreatePending(false);
      }
    }
  }

  const sections = groupTodayTasks(tasks, context.today);
  const sectionTitle = (key: TodaySectionKey): string => {
    if (statusMode !== "open") {
      // Completed-режим: нейтральные заголовки прошлых секций.
      if (key === "planOverdue") {
        return ru.tasks.today.sections.planOverdueNeutral;
      }
      if (key === "deadlineOverdue") {
        return ru.tasks.today.sections.deadlineOverdueNeutral;
      }
    }
    return ru.tasks.today.sections[key];
  };

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-2" role="group" aria-label={ru.nav.inbox}>
          {(["open", "completed"] as const).map((value) => (
            <Button
              key={value}
              type="button"
              variant={statusMode === value ? "default" : "outline"}
              aria-pressed={statusMode === value}
              className="min-h-11 px-4"
              onClick={() => switchMode(value)}
              disabled={writes.anyPending || writes.formOpen}
            >
              {value === "open" ? ru.tasks.tabs.open : ru.tasks.tabs.completed}
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
          onClick={() => void refresh()}
          disabled={listPending}
          id="today-refresh-button"
        >
          {listPending ? ru.tasks.refreshing : ru.tasks.refresh}
        </Button>
      </div>

      {listError ? (
        <div className="mt-4 rounded-xl border bg-card p-4">
          <p role="alert" className="text-sm text-destructive">
            {ru.tasks.listError}
          </p>
          <Button
            type="button"
            variant="outline"
            className="mt-2 min-h-11 px-4"
            onClick={() => void refetch(statusMode)}
            disabled={listPending}
          >
            {ru.tasks.retry}
          </Button>
        </div>
      ) : null}

      <form
        className="mt-4 rounded-xl border bg-card p-4"
        aria-busy={createPending}
        onSubmit={(event) => {
          event.preventDefault();
          void handleCreate();
        }}
      >
        <Label htmlFor="today-title-input">{ru.tasks.create.label}</Label>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
          <Input
            id="today-title-input"
            type="text"
            autoComplete="off"
            className="min-h-11 max-w-72"
            placeholder={ru.tasks.create.placeholder}
            value={createDraft}
            onChange={(event) => {
              setCreateDraft(event.target.value);
              if (createInvalid) {
                setCreateInvalid(false);
              }
            }}
            aria-invalid={createInvalid || undefined}
            disabled={writes.anyPending}
          />
          <Button type="submit" className="min-h-11 px-4" disabled={writes.anyPending}>
            {createPending ? ru.tasks.create.submitting : ru.tasks.create.submit}
          </Button>
        </div>
        <p aria-live="polite" className="mt-2 text-sm leading-5">
          {createInvalid ? (
            <span role="alert" className="text-destructive">
              {ru.tasks.create.invalid}
            </span>
          ) : createError ? (
            <span role="alert" className="text-destructive">
              {ru.tasks.create.error}
            </span>
          ) : null}
        </p>
      </form>

      <div className="mt-4 flex flex-col gap-6" data-testid="today-sections">
        {sections.map((section) => (
          <section
            key={section.key}
            aria-label={sectionTitle(section.key)}
            data-section={section.key}
          >
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              {sectionTitle(section.key)}
            </h2>
            <div className="mt-2">
              <TaskItemsList
                tasks={section.tasks}
                today={context.today}
                timezone={context.timezone}
                completedMode={statusMode === "completed"}
                writes={writes}
                emptyState={{
                  title: ru.pages.today.empty.title,
                  description: ru.pages.today.empty.description,
                }}
              />
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
