import { UnauthenticatedError, requireUser } from "@/server/auth/session";
import {
  errorResponse,
  hasJsonContentType,
  isAllowedOrigin,
  readJsonBodyWithLimit,
  NO_STORE,
} from "@/server/http";
import { getProject, updateProject } from "@/server/projects/service";
import { isValidProjectId, parseProjectPatch, toProjectDTO } from "@/lib/projects";

/**
 * Versioned project item endpoint (TASK-006): GET/PATCH одного СВОЕГО
 * проекта (активного или архивного). Item endpoints query не поддерживают
 * (400); DELETE не реализован. Invalid UUID syntax → 400; валидный
 * неизвестный/чужой UUID → одинаковый 404 NOT_FOUND без раскрытия
 * имени/owner/archive state. PATCH: непустой subset {name?, archived?},
 * атомарный owner-scoped update (WHERE id AND owner_id), validation не
 * пишет DB, несуществующий проект не создаётся. Mutations — точная
 * Origin-защита; все ответы private, no-store; ошибки без
 * email/SQL/stack/cookie.
 */

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ projectId: string }> };

async function resolveRouteGuard(
  context: RouteContext,
  request: Request,
): Promise<{ projectId: string } | Response> {
  const { projectId } = await context.params;
  if (!isValidProjectId(projectId)) {
    return errorResponse(400, "VALIDATION_ERROR", "projectId");
  }
  const query = new URL(request.url).searchParams;
  if ([...query.keys()].length > 0) {
    return errorResponse(400, "VALIDATION_ERROR");
  }
  return { projectId };
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
    const project = await getProject(user.id, guard.projectId);
    if (project === null) {
      return errorResponse(404, "NOT_FOUND");
    }
    return Response.json({ project: toProjectDTO(project) }, { headers: NO_STORE });
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
  const body = await readJsonBodyWithLimit(request);
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

    const parsed = parseProjectPatch(body.json);
    if (!parsed.ok) {
      return errorResponse(400, "VALIDATION_ERROR", parsed.field);
    }
    const project = await updateProject(user.id, guard.projectId, parsed.patch);
    if (project === null) {
      // Чужой и неизвестный id неразличимы; ничего не создано.
      return errorResponse(404, "NOT_FOUND");
    }
    return Response.json({ project: toProjectDTO(project) }, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof UnauthenticatedError) {
      return errorResponse(401, "UNAUTHENTICATED");
    }
    return errorResponse(500, "INTERNAL");
  }
}
