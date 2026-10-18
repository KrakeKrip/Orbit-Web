"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TaskScheduleEditor } from "@/components/orbit/task-schedule-editor";
import type { TaskDTO } from "@/lib/tasks";
import { formatCivilDateDisplay } from "@/lib/calendar";
import { ru } from "@/lib/i18n/ru";

/**
 * Общая строка задачи (TASK-008): используется Inbox/Today/Upcoming.
 * Содержит title (текст), completion toggle, rename editor, schedule
 * editor (Планирование) и delete confirmation. Никакой собственной
 * network-логики: все действия — колбэки владельца экрана; pending-флаги
 * и ошибки приходят снаружи.
 */

export type TaskRowState = {
  /** Глобальный pending: конфликтующие действия строки заблокированы. */
  busy: boolean;
  /** R2b1: открыта любая форма — form-триггеры строк заблокированы. */
  formOpen: boolean;
  renameOpen: boolean;
  scheduleOpen: boolean;
  deleteConfirmOpen: boolean;
  togglePending: boolean;
  deletePending: boolean;
  renamePending: boolean;
  schedulePending: boolean;
  /** Ошибка rename для этой строки (editor). */
  renameError: boolean;
  /** Ошибка toggle для этой строки (иначе null). */
  toggleError: string | null;
  /** Ошибка delete для этой строки. */
  deleteError: string | null;
  /** Ошибка schedule для этой строки. */
  scheduleError: string | null;
};

export type TaskRowHandlers = {
  onToggle: () => void;
  onOpenRename: () => void;
  onSubmitRename: (title: string) => void;
  onRenameCancel: () => void;
  onOpenSchedule: () => void;
  onSubmitSchedule: (patch: {
    plannedDate?: string | null;
    plannedTime?: string | null;
    deadlineDate?: string | null;
  }) => void;
  onScheduleCancel: () => void;
  onOpenDelete: () => void;
  onConfirmDelete: () => void;
  onDeleteCancel: () => void;
};

export function TaskRow({
  task,
  completed,
  today,
  timezone,
  state,
  handlers,
}: {
  task: TaskDTO;
  /** Server context today — для deadline-бейджей (просрочен/сегодня). */
  today: string;
  /** R8: server-derived account timezone — подпись времени редактора. */
  timezone: string;
  /** true в completed-режиме: даты показываются нейтрально. */
  completed: boolean;
  state: TaskRowState;
  handlers: TaskRowHandlers;
}) {
  const deadlineBadge = (() => {
    if (task.deadlineDate === null) {
      return null;
    }
    const display = formatCivilDateDisplay(task.deadlineDate);
    if (completed) {
      return `${ru.tasks.badges.deadline}${display}`;
    }
    if (task.deadlineDate < today) {
      return `${ru.tasks.badges.deadline}${display} (${ru.tasks.badges.overdue})`;
    }
    if (task.deadlineDate === today) {
      return `${ru.tasks.badges.deadline}${display} (${ru.tasks.badges.dueToday})`;
    }
    return `${ru.tasks.badges.deadline}${display}`;
  })();

  const plannedBadge = (() => {
    if (task.plannedDate === null) {
      return null;
    }
    const display = formatCivilDateDisplay(task.plannedDate);
    const timeSuffix = task.plannedTime === null ? "" : ` ${task.plannedTime}`;
    if (completed) {
      return `${ru.tasks.badges.planned}${display}${timeSuffix}`;
    }
    if (task.plannedDate < today) {
      return `${ru.tasks.badges.planned}${display}${timeSuffix} (${ru.tasks.badges.overdue})`;
    }
    if (task.plannedDate === today) {
      return `${ru.tasks.badges.planned}${display}${timeSuffix} (${ru.tasks.badges.dueToday})`;
    }
    return `${ru.tasks.badges.planned}${display}${timeSuffix}`;
  })();

  return (
    <li
      className="rounded-xl border bg-card p-4"
      id={`task-row-${task.id}`}
      data-task-id={task.id}
      data-completed={completed || undefined}
    >
      {state.renameOpen ? (
        <TaskRenameEditor task={task} state={state} handlers={handlers} />
      ) : state.scheduleOpen ? (
        <>
          <p className="break-words text-sm font-medium leading-6">{task.title}</p>
          <TaskScheduleEditor
            snapshot={{
              plannedDate: task.plannedDate,
              plannedTime: task.plannedTime,
              deadlineDate: task.deadlineDate,
            }}
            pending={state.schedulePending}
            // R2a-fix: чужая write pending блокирует controls/Escape;
            // собственная операция по-прежнему видна через pending.
            blocked={state.busy}
            error={state.scheduleError}
            dateInputId={`task-schedule-date-input-${task.id}`}
            timezone={timezone}
            onSave={handlers.onSubmitSchedule}
            onCancel={handlers.onScheduleCancel}
          />
        </>
      ) : state.deleteConfirmOpen ? (
        <div
          role="alert"
          aria-live="assertive"
          onKeyDown={(event) => {
            // R2a-fix: Escape заблокирован при любой write в полёте.
            if (event.key === "Escape" && !state.busy) {
              event.preventDefault();
              handlers.onDeleteCancel();
            }
          }}
        >
          <p className="text-sm font-medium leading-6">
            {ru.tasks.delete.confirmTitle}
          </p>
          <p className="break-words text-sm text-muted-foreground">{task.title}</p>
          <div className="mt-3 flex gap-2">
            <Button
              type="button"
              variant="destructive"
              className="min-h-11 px-4"
              onClick={handlers.onConfirmDelete}
              disabled={state.busy}
            >
              {state.deletePending ? ru.tasks.delete.pending : ru.tasks.delete.confirm}
            </Button>
            <Button
              type="button"
              variant="outline"
              className="min-h-11 px-4"
              id={`task-delete-cancel-${task.id}`}
              autoFocus
              onClick={handlers.onDeleteCancel}
              disabled={state.busy}
            >
              {ru.tasks.delete.cancel}
            </Button>
          </div>
          {state.deleteError !== null && !state.deletePending ? (
            <p role="alert" className="mt-2 text-sm text-destructive">
              {state.deleteError}
            </p>
          ) : null}
        </div>
      ) : (
        <>
          <p
            className={`break-words text-sm font-medium leading-6 ${
              completed ? "text-muted-foreground line-through" : ""
            }`}
          >
            {task.title}
          </p>
          {plannedBadge !== null ? (
            <p className="mt-1 text-xs leading-4 text-muted-foreground">
              {plannedBadge}
            </p>
          ) : null}
          {deadlineBadge !== null ? (
            <p className="mt-1 text-xs leading-4 text-muted-foreground">
              {deadlineBadge}
            </p>
          ) : null}
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              id={`task-toggle-trigger-${task.id}`}
              className="min-h-11 px-4"
              onClick={handlers.onToggle}
              disabled={state.busy}
            >
              {state.togglePending
                ? completed
                  ? ru.tasks.complete.pendingCompleted
                  : ru.tasks.complete.pendingOpen
                : completed
                  ? ru.tasks.complete.reopen
                  : ru.tasks.complete.action}
            </Button>
            <Button
              type="button"
              variant="outline"
              id={`task-rename-trigger-${task.id}`}
              className="min-h-11 px-4"
              onClick={handlers.onOpenRename}
              disabled={state.busy || state.formOpen}
            >
              {ru.tasks.rename.action}
            </Button>
            <Button
              type="button"
              variant="outline"
              id={`task-schedule-trigger-${task.id}`}
              className="min-h-11 px-4"
              onClick={handlers.onOpenSchedule}
              disabled={state.busy || state.formOpen}
            >
              {ru.tasks.schedule.action}
            </Button>
            <Button
              type="button"
              variant="outline"
              id={`task-delete-trigger-${task.id}`}
              className="min-h-11 px-4"
              onClick={handlers.onOpenDelete}
              disabled={state.busy || state.formOpen}
            >
              {ru.tasks.delete.action}
            </Button>
          </div>
          {state.toggleError !== null && !state.togglePending ? (
            <p role="alert" className="mt-2 text-sm text-destructive">
              {state.toggleError}
            </p>
          ) : null}
        </>
      )}
    </li>
  );
}

