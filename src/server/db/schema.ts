import { sql } from "drizzle-orm";
import {
  check,
  date,
  foreignKey,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  time,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { user } from "./schema.auth";

/**
 * Доменная схема Orbit (TASK-003). Core auth таблицы — в schema.auth.ts,
 * сгенерированы официальным CLI закреплённой версии Better Auth и не
 * редактируются вручную.
 *
 * Права владения: task→project, task→parent и completion→task связаны
 * composite FK по (id, owner_id), поэтому смена owner или project не может
 * разорвать ссылку между пользователями. Каскадное удаление не используется:
 * будущие удаления — soft delete (TASK-006/007).
 *
 * Правила, осознанно оставленные service-слою (не FK/CHECK): один уровень
 * вложенности, отсутствие циклов, совпадение project родителя/ребёнка,
 * архивация и soft delete, IANA-валидация timezone. updated_at: default
 * заполняет insert; обновление timestamp при UPDATE — обязанность
 * сервиса/ORM (без триггеров).
 */

export const userTheme = pgEnum("user_theme", ["light", "dark", "system"]);

export const taskRecurrenceRule = pgEnum("task_recurrence_rule", [
  "DAILY",
  "WEEKDAYS",
  "WEEKLY",
]);

export const userSettings = pgTable(
  "user_settings",
  {
    userId: text("user_id")
      .primaryKey()
      .references(() => user.id, { onUpdate: "restrict", onDelete: "restrict" }),
    timezone: text("timezone").notNull().default("UTC"),
    theme: userTheme("theme").notNull().default("system"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    check(
      "user_settings_timezone_not_blank",
      sql`char_length(btrim(${t.timezone})) > 0`,
    ),
  ],
);

export const projects = pgTable(
  "projects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => user.id, { onUpdate: "restrict", onDelete: "restrict" }),
    name: text("name").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique("projects_id_owner_id_key").on(t.id, t.ownerId),
    index("projects_owner_id_idx").on(t.ownerId),
    check(
      "projects_name_not_blank",
      sql`char_length(btrim(${t.name})) > 0`,
    ),
    check(
      "projects_name_max_length",
      sql`char_length(${t.name}) <= 120`,
    ),
  ],
);

export const tasks = pgTable(
  "tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => user.id, { onUpdate: "restrict", onDelete: "restrict" }),
    projectId: uuid("project_id"),
    parentId: uuid("parent_id"),
    title: text("title").notNull(),
    notes: text("notes"),
    priority: integer("priority").notNull().default(4),
    plannedDate: date("planned_date"),
    plannedTime: time("planned_time"),
    deadlineDate: date("deadline_date"),
    recurrenceRule: taskRecurrenceRule("recurrence_rule"),
    sortOrder: integer("sort_order").notNull().default(0),
    revision: integer("revision").notNull().default(0),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique("tasks_id_owner_id_key").on(t.id, t.ownerId),
    foreignKey({
      name: "tasks_project_owner_fkey",
      columns: [t.projectId, t.ownerId],
      foreignColumns: [projects.id, projects.ownerId],
    }),
    foreignKey({
      name: "tasks_parent_owner_fkey",
      columns: [t.parentId, t.ownerId],
      foreignColumns: [t.id, t.ownerId],
    }),
    index("tasks_owner_planned_date_idx")
      .on(t.ownerId, t.plannedDate)
      .where(sql`${t.deletedAt} IS NULL`),
    index("tasks_owner_deadline_date_idx")
      .on(t.ownerId, t.deadlineDate)
      .where(sql`${t.deletedAt} IS NULL`),
    index("tasks_owner_project_idx").on(t.ownerId, t.projectId),
    index("tasks_owner_parent_idx").on(t.ownerId, t.parentId),
    check("tasks_parent_not_self", sql`${t.parentId} IS NULL OR ${t.parentId} <> ${t.id}`),
    check("tasks_title_not_blank", sql`char_length(btrim(${t.title})) > 0`),
    check("tasks_title_max_length", sql`char_length(${t.title}) <= 500`),
    check(
      "tasks_notes_max_length",
      sql`${t.notes} IS NULL OR char_length(${t.notes}) <= 10000`,
    ),
    check("tasks_priority_range", sql`${t.priority} BETWEEN 1 AND 4`),
    check("tasks_revision_non_negative", sql`${t.revision} >= 0`),
    check(
      "tasks_planned_time_requires_planned_date",
      sql`${t.plannedTime} IS NULL OR ${t.plannedDate} IS NOT NULL`,
    ),
    check(
      "tasks_recurrence_requires_planned_date",
      sql`${t.recurrenceRule} IS NULL OR ${t.plannedDate} IS NOT NULL`,
    ),
    check(
      "tasks_recurrence_excludes_deadline",
      sql`${t.recurrenceRule} IS NULL OR ${t.deadlineDate} IS NULL`,
    ),
    check(
      "tasks_recurring_no_permanent_completed_at",
      sql`${t.recurrenceRule} IS NULL OR ${t.completedAt} IS NULL`,
    ),
  ],
);

export const taskCompletions = pgTable(
  "task_completions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => user.id, { onUpdate: "restrict", onDelete: "restrict" }),
    taskId: uuid("task_id").notNull(),
    occurrenceDate: date("occurrence_date"),
    completedAt: timestamp("completed_at", { withTimezone: true }).notNull(),
    completedRevision: integer("completed_revision").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
  },
  (t) => [
    foreignKey({
      name: "task_completions_task_owner_fkey",
      columns: [t.taskId, t.ownerId],
      foreignColumns: [tasks.id, tasks.ownerId],
    }),
    unique("task_completions_owner_idempotency_key").on(
      t.ownerId,
      t.idempotencyKey,
    ),
    unique("task_completions_task_completed_revision_key").on(
      t.taskId,
      t.completedRevision,
    ),
    index("task_completions_owner_completed_at_idx").on(
      t.ownerId,
      t.completedAt,
    ),
    check(
      "task_completions_completed_revision_non_negative",
      sql`${t.completedRevision} >= 0`,
    ),
    check(
      "task_completions_idempotency_key_not_blank",
      sql`char_length(btrim(${t.idempotencyKey})) > 0`,
    ),
    check(
      "task_completions_idempotency_key_max_length",
      sql`char_length(${t.idempotencyKey}) <= 128`,
    ),
  ],
);
