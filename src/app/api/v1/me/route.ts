import { UnauthenticatedError, requireUser } from "@/server/auth/session";

/**
 * Минимальный защищённый identity endpoint: упражняет server boundary для
 * будущего HTTP API. Actor только из проверенной сессии; переданный
 * user_id/owner_id (query/body/headers) не влияет на результат. Ошибки не
 * раскрывают email/tokens/hashes. Ответы не кешируются (private, no-store).
 */

export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "private, no-store" } as const;

export async function GET(): Promise<Response> {
  try {
    const user = await requireUser();
    return Response.json({ user: { id: user.id } }, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof UnauthenticatedError) {
      return Response.json(
        { error: { code: "UNAUTHENTICATED" } },
        { status: 401, headers: NO_STORE },
      );
    }
    return Response.json(
      { error: { code: "INTERNAL" } },
      { status: 500, headers: NO_STORE },
    );
  }
}
