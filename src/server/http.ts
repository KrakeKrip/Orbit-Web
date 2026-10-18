import "server-only";

import { readAuthBaseOrigin } from "@/server/auth/env";

/**
 * Общие transport-хелперы versioned API routes (TASK-005/006): error
 * envelope, no-store заголовки, лимитированное чтение JSON body и точная
 * Origin-проверка cookie mutations. Transport только parsing/auth/origin/
 * error mapping; общая validation/persistence живёт в services.
 * Разрешённый origin не берётся из Host/X-Forwarded-*; wildcard CORS нет.
 */

export const NO_STORE = { "cache-control": "private, no-store" } as const;

export const MAX_JSON_BODY_BYTES = 2048;

export function errorResponse(
  status: number,
  code: string,
  field?: string,
): Response {
  return Response.json(
    { error: { code, ...(field === undefined ? {} : { field }) } },
    { status, headers: NO_STORE },
  );
}

/**
 * Точная server-side проверка Origin против configured BETTER_AUTH_URL:
 * missing/null/hostile отклоняются. Это собственная защита cookie mutation
 * endpoints — CSRF-защита Better Auth handler'ов собственные routes не
 * покрывает.
 */
export function isAllowedOrigin(originHeader: string | null): boolean {
  const expected = readAuthBaseOrigin();
  if (!originHeader || originHeader === "null") {
    return false;
  }
  try {
    return new URL(originHeader).origin === expected;
  } catch {
    return false;
  }
}

/**
 * Чтение JSON body с жёстким лимитом размера: pre-check Content-Length
 * плюс потоковый лимит при чтении (Content-Length не единственное
 * доказательство размера). TextDecoder stream корректно собирает
 * multi-byte символы на границах чанков.
 */
export async function readJsonBodyWithLimit(
  request: Request,
  maxBytes: number = MAX_JSON_BODY_BYTES,
): Promise<{ ok: true; json: unknown } | { ok: false; malformed: boolean }> {
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    return { ok: false, malformed: false };
  }
  if (!request.body) {
    return { ok: false, malformed: true };
  }
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      return { ok: false, malformed: false };
    }
    text += decoder.decode(value, { stream: true });
  }
  text += decoder.decode();
  try {
    return { ok: true, json: JSON.parse(text) };
  } catch {
    return { ok: false, malformed: true };
  }
}

/** Требует точный media type application/json (parameters/регистр
 * token'а допускаются); application/jsonp и прочие похожие префиксы — 415. */
export function hasJsonContentType(request: Request): boolean {
  const mediaType = (request.headers.get("content-type") ?? "")
    .split(";", 1)[0]
    .trim()
    .toLowerCase();
  return mediaType === "application/json";
}

/**
 * Чтение body с подсчётом размера и жёстким лимитом (для DELETE без media
 * requirement): важно только «пусто/непусто» и превышение лимита.
 */
export async function readBodySizeWithLimit(
  request: Request,
  maxBytes: number = MAX_JSON_BODY_BYTES,
): Promise<{ ok: true; bytes: number } | { ok: false; tooLarge: boolean }> {
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    return { ok: false, tooLarge: true };
  }
  if (!request.body) {
    return { ok: true, bytes: 0 };
  }
  const reader = request.body.getReader();
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      return { ok: false, tooLarge: true };
    }
  }
  return { ok: true, bytes: total };
}
