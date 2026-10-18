"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Единая точка task-мутаций для Inbox/Today/Upcoming (TASK-008):
 * pending/error-состояния, in-flight guards (никакой второй mutation/первой
 * мутации при чужой в полёте), stale callback suppression (mounted/actor),
 * R1 read handling (onConfirmed возвращает false при сбое чтения — экран
 * показывает read error/retry; подтверждённая mutation не переклассифицируется),
 * focus policy: success → trigger строки, если она ещё в view, иначе —
 * createFocusElementId; failure → логичный control действия (editor input,
 * delete «Отмена», toggle кнопка). Физические записи не отменяются.
 * R2a: экранная create-мутация входит в этот же guard — create.begin
 * синхронно (до fetch) регистрирует POST в общем in-flight set, end
 * снимает в finally экрана; один write в полёте блокирует и create, и
 * все row writes. anyPending — реактивный aggregate для disabled.
 */

export type TaskWriteKind =
  | "create"
  | "rename"
  | "toggle"
  | "schedule"
  | "delete";

export type TaskWriteOptions = {
  actorId: string;
  /** Control, фокусируемый когда task ушла из view (или после delete). */
  createFocusElementId: string;
  /** Перечитывание экрана после подтверждённой mutation. false = read failure. */
  onConfirmed: () => Promise<boolean>;
};

const KINDS: TaskWriteKind[] = [
  "create",
  "rename",
  "toggle",
  "schedule",
  "delete",
];

