import { describe, expect, test } from "vitest";
import { readAuthRuntimeConfig } from "@/server/auth/env";

/**
 * Pure-тесты валидации runtime-конфигурации (допустимы TASK-004 как
 * дополнение; HTTP/DB поведение проверяется в auth-flow.auth.test.ts).
 * Сообщения об ошибках не содержат значений секретов/URL.
 */

const validEnv = {
  DATABASE_URL: "postgresql://orbit:pw@127.0.0.1:55432/orbit_dev",
  BETTER_AUTH_SECRET: "a".repeat(32),
  BETTER_AUTH_URL: "http://127.0.0.1:55432",
};

describe("readAuthRuntimeConfig", () => {
  test("валидная конфигурация разбирается, baseURL нормализуется до origin", () => {
    const config = readAuthRuntimeConfig({
      ...validEnv,
      BETTER_AUTH_URL: "http://127.0.0.1:55432/",
    });
    expect(config.databaseUrl).toBe(validEnv.DATABASE_URL);
    expect(config.baseURL).toBe("http://127.0.0.1:55432");
  });

  test("отсутствие каждой переменной даёт понятную ошибку без значений", () => {
    expect(() =>
      readAuthRuntimeConfig({
        DATABASE_URL: validEnv.DATABASE_URL,
        BETTER_AUTH_URL: validEnv.BETTER_AUTH_URL,
      }),
    ).toThrowError(/BETTER_AUTH_SECRET is not set/);
    expect(() =>
      readAuthRuntimeConfig({
        BETTER_AUTH_SECRET: validEnv.BETTER_AUTH_SECRET,
        BETTER_AUTH_URL: validEnv.BETTER_AUTH_URL,
      }),
    ).toThrowError(/DATABASE_URL is not set/);
    expect(() =>
      readAuthRuntimeConfig({
        DATABASE_URL: validEnv.DATABASE_URL,
        BETTER_AUTH_SECRET: validEnv.BETTER_AUTH_SECRET,
      }),
    ).toThrowError(/BETTER_AUTH_URL is not set/);
  });

  test("короткий секрет отвергается, значение не печатается", () => {
    try {
      readAuthRuntimeConfig({
        ...validEnv,
        BETTER_AUTH_SECRET: "short-secret-value-1",
      });
      expect.unreachable("expected an error");
    } catch (error) {
      const message = String(error);
      expect(message).toMatch(/BETTER_AUTH_SECRET is too short/);
      expect(message).not.toContain("short-secret-value-1");
    }
  });

  test("невалидный/неподдерживаемый baseURL отвергается", () => {
    expect(() =>
      readAuthRuntimeConfig({ ...validEnv, BETTER_AUTH_URL: "not-a-url" }),
    ).toThrowError(/not a valid absolute/);
    expect(() =>
      readAuthRuntimeConfig({ ...validEnv, BETTER_AUTH_URL: "ftp://127.0.0.1" }),
    ).toThrowError(/must use http or https/);
  });
});
