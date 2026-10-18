import "server-only";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getAuth } from "./instance";

/**
 * Reusable session boundary. Доверенная identity берётся ТОЛЬКО из
 * проверенной сессии текущего запроса (cookies через headers()); значения
 * user_id/owner_id из query/body/headers никогда не определяют пользователя
 * и не маскируют отсутствие сессии.
 *
 * Отличие сбоев: отсутствие/подделка/истечение/отзыв сессии — это
 * UNAUTHENTICATED (null / UnauthenticatedError); ошибка конфигурации
 * runtime (нет env и т.п.) пробрасывается как есть — fail-closed, без
 * превращения в анонимный workspace и без маскировки под signed-out.
 */

export type SessionUser = {
  id: string;
  email: string;
  name: string;
};

export class UnauthenticatedError extends Error {
  readonly code = "UNAUTHENTICATED";

  constructor() {
    super("UNAUTHENTICATED");
    this.name = "UnauthenticatedError";
  }
}

export async function getSessionUser(): Promise<SessionUser | null> {
  // headers() первым: во время статического пререндера он даёт стандартный
  // dynamic bailout Next (маршрут становится динамическим), и runtime auth
  // конфигурация не требуется на build — приложение остаётся build-безопасным.
  const requestHeaders = await headers();
  const auth = getAuth();
  const result = await auth.api.getSession({ headers: requestHeaders });
  if (!result?.user) {
    return null;
  }
  return { id: result.user.id, email: result.user.email, name: result.user.name };
}

/** Для server entry points/services: ошибка UNAUTHENTICATED вместо actor. */
export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) {
    throw new UnauthenticatedError();
  }
  return user;
}

/** Для protected pages: анонимный браузер уходит на /login. */
export async function requireUserOrRedirect(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) {
    redirect("/login");
  }
  return user;
}
