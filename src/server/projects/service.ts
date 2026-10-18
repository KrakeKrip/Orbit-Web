import "server-only";

import { and, asc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import { projects } from "@/server/db/schema";
import type { ProjectListStatus, ProjectPatch } from "@/lib/projects";

/**
 * Project service (TASK-006): owner-scoped list/read/create/update на
 * существующей таблице projects. Доверенный actor — только server-derived
 * id из requireUser; client owner_id/user_id не принимается. Каждый запрос
 * фильтруется WHERE owner_id = actor.id; item update — WHERE id AND
 * owner_id без read-by-id → unscoped update. Чужой и неизвестный id
 * неразличимы (null).
 *
 * Create: id генерирует БД (UUID default), owner из session, archived_at
 * null, sort_order default 0; повторяющиеся имена разрешены.
 *
 * Update: один атомарный owner-scoped UPDATE ... RETURNING; комбинированный
 * name/archived меняется атомарно. Повторный archive=true сохраняет исходный
 * archived_at (COALESCE), restore=false пишет NULL (повтор остаётся null),
 * повторное архивирование после restore ставит новый timestamp. updated_at —
 * явный server write. Archive/restore не трогают связанные tasks. Стабильная
 * сортировка: sort_order ASC, created_at ASC, id ASC; no cross-request cache.
 */

export type ProjectRecord = {
  id: string;
  name: string;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export async function listProjects(
  actorId: string,
  status: ProjectListStatus,
): Promise<ProjectRecord[]> {
  const ownerFilter = eq(projects.ownerId, actorId);
  const archiveFilter =
    status === "active"
      ? isNull(projects.archivedAt)
      : status === "archived"
        ? isNotNull(projects.archivedAt)
        : undefined;
  return getDb()
    .select({
      id: projects.id,
      name: projects.name,
      archivedAt: projects.archivedAt,
      createdAt: projects.createdAt,
      updatedAt: projects.updatedAt,
    })
    .from(projects)
    .where(archiveFilter === undefined ? ownerFilter : and(ownerFilter, archiveFilter))
    .orderBy(asc(projects.sortOrder), asc(projects.createdAt), asc(projects.id));
}

export async function getProject(
  actorId: string,
  projectId: string,
): Promise<ProjectRecord | null> {
  const rows = await getDb()
    .select({
      id: projects.id,
      name: projects.name,
      archivedAt: projects.archivedAt,
      createdAt: projects.createdAt,
      updatedAt: projects.updatedAt,
    })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.ownerId, actorId)))
    .limit(1);
  return rows[0] ?? null;
}

export async function createProject(
  actorId: string,
  name: string,
): Promise<ProjectRecord> {
  const rows = await getDb()
    .insert(projects)
    .values({ ownerId: actorId, name })
    .returning({
      id: projects.id,
      name: projects.name,
      archivedAt: projects.archivedAt,
      createdAt: projects.createdAt,
      updatedAt: projects.updatedAt,
    });
  const row = rows[0];
  if (!row) {
    throw new Error("Project insert returned no row.");
  }
  return row;
}

/**
 * Атомарный частичный update: изменяются только переданные поля.
 * archived=true — COALESCE(archived_at, now()): исходный timestamp архива
 * сохраняется при повторе; false — NULL; после restore повторное
 * архивирование даёт новый timestamp. updated_at — явный server write.
 * null-результат = проект отсутствует или чужой (неразличимо для caller).
 */
export async function updateProject(
  actorId: string,
  projectId: string,
  patch: ProjectPatch,
): Promise<ProjectRecord | null> {
  const rows = await getDb()
    .update(projects)
    .set({
      ...(patch.name === undefined ? {} : { name: patch.name }),
      ...(patch.archived === undefined
        ? {}
        : patch.archived
          ? { archivedAt: sql`coalesce(${projects.archivedAt}, now())` }
          : { archivedAt: null }),
      // now() из БД: server write теми же часами, что и created_at
      // (кросс-часовые сравнения node/pg при скью VM дают flaky).
      updatedAt: sql`now()`,
    })
    .where(and(eq(projects.id, projectId), eq(projects.ownerId, actorId)))
    .returning({
      id: projects.id,
      name: projects.name,
      archivedAt: projects.archivedAt,
      createdAt: projects.createdAt,
      updatedAt: projects.updatedAt,
    });
  return rows[0] ?? null;
}
