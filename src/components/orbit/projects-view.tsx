"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FolderOpen } from "lucide-react";
import { EmptyView } from "@/components/orbit/empty-view";
import type { ProjectDTO } from "@/lib/projects";
import { parseProjectName } from "@/lib/projects";
import { ru } from "@/lib/i18n/ru";

type ProjectTab = "active" | "archived";

type ProjectsLists = {
  active: ProjectDTO[];
  archived: ProjectDTO[];
};

async function fetchList(
  status: "active" | "archived",
): Promise<ProjectDTO[] | null> {
  const response = await fetch(`/api/v1/projects?status=${status}`);
  if (!response.ok) {
    return null;
  }
  const payload = (await response.json()) as {
    projects?: ProjectDTO[];
  };
  return Array.isArray(payload.projects) ? payload.projects : null;
}

/**
 * Реальный экран /projects (TASK-006): список активных и архивных проектов,
 * create/rename/archive/restore через подтверждённые server responses и
 * обновление списка с сервера. Оптимистичных записей нет: проект не
 * исчезает при failed archive/rename, failed create не показывается
 * созданным. Имя проекта — текст (React escaping), не ссылка.
 *
 * Lifecycle/actor guard (инварианты TASK-005): ответы после unmount или
 * смены actor игнорируются целиком (state и повторы); запросы не
 * прерываются — законные серверные записи прежнего actor завершаются.
 * Эффект mounted-флага симметричен setup/cleanup — корректен под React
 * StrictMode replay в next dev. Pending исключает double submit и потерю
 * draft; после ошибки draft остаётся для retry.
 */