export function useTaskWrites({
  actorId,
  createFocusElementId,
  onConfirmed,
}: TaskWriteOptions) {
  const [renameTaskId, setRenameTaskId] = useState<string | null>(null);
  const [renamePending, setRenamePending] = useState(false);
  const [renameError, setRenameError] = useState(false);

  const [toggleTaskId, setToggleTaskId] = useState<string | null>(null);
  const [toggleErrorTaskId, setToggleErrorTaskId] = useState<string | null>(null);

  const [scheduleTaskId, setScheduleTaskId] = useState<string | null>(null);
  const [schedulePending, setSchedulePending] = useState(false);
  const [scheduleErrorTaskId, setScheduleErrorTaskId] = useState<string | null>(null);

  const [deleteTaskId, setDeleteTaskId] = useState<string | null>(null);
  const [deletePending, setDeletePending] = useState(false);
  const [deleteErrorTaskId, setDeleteErrorTaskId] = useState<string | null>(null);

  // R2a: экранная create-мутация (у экрана свой fetch/draft-стейт, guard
  // общий). Реактивный createPending для disabled контролов.
  const [createPending, setCreatePending] = useState(false);

  const mountedRef = useRef(true);
  const actorRef = useRef(actorId);
  const inFlightRef = useRef<Set<TaskWriteKind>>(new Set());
  const focusNonceRef = useRef(0);
  // R2b1: активная форма экрана — одна. Ref (не state): open/close guards
  // синхронны и работают до render; state-поля остаются зеркалом для UI.
  const activeFormRef = useRef<{
    kind: "rename" | "schedule" | "delete";
    taskId: string;
  } | null>(null);

  useEffect(() => {
    actorRef.current = actorId;
  }, [actorId]);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const anyInFlight = useCallback(
    (): boolean => inFlightRef.current.size > 0,
    [],
  );
  const isCurrent = useCallback(
    (requestedActorId: string): boolean =>
      mountedRef.current && actorRef.current === requestedActorId,
    [],
  );

  // R2a: регистрация create в общем guard. Синхронно до fetch: false =
  // любой write (row или create) уже в полёте — POST не отправляется.
  const beginCreate = useCallback((): boolean => {
    if (anyInFlight()) {
      return false;
    }
    inFlightRef.current.add("create");
    setCreatePending(true);
    return true;
  }, [anyInFlight]);

  // Снятие регистрации в finally экрана; ref чистится всегда, чтобы
  // guard не залип после unmount/смены actor.
  const endCreate = useCallback((): void => {
    inFlightRef.current.delete("create");
    if (mountedRef.current) {
      setCreatePending(false);
    }
  }, []);

  // Программный фокус с коротким циклом попыток: под нагрузкой коммит
  // React и вставка пересозданных узлов могут запаздывать; устойчиво к
  // перерендерам (вне React-цикла). Только для живого экрана/actor:
  // unmount/смена actor отменяет попытки, фокус наружу не переносится.
  const requestFocus = useCallback(
    (elementId: string, requestedActorId: string): void => {
      if (!mountedRef.current || actorRef.current !== requestedActorId) {
        return;
      }
      focusNonceRef.current += 1;
      const nonce = focusNonceRef.current;
      const alive = (): boolean =>
        mountedRef.current && actorRef.current === requestedActorId && nonce === focusNonceRef.current;
      const attempt = (attemptIndex: number): void => {
        if (!alive()) {
          return;
        }
        const element = document.getElementById(elementId);
        if (element !== null) {
          element.focus();
          if (document.activeElement === element) {
            return;
          }
        }
        if (attemptIndex >= 80) {
          return;
        }
        if (typeof requestAnimationFrame === "function") {
          requestAnimationFrame(() => {
            if (alive()) {
              setTimeout(() => attempt(attemptIndex + 1), 30);
            }
          });
        } else {
          setTimeout(() => attempt(attemptIndex + 1), 30);
        }
      };
      attempt(0);
    },
    [],
  );

  const focusAfterSuccess = useCallback(
    (kind: TaskWriteKind, taskId: string, requestedActorId: string): void => {
      // Строка помечена id task-row-<id> (TaskRow li): если она ещё в DOM
      // после refetch — фокус на её trigger (id task-<kind>-trigger-<id>),
      // иначе — на createFocusElementId экрана.
      if (document.getElementById(`task-row-${taskId}`) !== null) {
        if (kind === "delete") {
          requestFocus(createFocusElementId, requestedActorId);
          return;
        }
        requestFocus(`task-${kind}-trigger-${taskId}`, requestedActorId);
        return;
      }
      requestFocus(createFocusElementId, requestedActorId);
    },
    [createFocusElementId, requestFocus],
  );

  const focusAfterFailure = useCallback(
    (kind: TaskWriteKind, taskId: string, requestedActorId: string): void => {
      if (kind === "rename") {
        requestFocus(`task-rename-input-${taskId}`, requestedActorId);
        return;
      }
      if (kind === "schedule") {
        requestFocus(`task-schedule-date-input-${taskId}`, requestedActorId);
        return;
      }
      if (kind === "delete") {
        requestFocus(`task-delete-cancel-${taskId}`, requestedActorId);
        return;
      }
      requestFocus(`task-toggle-trigger-${taskId}`, requestedActorId);
    },
    [requestFocus],
  );

  const submitRename = useCallback(
    async (taskId: string, title: string): Promise<boolean> => {
      if (anyInFlight()) {
        return false;
      }
      inFlightRef.current.add("rename");
      setRenameTaskId(taskId);
      setRenamePending(true);
      const requestedActorId = actorRef.current;
      try {
        const response = await fetch(`/api/v1/tasks/${taskId}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ title }),
        });
        if (!isCurrent(requestedActorId)) {
          return false;
        }
        if (!response.ok) {
          setRenameError(true);
          focusAfterFailure("rename", taskId, requestedActorId);
          return false;
        }
        // Подтверждённый rename: read failure — зона экрана (listError),
        // не failed rename.
        await onConfirmed();
        focusAfterSuccess("rename", taskId, requestedActorId);
        return true;
      } catch {
        if (isCurrent(requestedActorId)) {
          setRenameError(true);
          focusAfterFailure("rename", taskId, requestedActorId);
        }
        return false;
      } finally {
        inFlightRef.current.delete("rename");
        if (isCurrent(requestedActorId)) {
          setRenamePending(false);
        }
      }
    },
    [anyInFlight, isCurrent, onConfirmed, focusAfterFailure, focusAfterSuccess],
  );

  const submitToggle = useCallback(
    async (taskId: string, completed: boolean): Promise<boolean> => {
      if (anyInFlight()) {
        return false;
      }
      inFlightRef.current.add("toggle");
      setToggleTaskId(taskId);
      const requestedActorId = actorRef.current;
      try {
        const response = await fetch(`/api/v1/tasks/${taskId}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ completed }),
        });
        if (!isCurrent(requestedActorId)) {
          return false;
        }
        if (!response.ok) {
          setToggleErrorTaskId(taskId);
          focusAfterFailure("toggle", taskId, requestedActorId);
          return false;
        }
        await onConfirmed();
        focusAfterSuccess("toggle", taskId, requestedActorId);
        return true;
      } catch {
        if (isCurrent(requestedActorId)) {
          setToggleErrorTaskId(taskId);
          focusAfterFailure("toggle", taskId, requestedActorId);
        }
        return false;
      } finally {
        inFlightRef.current.delete("toggle");
        if (isCurrent(requestedActorId)) {
          setToggleTaskId(null);
        }
      }
    },
    [anyInFlight, isCurrent, onConfirmed, focusAfterFailure, focusAfterSuccess],
  );

  const submitSchedule = useCallback(
    async (taskId: string, patch: Record<string, string | null>): Promise<boolean> => {
      if (anyInFlight()) {
        return false;
      }
      inFlightRef.current.add("schedule");
      setScheduleTaskId(taskId);
      setSchedulePending(true);
      setScheduleErrorTaskId(null);
      const requestedActorId = actorRef.current;
      try {
        const response = await fetch(`/api/v1/tasks/${taskId}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(patch),
        });
        if (!isCurrent(requestedActorId)) {
          return false;
        }
        if (!response.ok) {
          setScheduleErrorTaskId(taskId);
          focusAfterFailure("schedule", taskId, requestedActorId);
          return false;
        }
        await onConfirmed();
        focusAfterSuccess("schedule", taskId, requestedActorId);
        return true;
      } catch {
        if (isCurrent(requestedActorId)) {
          setScheduleErrorTaskId(taskId);
          focusAfterFailure("schedule", taskId, requestedActorId);
        }
        return false;
      } finally {
        inFlightRef.current.delete("schedule");
        if (isCurrent(requestedActorId)) {
          setSchedulePending(false);
        }
      }
    },
    [anyInFlight, isCurrent, onConfirmed, focusAfterFailure, focusAfterSuccess],
  );

  const submitDelete = useCallback(
    async (taskId: string): Promise<boolean> => {
      if (anyInFlight()) {
        return false;
      }
      inFlightRef.current.add("delete");
      setDeleteTaskId(taskId);
      setDeletePending(true);
      const requestedActorId = actorRef.current;
      try {
        const response = await fetch(`/api/v1/tasks/${taskId}`, {
          method: "DELETE",
        });
        if (!isCurrent(requestedActorId)) {
          return false;
        }
        if (response.ok) {
          // Confirmation закрывается сам (без closeDelete) — выбор формы
          // освобождается синхронно (R2b1, без залипания).
          activeFormRef.current = null;
          setDeleteTaskId(null);
          const readOk = await onConfirmed();
          // Логичный следующий control после успешного удаления — quick-add.
          if (isCurrent(requestedActorId)) {
            requestFocus(createFocusElementId, requestedActorId);
          }
          return readOk;
        }
        setDeleteErrorTaskId(taskId);
        focusAfterFailure("delete", taskId, requestedActorId);
        return false;
      } catch {
        if (isCurrent(requestedActorId)) {
          setDeleteErrorTaskId(taskId);
          focusAfterFailure("delete", taskId, requestedActorId);
        }
        return false;
      } finally {
        inFlightRef.current.delete("delete");
        if (isCurrent(requestedActorId)) {
          setDeletePending(false);
        }
      }
    },
    [anyInFlight, isCurrent, onConfirmed, createFocusElementId, requestFocus, focusAfterFailure],
  );

  // R2b1: пока открыта любая форма, открытие другой (другого типа или
  // задачи) отказывается целиком — старая не закрывается, фокус не
  // переносится, draft/error не теряются. Повторное открытие активной
  // формы — тот же no-op (ошибка/draft не сбрасываются).
  const openRename = useCallback(
    (taskId: string): void => {
      if (anyInFlight() || activeFormRef.current !== null) {
        return;
      }
      activeFormRef.current = { kind: "rename", taskId };
      setRenameTaskId(taskId);
      setRenameError(false);
    },
    [anyInFlight],
  );
  const openSchedule = useCallback(
    (taskId: string): void => {
      if (anyInFlight() || activeFormRef.current !== null) {
        return;
      }
      activeFormRef.current = { kind: "schedule", taskId };
      setScheduleTaskId(taskId);
      setScheduleErrorTaskId(null);
    },
    [anyInFlight],
  );
  const openDelete = useCallback(
    (taskId: string): void => {
      if (anyInFlight() || activeFormRef.current !== null) {
        return;
      }
      activeFormRef.current = { kind: "delete", taskId };
      setDeleteTaskId(taskId);
      setDeleteErrorTaskId(null);
      // R3: фокус в безопасную «Отмену» confirmation. Confirmation
      // монтируется в этом же апдейте — программный фокус с попытками
      // (rAF) устойчив к задержкам коммита под нагрузкой.
      focusNonceRef.current += 1;
      requestFocus(`task-delete-cancel-${taskId}`, actorRef.current);
    },
    [anyInFlight, requestFocus],
  );
  // R2a-fix: cancel guards синхронные и общие — любой write в полёте
  // (свой или чужой) запрещает закрытие editor/confirmation даже при
  // программном вызове до нового render; anyInFlight покрывает и
  // собственный pending (ref снимается в finally). R2b1: успешное
  // закрытие освобождает выбор формы (ref синхронно, без залипания).
  const closeRename = useCallback(
    (taskId: string): void => {
      if (anyInFlight()) {
        return;
      }
      activeFormRef.current = null;
      setRenameTaskId(null);
      requestFocus(`task-rename-trigger-${taskId}`, actorRef.current);
    },
    [anyInFlight, requestFocus],
  );
  const closeSchedule = useCallback(
    (taskId: string): void => {
      if (anyInFlight()) {
        return;
      }
      activeFormRef.current = null;
      setScheduleTaskId(null);
      requestFocus(`task-schedule-trigger-${taskId}`, actorRef.current);
    },
    [anyInFlight, requestFocus],
  );
  const closeDelete = useCallback(
    (taskId: string): void => {
      if (anyInFlight()) {
        return;
      }
      activeFormRef.current = null;
      setDeleteTaskId(null);
      requestFocus(`task-delete-trigger-${taskId}`, actorRef.current);
    },
    [anyInFlight, requestFocus],
  );

  // R2b2: реактивный признак открытой формы (disabled контролов экрана)
  // и синхронный ref-чек для handler guards (до render/state).
  const formOpen =
    renameTaskId !== null || scheduleTaskId !== null || deleteTaskId !== null;

  const anyFormOpen = useCallback(
    (): boolean => activeFormRef.current !== null,
    [],
  );

  // R2a: реактивный aggregate «какая-либо запись в полёте» — create
  // input/submit и row controls отключаются по нему (guards при этом
  // остаются ref-овыми и срабатывают до fetch).
  const anyPending =
    createPending ||
    renamePending ||
    toggleTaskId !== null ||
    schedulePending ||
    deletePending;

  return {
    create: {
      pending: createPending,
      begin: beginCreate,
      end: endCreate,
    },
    rename: {
      taskId: renameTaskId,
      pending: renamePending,
      error: renameError,
      open: openRename,
      close: closeRename,
      submit: submitRename,
    },
    toggle: {
      taskId: toggleTaskId,
      errorTaskId: toggleErrorTaskId,
      submit: submitToggle,
    },
    schedule: {
      taskId: scheduleTaskId,
      pending: schedulePending,
      errorTaskId: scheduleErrorTaskId,
      open: openSchedule,
      close: closeSchedule,
      submit: submitSchedule,
    },
    delete: {
      taskId: deleteTaskId,
      pending: deletePending,
      errorTaskId: deleteErrorTaskId,
      open: openDelete,
      close: closeDelete,
      submit: submitDelete,
    },
    anyPending,
    formOpen,
    anyFormOpen,
    anyInFlight,
  };
}

export { KINDS as TASK_WRITE_KINDS };
