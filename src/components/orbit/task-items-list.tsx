"use client";

import { TaskRow, type TaskRowHandlers, type TaskRowState } from "@/components/orbit/task-row";
import type { TaskDTO } from "@/lib/tasks";
import { ru } from "@/lib/i18n/ru";

/**
 * Общий рендер списка задач (TASK-008): shared rows для Inbox/Today/
 * Upcoming. Состояние строки вычисляется из writes-hook состояния.
 * R2: один общий UI write в полёте — конфликтующие действия всех строк
 * заблокированы (включая текущую).
 */
export function TaskItemsList({
  tasks,
  today,
  timezone,
  completedMode,
  writes,
  emptyState,
}: {
  tasks: TaskDTO[];
  today: string;
  /** R8: server-derived account timezone — подпись времени редактора. */
  timezone: string;
  completedMode: boolean;
  writes: {
    create: { pending: boolean };
    rename: { taskId: string | null; pending: boolean; error: boolean; open: (id: string) => void; close: (id: string) => void; submit: (id: string, title: string) => Promise<boolean> };
    toggle: { taskId: string | null; errorTaskId: string | null; submit: (id: string, completed: boolean) => Promise<boolean> };
    schedule: { taskId: string | null; pending: boolean; errorTaskId: string | null; open: (id: string) => void; close: (id: string) => void; submit: (id: string, patch: Record<string, string | null>) => Promise<boolean> };
    delete: { taskId: string | null; pending: boolean; errorTaskId: string | null; open: (id: string) => void; close: (id: string) => void; submit: (id: string) => Promise<boolean> };
  };
  emptyState: { title: string; description: string };
}) {
  if (tasks.length === 0) {
    return (
      <div className="rounded-xl border bg-card p-8 text-center" data-testid="tasks-empty">
        <p className="text-sm font-medium leading-6">{emptyState.title}</p>
        <p className="mt-1 text-sm leading-5 text-muted-foreground">
          {emptyState.description}
        </p>
      </div>
    );
  }

  // Семантика хука: taskId для rename/schedule/delete = «editor/confirmation
  // открыт для этой задачи»; для toggle = «toggle в полёте». pending —
  // фактический сетевой запрос. R2a: createPending — удержанный POST
  // quick-add, тоже часть общего write guard.
  const globalBusy =
    writes.create.pending ||
    writes.rename.pending ||
    writes.toggle.taskId !== null ||
    writes.schedule.pending ||
    writes.delete.pending;

  // R2b1: пока открыта любая форма, form-триггеры всех строк disabled
  // (сам hook синхронно отказывает и программным открытиям).
  const anyFormOpen =
    writes.rename.taskId !== null ||
    writes.schedule.taskId !== null ||
    writes.delete.taskId !== null;

  return (
    <ul className="mt-4 flex flex-col gap-2">
      {tasks.map((task) => {
        const rowCompleted = completedMode || task.completedAt !== null;
        const rowState: TaskRowState = {
          busy: globalBusy,
          formOpen: anyFormOpen,
          renameOpen: writes.rename.taskId === task.id,
          scheduleOpen: writes.schedule.taskId === task.id,
          deleteConfirmOpen: writes.delete.taskId === task.id,
          togglePending: writes.toggle.taskId === task.id,
          deletePending: writes.delete.pending,
          renamePending: writes.rename.pending,
          schedulePending: writes.schedule.pending,
          renameError: writes.rename.error && writes.rename.taskId === task.id,
          toggleError:
            writes.toggle.errorTaskId === task.id
              ? task.completedAt === null
                ? ru.tasks.complete.errorOpen
                : ru.tasks.complete.errorCompleted
              : null,
          deleteError:
            writes.delete.errorTaskId === task.id ? ru.tasks.delete.error : null,
          scheduleError:
            writes.schedule.errorTaskId === task.id
              ? ru.tasks.schedule.error
              : null,
        };
        const handlers: TaskRowHandlers = {
          onToggle: () => void writes.toggle.submit(task.id, task.completedAt === null),
          onOpenRename: () => writes.rename.open(task.id),
          onSubmitRename: async (title) => {
            // Успех → закрыть editor (строка покажет подтверждённый title
            // после refetch); отказ → editor остаётся с draft/error.
            const ok = await writes.rename.submit(task.id, title);
            if (ok) {
              writes.rename.close(task.id);
            }
          },
          onRenameCancel: () => writes.rename.close(task.id),
          onOpenSchedule: () => writes.schedule.open(task.id),
          onSubmitSchedule: async (patch) => {
            const ok = await writes.schedule.submit(task.id, patch);
            if (ok) {
              writes.schedule.close(task.id);
            }
          },
          onScheduleCancel: () => writes.schedule.close(task.id),
          onOpenDelete: () => writes.delete.open(task.id),
          onConfirmDelete: () => void writes.delete.submit(task.id),
          onDeleteCancel: () => writes.delete.close(task.id),
        };
        return (
          <TaskRow
            key={task.id}
            task={task}
            completed={rowCompleted}
            today={today}
            timezone={timezone}
            state={rowState}
            handlers={handlers}
          />
        );
      })}
    </ul>
  );
}
