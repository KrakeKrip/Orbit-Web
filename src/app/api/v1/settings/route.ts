import { UnauthenticatedError, requireUser } from "@/server/auth/session";
import {
  errorResponse,
  hasJsonContentType,
  isAllowedOrigin,
  readJsonBodyWithLimit,
  NO_STORE,
} from "@/server/http";
import {
  getAccountSettings,
  updateAccountSettings,
} from "@/server/settings/service";
import {
  parseSettingsPatch,
  type AccountSettingsPayload,
} from "@/lib/settings";

/**
 * Versioned settings endpoint (TASK-005): GET/PATCH timezone/theme только
 * текущего пользователя. Actor только из проверенной сессии; query/header
 * identity игнорируются, query parameters не поддерживаются. Это собственный
 * cookie mutation endpoint: PATCH дополнительно защищён точной server-side
 * Origin проверкой configured BETTER_AUTH_URL (общие transport-хелперы
 * src/server/http, те же гарантии переиспользуются projects endpoints;
 * Better Auth routes этот endpoint не защищают); разрешённый origin не
 * берётся из Host/X-Forwarded-*.
 *
 * Порядок проверок PATCH (документирован и покрыт тестами): transport
 * (Content-Type 415 → размер 413 → JSON 400) → session 401 → Origin 403 →
 * валидация полей 400 → mutation. Любой отказ не пишет в БД; анонимный
 * вызов не создаёт row. Все ответы, включая ошибки: private, no-store;
 * тела ошибок без email/tokens/hashes/stack/SQL.
 */

export const dynamic = "force-dynamic";

function settingsResponse(payload: AccountSettingsPayload): Response {
  return Response.json(payload, { headers: NO_STORE });
}

export async function GET(request: Request): Promise<Response> {
  if (new URL(request.url).search !== "") {
    return errorResponse(400, "VALIDATION_ERROR");
  }
  try {
    const user = await requireUser();
    const settings = await getAccountSettings(user.id);
    return settingsResponse({ settings });
  } catch (error) {
    if (error instanceof UnauthenticatedError) {
      return errorResponse(401, "UNAUTHENTICATED");
    }
    return errorResponse(500, "INTERNAL");
  }
}

export async function PATCH(request: Request): Promise<Response> {
  if (new URL(request.url).search !== "") {
    return errorResponse(400, "VALIDATION_ERROR");
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
    // Session до любой mutation: анонимный вызов не создаёт row.
    const user = await requireUser();

    if (!isAllowedOrigin(request.headers.get("origin"))) {
      return errorResponse(403, "FORBIDDEN_ORIGIN");
    }

    const parsed = parseSettingsPatch(body.json);
    if (!parsed.ok) {
      return errorResponse(400, "VALIDATION_ERROR", parsed.field);
    }
    const settings = await updateAccountSettings(user.id, parsed.patch);
    return settingsResponse({ settings });
  } catch (error) {
    if (error instanceof UnauthenticatedError) {
      return errorResponse(401, "UNAUTHENTICATED");
    }
    return errorResponse(500, "INTERNAL");
  }
}