/**
 * R4: локальный rename editor — монтируется только пока форма открыта,
 * поэтому useState-инициализация берёт актуальный task.title на КАЖДОЕ
 * открытие: отменённый draft не воскресает, внешнее изменение + refresh
 * дают свежий server title. Во время текущего открытия draft не
 * сбрасывается из live prop — failed save сохраняет draft/error для
 * retry. Общий busy блокирует input/Save/Cancel/Escape (R2a-fix);
 * собственная операция показывает свои pending labels.
 */
function TaskRenameEditor({
  task,
  state,
  handlers,
}: {
  task: TaskDTO;
  state: TaskRowState;
  handlers: Pick<TaskRowHandlers, "onSubmitRename" | "onRenameCancel">;
}) {
  const [renameDraft, setRenameDraft] = useState(task.title);
  const renameInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    // Только фокус при открытии: draft инициализирован useState.
    renameInputRef.current?.focus();
  }, []);

  return (
    <form
      aria-busy={state.renamePending}
      onSubmit={(event) => {
        event.preventDefault();
        handlers.onSubmitRename(renameDraft);
      }}
      onKeyDown={(event) => {
        // R2a-fix: Escape заблокирован при любой write в полёте
        // (busy = своя или чужая pending; свои labels не меняются).
        if (event.key === "Escape" && !state.busy) {
          event.preventDefault();
          handlers.onRenameCancel();
        }
      }}
    >
      <Label htmlFor={`task-rename-input-${task.id}`}>
        {ru.tasks.rename.action}
      </Label>
      <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center">
        <Input
          id={`task-rename-input-${task.id}`}
          ref={renameInputRef}
          autoFocus
          type="text"
          autoComplete="off"
          className="min-h-11 max-w-72"
          value={renameDraft}
          onChange={(event) => setRenameDraft(event.target.value)}
          disabled={state.busy}
        />
        <Button type="submit" className="min-h-11 px-4" disabled={state.busy}>
          {state.renamePending ? ru.tasks.rename.saving : ru.tasks.rename.save}
        </Button>
        <Button
          type="button"
          variant="outline"
          className="min-h-11 px-4"
          onClick={handlers.onRenameCancel}
          disabled={state.busy}
        >
          {ru.tasks.rename.cancel}
        </Button>
      </div>
      {state.renameError ? (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {ru.tasks.rename.error}
        </p>
      ) : null}
    </form>
  );
}
