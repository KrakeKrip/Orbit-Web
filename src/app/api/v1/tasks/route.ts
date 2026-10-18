import { UnauthenticatedError, requireUser } from "@/server/auth/session";
import {
  errorResponse,
  hasJsonContentType,
  isAllowedOrigin,
  readJsonBodyWithLimit,
  NO_STORE,
} from "@/server/http";
import { createTask, listTasksView } from "@/server/tasks/service";
import { getTasksReadContext } from "@/server/tasks/context";
import {
  TASKS_MAX_JSON_BODY_BYTES,
  parseTaskCollectionViewQuery,
  parseTaskCreate,
  toTaskDTO,
} from "@/lib/tasks";
import { addCivilDays } from "@/lib/calendar";

/**
 * Versioned tasks collection endpoint (TASK-007 Inbox + TASK-008
 * planning/views). GET — query `view=inbox|today|upcoming` (default inbox),
 * `status=open|completed|all` (default open), `start=YYYY-MM-DD` только для
 * upcoming; duplicate/unknown/лишние keys →400. Ответ единой формы
 * `{tasks, context:{timezone,today,asOf,view,startDate?,endDate?}}`;
 * reference instant — один PostgreSQL read на запрос. Списки строго
 * owner-scoped. POST — {title} + опциональные planning fields → 201
 * {task}: UUID/owner генерирует сервер/БД, прочие колонки по defaults.
 * Query на POST →400. Mutations: точный application/json (415), task
 * streaming лимит 4 KiB (413; title500emoji+schedule), malformed 400,
 * точная Origin-защита (403), session до mutation — любой отказ не создаёт
 * task. Все ответы private, no-store.
 */

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const parsedQuery = parseTaskCollectionViewQuery(
    new URL(request.url).searchParams,
  );
  if (!parsedQuery.ok) {
    return errorResponse(400, "VALIDATION_ERROR");
  }
  try {
    const user = await requireUser();
    const context = await getTasksReadContext(user.id);
    // Reference instant читается один раз: today из context единый для
    // секций/границ/метаданных этого read.
    const startDate =
      parsedQuery.query.view === "upcoming"
        ? (parsedQuery.query.startDate ?? context.today)
        : undefined;
    const tasks = await listTasksView(
      user.id,
      parsedQuery.query.view,
      parsedQuery.query.status,
      context.today,
      startDate,
    );
    const contextPayload: {
      timezone: string;
      today: string;
      asOf: string;
      view: string;
      startDate?: string;
      endDate?: string;
    } = {
      timezone: context.timezone,
      today: context.today,
      asOf: context.asOf,
      view: parsedQuery.query.view,
    };
    if (parsedQuery.query.view === "upcoming" && startDate !== undefined) {
      contextPayload.startDate = startDate;
      contextPayload.endDate = addCivilDays(startDate, 6);
    }
    return Response.json(
      { tasks: tasks.map(toTaskDTO), context: contextPayload },
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
  if (new URL(request.url).search !== "") {
    return errorResponse(400, "VALIDATION_ERROR");
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
    // Session до любой mutation: анонимный вызов не создаёт task.
    const user = await requireUser();

    if (!isAllowedOrigin(request.headers.get("origin"))) {
      return errorResponse(403, "FORBIDDEN_ORIGIN");
    }

    const parsed = parseTaskCreate(body.json);
    if (!parsed.ok) {
      return errorResponse(400, "VALIDATION_ERROR", parsed.field);
    }
    const task = await createTask(user.id, parsed.value);
    return Response.json(
      { task: toTaskDTO(task) },
      { status: 201, headers: NO_STORE },
    );
  } catch (error) {
    if (error instanceof UnauthenticatedError) {
      return errorResponse(401, "UNAUTHENTICATED");
    }
    return errorResponse(500, "INTERNAL");
  }
}
