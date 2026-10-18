import { UnauthenticatedError, requireUser } from "@/server/auth/session";
import {
  errorResponse,
  hasJsonContentType,
  isAllowedOrigin,
  readJsonBodyWithLimit,
  NO_STORE,
} from "@/server/http";
import { createProject, listProjects } from "@/server/projects/service";
import {
  parseProjectCreate,
  parseProjectListStatusQuery,
  toProjectDTO,
} from "@/lib/projects";

/**
 * Versioned projects collection endpoint (TASK-006). Actor только из
 * проверенной сессии; списки строго owner-scoped. GET: единственный query
 * `status=active|archived|all` (default active), unsupported/duplicate/
 * unknown →400. POST: JSON {name} → 201 {project}; неизвестные поля
 * (id/owner_id/sort_order/archived) запрещены; id генерирует БД. POST не
 * обязан быть idempotent. Mutations — точная Origin-защита configured
 * BETTER_AUTH_URL (собственная, не Better Auth handler); транспорт:
 * media type 415 → размер 413 (потоковый лимит) → malformed JSON 400 →
 * auth 401 → origin 403 → validation 400 → mutation. Любой отказ не пишет
 * в БД. Все ответы, включая ошибки: private, no-store.
 */

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const query = new URL(request.url).searchParams;
  const parsedStatus = parseProjectListStatusQuery(query);
  if (!parsedStatus.ok) {
    return errorResponse(400, "VALIDATION_ERROR");
  }
  try {
    const user = await requireUser();
    const projects = await listProjects(user.id, parsedStatus.status);
    return Response.json(
      { projects: projects.map(toProjectDTO) },
      { headers: NO_STORE },
    );
  } catch (error) {
    if (error instanceof UnauthenticatedError) {
      return errorResponse(401, "UNAUTHENTICATED");
    }
    return errorResponse(500, "INTERNAL");
  }
}

export async function POST(request: Request): Promise<Response> {
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
    // Session до любой mutation: анонимный вызов не создаёт project.
    const user = await requireUser();

    if (!isAllowedOrigin(request.headers.get("origin"))) {
      return errorResponse(403, "FORBIDDEN_ORIGIN");
    }

    const parsed = parseProjectCreate(body.json);
    if (!parsed.ok) {
      return errorResponse(400, "VALIDATION_ERROR", parsed.field);
    }
    const project = await createProject(user.id, parsed.name);
    return Response.json(
      { project: toProjectDTO(project) },
      { status: 201, headers: NO_STORE },
    );
  } catch (error) {
    if (error instanceof UnauthenticatedError) {
      return errorResponse(401, "UNAUTHENTICATED");
    }
    return errorResponse(500, "INTERNAL");
  }
}
