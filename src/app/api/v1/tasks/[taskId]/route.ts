import { UnauthenticatedError, requireUser } from "@/server/auth/session";
import {
  errorResponse,
  hasJsonContentType,
  isAllowedOrigin,
  readBodySizeWithLimit,
  readJsonBodyWithLimit,
  NO_STORE,
} from "@/server/http";
import {
  getTask,
  mutateTask,
  softDeleteTask,
  type TaskMutationOutcome,
} from "@/server/tasks/service";
import {
  TASKS_MAX_JSON_BODY_BYTES,
  isValidTaskId,
  parseTaskPatch,
  toTaskDTO,
} from "@/lib/tasks";

/**
 * Versioned task item endpoint (TASK-007): GET/PATCH/DELETE собственной
 * не-deleted задачи. Item query не поддерживается (400); invalid UUID →400.
 * Foreign/missing/deleted → одинаковый 404 для GET/PATCH; повторный DELETE
 * своей уже удалённой задачи → 204 no-op. PATCH — непустой subset
 * {title?, completed?} в транзакции с row lock; child/recurrence →
 * 409 UNSUPPORTED_TASK, задача архивного проекта → 409 PROJECT_ARCHIVED.
 * DELETE — soft delete без body (непустой body →400, >2KiB →413), без
 * media requirement. Mutations — точная Origin-защита; все ответы,
 * включая 204, private, no-store; ошибки без приватных подробностей.
 */

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ taskId: string }> };

async function resolveRouteGuard(
  context: RouteContext,
  request: Request,
): Promise<{ taskId: string } | Response> {
  const { taskId } = await context.params;
  if (!isValidTaskId(taskId)) {
    return errorResponse(400, "VALIDATION_ERROR", "taskId");
  }
  if (new URL(request.url).search !== "") {
    return errorResponse(400, "VALIDATION_ERROR");
  }
  return { taskId };
}

function mutationErrorResponse(outcome: TaskMutationOutcome): Response | null {
  if (outcome.kind === "task") {
    return null;
  }
  if (outcome.kind === "not-found") {
    return errorResponse(404, "NOT_FOUND");
  }
  if (outcome.kind === "unsupported") {
    return errorResponse(409, "UNSUPPORTED_TASK");
  }
  if (outcome.kind === "validation") {
    return errorResponse(400, "VALIDATION_ERROR", outcome.field);
  }
  return errorResponse(409, "PROJECT_ARCHIVED");
}

export async function GET(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  const guard = await resolveRouteGuard(context, request);
  if (guard instanceof Response) {
    return guard;
  }
  try {
    const user = await requireUser();
    const task = await getTask(user.id, guard.taskId);
    if (task === null) {
      return errorResponse(404, "NOT_FOUND");
    }
    return Response.json({ task: toTaskDTO(task) }, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof UnauthenticatedError) {
      return errorResponse(401, "UNAUTHENTICATED");
    }
    return errorResponse(500, "INTERNAL");
  }
}

export async function PATCH(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  const guard = await resolveRouteGuard(context, request);
  if (guard instanceof Response) {
    return guard;
  }
  if (!hasJsonContentType(request)) {
    return errorResponse(415, "UNSUPPORTED_MEDIA_TYPE");
  }
  const body = await readJsonBodyWithLimit(request, TASKS_MAX_JSON_BODY_BYTES);
  if (!body.ok) {
    return errorResponse(
      body.malformed ? 400 : 413,
      body.malformed ? "VALIDATION_ERROR" : "PAYLOAD_TOO_LARGE",
    );
  }
  try {
    // Session до любой mutation: анонимный вызов ничего не меняет.
    const user = await requireUser();

    if (!isAllowedOrigin(request.headers.get("origin"))) {
      return errorResponse(403, "FORBIDDEN_ORIGIN");
    }

    const parsed = parseTaskPatch(body.json);
    if (!parsed.ok) {
      return errorResponse(400, "VALIDATION_ERROR", parsed.field);
    }
    const outcome = await mutateTask(user.id, guard.taskId, parsed.patch);
    const errorResponseByOutcome = mutationErrorResponse(outcome);
    if (errorResponseByOutcome !== null) {
      return errorResponseByOutcome;
    }
    if (outcome.kind !== "task") {
      return errorResponse(500, "INTERNAL");
    }
    return Response.json({ task: toTaskDTO(outcome.task) }, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof UnauthenticatedError) {
      return errorResponse(401, "UNAUTHENTICATED");
    }
    return errorResponse(500, "INTERNAL");
  }
}

export async function DELETE(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  const guard = await resolveRouteGuard(context, request);
  if (guard instanceof Response) {
    return guard;
  }
  // DELETE без media requirement; непустой body →400, >2KiB →413.
  const body = await readBodySizeWithLimit(request);
  if (!body.ok) {
    return errorResponse(413, "PAYLOAD_TOO_LARGE");
  }
  if (body.bytes > 0) {
    return errorResponse(400, "VALIDATION_ERROR");
  }
  try {
    const user = await requireUser();

    if (!isAllowedOrigin(request.headers.get("origin"))) {
      return errorResponse(403, "FORBIDDEN_ORIGIN");
    }

    const outcome = await softDeleteTask(user.id, guard.taskId);
    if (outcome.kind === "not-found") {
      return errorResponse(404, "NOT_FOUND");
    }
    if (outcome.kind === "unsupported") {
      return errorResponse(409, "UNSUPPORTED_TASK");
    }
    if (outcome.kind === "project-archived") {
      return errorResponse(409, "PROJECT_ARCHIVED");
    }
    // deleted и noop — 204 без тела.
    return new Response(null, { status: 204, headers: NO_STORE });
  } catch (error) {
    if (error instanceof UnauthenticatedError) {
      return errorResponse(401, "UNAUTHENTICATED");
    }
    return errorResponse(500, "INTERNAL");
  }
}