export function ProjectsView({
  initialActive,
  initialArchived,
  actorId,
}: {
  initialActive: ProjectDTO[];
  initialArchived: ProjectDTO[];
  actorId: string;
}) {
  const [lists, setLists] = useState<ProjectsLists>({
    active: initialActive,
    archived: initialArchived,
  });
  const [tab, setTab] = useState<ProjectTab>("active");
  const [listError, setListError] = useState(false);
  const [listPending, setListPending] = useState(false);

  const [createDraft, setCreateDraft] = useState("");
  const [createPending, setCreatePending] = useState(false);
  const [createInvalid, setCreateInvalid] = useState(false);
  const [createError, setCreateError] = useState(false);

  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [renamePending, setRenamePending] = useState(false);
  const [renameInvalid, setRenameInvalid] = useState(false);
  const [renameError, setRenameError] = useState(false);
  // Фокус возвращается к trigger ПОСЛЕ коммита (строка пересоздаётся).
  // Новый объект на каждый close перезапускает эффект; сам эффект только
  // фокусирует DOM-узел (без setState), поэтому StrictMode-replay
  // идемпотентен и каскадных рендеров нет.
  const [renameFocusTarget, setRenameFocusTarget] = useState<{
    id: string;
    nonce: number;
  } | null>(null);

  const [archivePendingId, setArchivePendingId] = useState<string | null>(null);
  const [archiveError, setArchiveError] = useState<string | null>(null);

  const mountedRef = useRef(true);
  const actorRef = useRef(actorId);
  const createInFlight = useRef(false);
  const renameInFlight = useRef(false);
  const archiveInFlight = useRef(false);
  const focusNonceRef = useRef(0);

  useEffect(() => {
    actorRef.current = actorId;
  }, [actorId]);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
  useEffect(() => {
    if (renameFocusTarget === null) {
      return;
    }
    document.getElementById(`rename-trigger-${renameFocusTarget.id}`)?.focus();
  }, [renameFocusTarget]);

  async function refreshLists(): Promise<boolean> {
    const requestedActorId = actorRef.current;
    setListPending(true);
    try {
      const [active, archived] = await Promise.all([
        fetchList("active"),
        fetchList("archived"),
      ]);
      if (!mountedRef.current || actorRef.current !== requestedActorId) {
        return false;
      }
      if (active === null || archived === null) {
        setListError(true);
        return false;
      }
      setLists({ active, archived });
      setListError(false);
      return true;
    } finally {
      if (mountedRef.current && actorRef.current === requestedActorId) {
        setListPending(false);
      }
    }
  }

  async function handleCreate(): Promise<void> {
    if (createInFlight.current) {
      return;
    }
    const parsed = parseProjectName(createDraft);
    if (!parsed.ok) {
      setCreateInvalid(true);
      setCreateError(false);
      return;
    }
    setCreateInvalid(false);
    setCreateError(false);
    setCreatePending(true);
    createInFlight.current = true;
    try {
      const response = await fetch("/api/v1/projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: parsed.name }),
      });
      if (!mountedRef.current) {
        return;
      }
      if (response.ok) {
        setCreateDraft("");
        await refreshLists();
        return;
      }
      setCreateError(true);
    } catch {
      if (mountedRef.current) {
        setCreateError(true);
      }
    } finally {
      createInFlight.current = false;
      if (mountedRef.current) {
        setCreatePending(false);
      }
    }
  }

  function openRename(project: ProjectDTO): void {
    // Пока сохранение rename не завершилось, другой editor не открывается:
    // завершение прежнего запроса не должно закрывать/менять новую форму.
    if (renamePending || renameInFlight.current) {
      return;
    }
    setRenameId(project.id);
    setRenameDraft(project.name);
    setRenameInvalid(false);
    setRenameError(false);
  }

  function closeRename(projectId: string): void {
    setRenameId(null);
    setRenameDraft("");
    // Фокус возвращается к trigger после коммита: строка пересоздаётся,
    // прежний узел уничтожен (см. renameFocusTarget effect).
    focusNonceRef.current += 1;
    setRenameFocusTarget({ id: projectId, nonce: focusNonceRef.current });
  }

  async function handleRenameSubmit(): Promise<void> {
    if (renameInFlight.current || renameId === null) {
      return;
    }
    const parsed = parseProjectName(renameDraft);
    if (!parsed.ok) {
      setRenameInvalid(true);
      setRenameError(false);
      return;
    }
    setRenameInvalid(false);
    setRenameError(false);
    setRenamePending(true);
    renameInFlight.current = true;
    const renameTargetId = renameId;
    try {
      const response = await fetch(`/api/v1/projects/${renameTargetId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: parsed.name }),
      });
      if (!mountedRef.current) {
        return;
      }
      if (response.ok) {
        closeRename(renameTargetId);
        await refreshLists();
        return;
      }
      setRenameError(true);
    } catch {
      if (mountedRef.current) {
        setRenameError(true);
      }
    } finally {
      renameInFlight.current = false;
      if (mountedRef.current) {
        setRenamePending(false);
      }
    }
  }

  async function handleArchiveToggle(
    project: ProjectDTO,
    archived: boolean,
  ): Promise<void> {
    if (archiveInFlight.current) {
      return;
    }
    setArchiveError(null);
    setArchivePendingId(project.id);
    archiveInFlight.current = true;
    try {
      const response = await fetch(`/api/v1/projects/${project.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ archived }),
      });
      if (!mountedRef.current) {
        return;
      }
      if (response.ok) {
        await refreshLists();
        return;
      }
      setArchiveError(
        archived ? ru.projects.archive.errorActive : ru.projects.archive.errorArchived,
      );
    } catch {
      if (mountedRef.current) {
        setArchiveError(
          archived
            ? ru.projects.archive.errorActive
            : ru.projects.archive.errorArchived,
        );
      }
    } finally {
      archiveInFlight.current = false;
      if (mountedRef.current) {
        setArchivePendingId(null);
      }
    }
  }

  const visibleProjects = tab === "active" ? lists.active : lists.archived;

  return (
    <div>
      <form
        className="rounded-xl border bg-card p-4"
        onSubmit={(event) => {
          event.preventDefault();
          void handleCreate();
        }}
        aria-busy={createPending}
      >
        <Label htmlFor="project-name-input">{ru.projects.create.label}</Label>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
          <Input
            id="project-name-input"
            name="name"
            type="text"
            autoComplete="off"
            className="min-h-11 max-w-72"
            placeholder={ru.projects.create.placeholder}
            value={createDraft}
            onChange={(event) => {
              setCreateDraft(event.target.value);
              if (createInvalid) {
                setCreateInvalid(false);
              }
            }}
            aria-invalid={createInvalid || undefined}
            aria-describedby="project-create-status"
            disabled={createPending}
          />
          <Button
            type="submit"
            className="min-h-11 px-4"
            disabled={createPending}
          >
            {createPending ? ru.projects.create.submitting : ru.projects.create.submit}
          </Button>
        </div>
        <p
          id="project-create-status"
          aria-live="polite"
          className="mt-2 text-sm leading-5"
        >
          {createInvalid ? (
            <span role="alert" className="text-destructive">
              {ru.projects.create.invalid}
            </span>
          ) : createError ? (
            <span role="alert" className="text-destructive">
              {ru.projects.create.error}
            </span>
          ) : null}
        </p>
      </form>

      <div className="mt-4 flex gap-2" role="group" aria-label={ru.nav.projects}>
        {(["active", "archived"] as const).map((value) => (
          <Button
            key={value}
            type="button"
            variant={tab === value ? "default" : "outline"}
            aria-pressed={tab === value}
            className="min-h-11 px-4"
            onClick={() => setTab(value)}
          >
            {value === "active" ? ru.projects.tabs.active : ru.projects.tabs.archived}
          </Button>
        ))}
      </div>

      {listError ? (
        <div className="mt-4 rounded-xl border bg-card p-4">
          <p role="alert" className="text-sm text-destructive">
            {ru.projects.listError}
          </p>
          <Button
            type="button"
            variant="outline"
            className="mt-2 min-h-11 px-4"
            onClick={() => void refreshLists()}
            disabled={listPending}
          >
            {ru.projects.retry}
          </Button>
        </div>
      ) : null}

      {visibleProjects.length === 0 ? (
        <div className="mt-4">
          <EmptyView
            icon={FolderOpen}
            title={
              tab === "active"
                ? ru.pages.projects.empty.title
                : ru.projects.archivedEmpty.title
            }
            description={
              tab === "active"
                ? ru.pages.projects.empty.description
                : ru.projects.archivedEmpty.description
            }
          />
        </div>
      ) : (
        <ul className="mt-4 flex flex-col gap-2">
          {visibleProjects.map((project) => {
            const renameOpen = renameId === project.id;
            const archivePending = archivePendingId === project.id;
            const archived = project.archivedAt !== null;
            return (
              <li
                key={project.id}
                className="rounded-xl border bg-card p-4"
                data-project-id={project.id}
              >
                {renameOpen ? (
                  <form
                    onSubmit={(event) => {
                      event.preventDefault();
                      void handleRenameSubmit();
                    }}
                    aria-busy={renamePending}
                  >
                    <Label htmlFor={`rename-input-${project.id}`}>
                      {ru.projects.rename.action}
                    </Label>
                    <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center">
                      <Input
                        id={`rename-input-${project.id}`}
                        type="text"
                        autoComplete="off"
                        className="min-h-11 max-w-72"
                        value={renameDraft}
                        onChange={(event) => {
                          setRenameDraft(event.target.value);
                          if (renameInvalid) {
                            setRenameInvalid(false);
                          }
                        }}
                        aria-invalid={renameInvalid || undefined}
                        disabled={renamePending}
                      />
                      <Button
                        type="submit"
                        className="min-h-11 px-4"
                        disabled={renamePending}
                      >
                        {renamePending
                          ? ru.projects.rename.saving
                          : ru.projects.rename.save}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        className="min-h-11 px-4"
                        onClick={() => closeRename(project.id)}
                        disabled={renamePending}
                      >
                        {ru.projects.rename.cancel}
                      </Button>
                    </div>
                    <p aria-live="polite" className="mt-2 text-sm leading-5">
                      {renameInvalid ? (
                        <span role="alert" className="text-destructive">
                          {ru.projects.rename.invalid}
                        </span>
                      ) : renameError ? (
                        <span role="alert" className="text-destructive">
                          {ru.projects.rename.error}
                        </span>
                      ) : null}
                    </p>
                  </form>
                ) : (
                  <>
                    <p className="break-words text-sm font-medium leading-6">
                      {project.name}
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        id={`rename-trigger-${project.id}`}
                        className="min-h-11 px-4"
                        onClick={() => openRename(project)}
                        disabled={archivePending || renamePending}
                      >
                        {ru.projects.rename.action}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        className="min-h-11 px-4"
                        onClick={() =>
                          void handleArchiveToggle(project, !archived)
                        }
                        disabled={archivePending || renamePending}
                      >
                        {archivePending
                          ? archived
                            ? ru.projects.archive.pendingArchived
                            : ru.projects.archive.pendingActive
                          : archived
                            ? ru.projects.archive.restore
                            : ru.projects.archive.action}
                      </Button>
                    </div>
                    {archiveError !== null && archivePendingId === null ? (
                      <p role="alert" className="mt-2 text-sm text-destructive">
                        {archiveError}
                      </p>
                    ) : null}
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
