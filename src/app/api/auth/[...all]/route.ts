import { toNextJsHandler } from "better-auth/next-js";
import { getAuth } from "@/server/auth/instance";

/**
 * Better Auth route handler (документированная Next интеграция).
 * Инициализация ленивая: на import/build env не требуется, конфигурация
 * читается на первом запросе (fail-closed при отсутствии runtime env).
 */

type AuthHandlers = { GET: (request: Request) => Promise<Response>; POST: (request: Request) => Promise<Response> };

let cachedHandlers: AuthHandlers | null = null;

function handlers(): AuthHandlers {
  if (!cachedHandlers) {
    cachedHandlers = toNextJsHandler(getAuth()) as AuthHandlers;
  }
  return cachedHandlers;
}

export async function GET(request: Request): Promise<Response> {
  return handlers().GET(request);
}

export async function POST(request: Request): Promise<Response> {
  return handlers().POST(request);
}
