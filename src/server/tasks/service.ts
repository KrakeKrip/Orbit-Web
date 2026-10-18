import "server-only";

import { randomUUID } from "node:crypto";
import { addCivilDays, normalizeCivilTime } from "@/lib/calendar";
import { compareTodayOrder } from "@/lib/task-view";
import { and, asc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import { projects, taskCompletions, tasks } from "@/server/db/schema";
import type {
  TaskListStatus,
  TaskPatch,
  TaskPlanningValues,
  TaskViewName,
} from "@/lib/tasks";

/**
 * Task service (TASK-007, Inbox one-off subset): owner-scoped list/read/
 * create/mutate на существующей схеме. Actor — только server-derived id из
 * requireUser; client owner/project/parent не принимаются. Composite FK
 * (project_id, owner_id)/(parent_id, owner_id) гарантируют, что связи
 * указывают только на собственные проекты/задачи, поэтому фильтры по
 * owner_id в join/EXISTS не создают меж-owner связей.
 *
 * Inbox collection: собственные не-deleted root tasks (parent_id NULL) без
 * planned_date, у которых project_id NULL либо собственный НЕархивированный
 * проект (исключение архивных — на сервере). Сортировка стабильная:
 * sort_order ASC, created_at ASC, id ASC. Ошибка БД пробрасывается, не
 * превращаясь в пустой список; cross-request cache нет.
 *
 * Мутации (PATCH/DELETE) выполняются в транзакции: сперва row lock задачи
 * (SELECT ... FOR UPDATE по id+owner+deleted_at IS NULL), затем guard'ы
 * состояния (child/recurrence → UNSUPPORTED_TASK; задача архивного проекта
 * → PROJECT_ARCHIVED — row lock проекта сериализует проверку с принятым
 * archive UPDATE projects, поэтому архив не может вклиниться между
 * проверкой и записью; порядок блокировок всегда task → project, у project
 * archive встречных task-блокировок нет — deadlock невозможен). Изменения
 * считываются и применяются под блокировкой: revision +1 только при
 * реальном изменении (title/complete/reopen/delete), updated_at — только
 * при изменении; полный no-op возвращает текущее состояние без записи.
 *
 * Completion: переход open→completed записывает task.completed_at и журнал
 * task_completions ОДНИМ server timestamp в той же транзакции
 * (occurrence_date NULL, completed_revision = revision ДО перехода,
 * idempotency_key — server UUID); отказ INSERT откатывает и task. Повторы и
 * конкурентные completes: row lock сериализует — второй видит уже
 * completed и возвращает no-op; ровно один journal row. Reopen:
 * completed_at NULL, revision+1, журнал сохраняется; re-complete добавляет
 * новый log с новой completed_revision (unique(task_id,completed_revision)
 * не конфликтует).
 *
 * Soft delete: root получает deleted_at/updated_at (один timestamp) и
 * revision+1; в той же транзакции собственные активные direct children
 * скрываются тем же timestamp с revision+1; уже удалённые children и
 * project/completion journal не меняются. Физического DELETE нет.
 */

export type TaskRecord = {
  id: string;
  title: string;
  projectId: string | null;
  parentId: string | null;
  plannedDate: string | null;
  plannedTime: string | null;
  deadlineDate: string | null;
  completedAt: Date | null;
  revision: number;
  createdAt: Date;
  updatedAt: Date;
};

/** Нормализованный результат mutation для route mapping. */
export type TaskMutationOutcome =
  | { kind: "task"; task: TaskRecord }
  | { kind: "not-found" }
  | { kind: "unsupported" }
  | { kind: "project-archived" }
  | { kind: "validation"; field: "plannedTime" };

const taskColumns = {
  id: tasks.id,
  title: tasks.title,
  projectId: tasks.projectId,
  parentId: tasks.parentId,
  plannedDate: tasks.plannedDate,
  plannedTime: tasks.plannedTime,
  deadlineDate: tasks.deadlineDate,
  completedAt: tasks.completedAt,
  revision: tasks.revision,
  createdAt: tasks.createdAt,
  updatedAt: tasks.updatedAt,
};

/** Фильтр «рабочих» view: root one-off non-deleted, project NULL или свой активный. */
function workingTaskFilters(actorId: string) {
  return [
    eq(tasks.ownerId, actorId),
    isNull(tasks.deletedAt),
    isNull(tasks.parentId),
    isNull(tasks.recurrenceRule),
    sql`(${tasks.projectId} IS NULL OR EXISTS (
      SELECT 1 FROM ${projects}
      WHERE ${projects.id} = ${tasks.projectId}
        AND ${projects.ownerId} = ${actorId}
        AND ${projects.archivedAt} IS NULL
    ))`,
  ];
}

function completedFilter(status: TaskListStatus) {
  if (status === "open") {
    return isNull(tasks.completedAt);
  }
  if (status === "completed") {
    return isNotNull(tasks.completedAt);
  }
  return undefined;
}

export async function listTasksView(
  actorId: string,
  view: TaskViewName,
  status: TaskListStatus,
  today: string,
  startDate?: string,
): Promise<TaskRecord[]> {
  const completionFilter = completedFilter(status);
  let viewFilter;
  let orderBy;
  if (view === "inbox") {
    viewFilter = isNull(tasks.plannedDate);
    orderBy = [asc(tasks.sortOrder), asc(tasks.createdAt), asc(tasks.id)];
  } else if (view === "today") {
    // Union: попала по плану <= today ИЛИ по дедлайну <= today (хотя бы
    // одна дата присутствует); порядок/секционирование — единый
    // pure-контракт compareTodayOrder (R7, тот же, что у Today UI).
    viewFilter = and(
      sql`(${tasks.plannedDate} IS NOT NULL OR ${tasks.deadlineDate} IS NOT NULL)`,
      sql`(${tasks.plannedDate} <= ${today}::date OR ${tasks.deadlineDate} <= ${today}::date)`,
    );
    orderBy = [asc(tasks.sortOrder), asc(tasks.createdAt), asc(tasks.id)];
  } else {
    if (startDate === undefined) {
      throw new Error("Upcoming view requires startDate.");
    }
    const endDate = addCivilDays(startDate, 6);
    viewFilter = and(
      sql`${tasks.plannedDate} >= ${startDate}::date`,
      sql`${tasks.plannedDate} <= ${endDate}::date`,
    );
    orderBy = [
      asc(tasks.plannedDate),
      sql`${tasks.plannedTime} ASC NULLS LAST`,
      asc(tasks.sortOrder),
      asc(tasks.createdAt),
      asc(tasks.id),
    ];
  }
  const rows = await getDb()
    .select(taskColumns)
    .from(tasks)
    .where(
      and(
        ...workingTaskFilters(actorId),
        viewFilter,
        ...(completionFilter === undefined ? [] : [completionFilter]),
      ),
    )
    .orderBy(...orderBy);
  if (view !== "today") {
    return rows;
  }
  // R7: raw API возвращает Today в том же порядке, что Today UI, — тот же
  // pure-компаратор rank 1..4 + внутриранговый порядок контракта. Вход уже
  // отсортирован стабильно (sort_order/created_at/id); стабильная
  // JS-сортировка сохраняет этот tie-break, DTO не расширяется.
  return [...rows].sort((a, b) => compareTodayOrder(a, b, today));
}

/** Собственная не-deleted задача в любом состоянии (даты/архив проекта). */
export async function getTask(
  actorId: string,
  taskId: string,
): Promise<TaskRecord | null> {
  const rows = await getDb()
    .select(taskColumns)
    .from(tasks)
    .where(
      and(
        eq(tasks.id, taskId),
        eq(tasks.ownerId, actorId),
        isNull(tasks.deletedAt),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

export async function createTask(
  actorId: string,
  input: { title: string } & TaskPlanningValues,
): Promise<TaskRecord> {
  const rows = await getDb()
    .insert(tasks)
    .values({
      ownerId: actorId,
      title: input.title,
      plannedDate: input.plannedDate,
      plannedTime: input.plannedTime,
      deadlineDate: input.deadlineDate,
    })
    .returning(taskColumns);
  const row = rows[0];
  if (!row) {
    throw new Error("Task insert returned no row.");
  }
  return row;
}

/**
 * PATCH title/completed: транзакция + row lock; см. модульный комментарий.
 * not-found — missing/foreign/конкурентно удалённая; unsupported — child/
 * recurrence; project-archived — задача архивного проекта.
 */
export async function mutateTask(
  actorId: string,
  taskId: string,
  patch: TaskPatch,
): Promise<TaskMutationOutcome> {
  return getDb().transaction(async (tx) => {
    const locked = await tx
      .select({ ...taskColumns, recurrenceRule: tasks.recurrenceRule })
      .from(tasks)
      .where(
        and(
          eq(tasks.id, taskId),
          eq(tasks.ownerId, actorId),
          isNull(tasks.deletedAt),
        ),
      )
      .for("update")
      .limit(1);
    const task = locked[0];
    if (!task) {
      return { kind: "not-found" };
    }
    if (task.parentId !== null || task.recurrenceRule !== null) {
      return { kind: "unsupported" };
    }
    if (task.projectId !== null) {
      const lockedProject = await tx
        .select({ archivedAt: projects.archivedAt })
        .from(projects)
        .where(
          and(
            eq(projects.id, task.projectId),
            eq(projects.ownerId, actorId),
          ),
        )
        .for("update")
        .limit(1);
      if (lockedProject[0] === undefined) {
        return { kind: "not-found" };
      }
      if (lockedProject[0].archivedAt !== null) {
        return { kind: "project-archived" };
      }
    }

    // R-merge: планировочные поля мерджатся с текущими значениями под
    // task lock; plannedTime ненулевой требует результирующий plannedDate;
    // явная очистка plannedDate с ненулевым time → 400.
    const resultPlannedDate =
      patch.plannedDate !== undefined ? patch.plannedDate : task.plannedDate;
    let resultPlannedTime =
      patch.plannedTime !== undefined
        ? patch.plannedTime
        : normalizeCivilTime(task.plannedTime);
    // Clearing plan автоматически очищает time (если time не передан или
    // null); явный ненулевой time одновременно с очисткой плана → 400.
    if (patch.plannedDate === null) {
      if (patch.plannedTime !== undefined && patch.plannedTime !== null) {
        return { kind: "validation", field: "plannedTime" };
      }
      resultPlannedTime = null;
    }
    if (resultPlannedTime !== null && resultPlannedDate === null) {
      return { kind: "validation", field: "plannedTime" };
    }

    const titleChanged = patch.title !== undefined && patch.title !== task.title;
    const completionTransition =
      patch.completed === undefined
        ? null
        : patch.completed && task.completedAt === null
          ? "complete"
          : !patch.completed && task.completedAt !== null
            ? "reopen"
            : null;
    const plannedDateChanged = resultPlannedDate !== task.plannedDate;
    const plannedTimeChanged =
      resultPlannedTime !== normalizeCivilTime(task.plannedTime);
    const deadlineChanged =
      patch.deadlineDate !== undefined && patch.deadlineDate !== task.deadlineDate;
    const planningChanged =
      plannedDateChanged || plannedTimeChanged || deadlineChanged;
    if (!titleChanged && completionTransition === null && !planningChanged) {
      // Полный no-op: текущий DTO без изменения revision/timestamps.
      return {
        kind: "task",
        task: {
          id: task.id,
          title: task.title,
          projectId: task.projectId,
          parentId: task.parentId,
          plannedDate: task.plannedDate,
          plannedTime: task.plannedTime,
          deadlineDate: task.deadlineDate,
          completedAt: task.completedAt,
          revision: task.revision,
          createdAt: task.createdAt,
          updatedAt: task.updatedAt,
        },
      };
    }

    const updated = await tx
      .update(tasks)
      .set({
        // Записываются только реально изменённые поля; omitted поля и
        // прочие колонки (notes/priority/project/parent/order/created_at)
        // не трогаются.
        ...(titleChanged ? { title: patch.title as string } : {}),
        ...(completionTransition !== null
          ? {
              completedAt:
                completionTransition === "complete"
                  ? sql`now()`
                  : null,
            }
          : {}),
        ...(plannedDateChanged ? { plannedDate: resultPlannedDate } : {}),
        ...(plannedTimeChanged ? { plannedTime: resultPlannedTime } : {}),
        ...(deadlineChanged ? { deadlineDate: patch.deadlineDate as string | null } : {}),
        revision: task.revision + 1,
        updatedAt: sql`now()`,
      })
      .where(and(eq(tasks.id, taskId), eq(tasks.ownerId, actorId)))
      .returning(taskColumns);
    const row = updated[0];
    if (!row) {
      throw new Error("Task update returned no row.");
    }
    if (completionTransition === "complete") {
      // Журнал в той же транзакции: отказ INSERT откатывает и task.
      // occurrence_date остаётся NULL для one-off; completed_revision = task
      // revision ДО перехода.
      await tx.insert(taskCompletions).values({
        ownerId: actorId,
        taskId,
        completedAt: sql`now()`,
        completedRevision: task.revision,
        idempotencyKey: randomUUID(),
        occurrenceDate: null,
      });
    }
    return { kind: "task", task: row };
  });
}

export type DeleteOutcome =
  | { kind: "deleted" }
  | { kind: "noop" }
  | { kind: "not-found" }
  | { kind: "unsupported" }
  | { kind: "project-archived" };

/**
 * DELETE: soft delete root + скрытие собственных активных direct children
 * одним timestamp (см. модульный комментарий). noop — собственная уже
 * удалённая задача (204 без изменений); not-found — foreign/unknown.
 */
export async function softDeleteTask(
  actorId: string,
  taskId: string,
): Promise<DeleteOutcome> {
  const existing = await getDb()
    .select({ deletedAt: tasks.deletedAt })
    .from(tasks)
    .where(and(eq(tasks.id, taskId), eq(tasks.ownerId, actorId)))
    .limit(1);
  if (existing[0] === undefined) {
    return { kind: "not-found" };
  }
  if (existing[0].deletedAt !== null) {
    return { kind: "noop" };
  }
  return getDb().transaction(async (tx) => {
    const locked = await tx
      .select({ ...taskColumns, recurrenceRule: tasks.recurrenceRule })
      .from(tasks)
      .where(
        and(
          eq(tasks.id, taskId),
          eq(tasks.ownerId, actorId),
          isNull(tasks.deletedAt),
        ),
      )
      .for("update")
      .limit(1);
    const task = locked[0];
    if (!task) {
      // Конкурентно удалена другим своим запросом: no-op.
      return { kind: "noop" };
    }
    if (task.parentId !== null || task.recurrenceRule !== null) {
      return { kind: "unsupported" };
    }
    if (task.projectId !== null) {
      const lockedProject = await tx
        .select({ archivedAt: projects.archivedAt })
        .from(projects)
        .where(
          and(
            eq(projects.id, task.projectId),
            eq(projects.ownerId, actorId),
          ),
        )
        .for("update")
        .limit(1);
      if (lockedProject[0] === undefined) {
        return { kind: "not-found" };
      }
      if (lockedProject[0].archivedAt !== null) {
        return { kind: "project-archived" };
      }
    }

    const updated = await tx
      .update(tasks)
      .set({ deletedAt: sql`now()`, revision: task.revision + 1, updatedAt: sql`now()` })
      .where(and(eq(tasks.id, taskId), eq(tasks.ownerId, actorId)))
      .returning({ id: tasks.id });
    if (updated[0] === undefined) {
      throw new Error("Task soft delete returned no row.");
    }
    // Собственные активные direct children скрываются тем же timestamp;
    // уже удалённые children и completion journal не меняются.
    // now() стабилен внутри транзакции: root и новые удалённые children
    // получают одинаковый server timestamp автоматически.
    await tx
      .update(tasks)
      .set({
        deletedAt: sql`now()`,
        updatedAt: sql`now()`,
        revision: sql`${tasks.revision} + 1`,
      })
      .where(
        and(
          eq(tasks.parentId, taskId),
          eq(tasks.ownerId, actorId),
          isNull(tasks.deletedAt),
        ),
      );
    return { kind: "deleted" };
  });
}
