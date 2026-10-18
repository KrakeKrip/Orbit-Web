import { describe, expect, test } from "vitest";
import {
  createUniqueTestDbName,
  isRunnerCreatedDbName,
  resolveTestDatabaseTarget,
  type DbTarget,
} from "./db-target";

/**
 * R2 guard: валидация эффективной конфигурации подключения. Чистые проверки
 * без сети и DDL — отказ обязан происходить ДО подключения.
 */

function resolveWith(
  url: string | undefined,
  extraEnv: Record<string, string | undefined> = {},
): DbTarget {
  const env = { ...extraEnv } as NodeJS.ProcessEnv;
  if (url !== undefined) {
    env.TEST_DATABASE_URL = url;
  }
  return resolveTestDatabaseTarget(env);
}

function expectRefusal(url: string | undefined, fragment?: RegExp): void {
  expect(() => resolveWith(url)).toThrowError(fragment ?? /.*/);
}

const valid = "postgresql://orbit:secret@127.0.0.1:55432/orbit_test";

describe("R2: разрешение на test-режим", () => {
  test("отсутствие TEST_DATABASE_URL отвергается", () => {
    expectRefusal(undefined, /explicit test permission/);
  });

  test("пустой TEST_DATABASE_URL отвергается", () => {
    expectRefusal("   ", /explicit test permission/);
  });

  test("DATABASE_URL не является fallback и не читается", () => {
    expect(() =>
      resolveWith(undefined, {
        DATABASE_URL: valid,
      }),
    ).toThrowError(/explicit test permission/);
  });
});

describe("R2: протокол и query-параметры", () => {
  test("не-postgres протокол отвергается", () => {
    expectRefusal(
      "mysql://orbit:secret@127.0.0.1:55432/orbit_test",
      /Refusing protocol/,
    );
  });

  test("?host= на remote отвергается до подключения", () => {
    expectRefusal(`${valid}?host=10.0.0.5`, /query parameters \(host\)/);
  });

  test("любые query-параметры отвергаются, включая sslmode", () => {
    expectRefusal(`${valid}?sslmode=disable`, /query parameters/);
  });
});

describe("R2: эффективный host", () => {
  test("удалённый hostname отвергается", () => {
    expectRefusal(
      "postgresql://orbit:secret@10.0.0.5:55432/orbit_test",
      /non-local test database host: 10\.0\.0\.5/,
    );
  });

  test("произвольный домен отвергается", () => {
    expectRefusal(
      "postgresql://orbit:secret@db.example.com:55432/orbit_test",
      /non-local test database host/,
    );
  });

  test("percent-закодированный remote host декодируется и отвергается", () => {
    expectRefusal(
      "postgresql://orbit:secret@%31%30.%30.%30.%35:55432/orbit_test",
      /non-local test database host/,
    );
  });

  test("локальные localhost/127.0.0.1/[::1] принимаются", () => {
    for (const host of ["localhost", "127.0.0.1", "[::1]"]) {
      const target = resolveWith(
        `postgresql://orbit:secret@${host}:55432/orbit_test`,
      );
      expect(["localhost", "127.0.0.1", "::1"]).toContain(target.host);
    }
  });
});

describe("R2: обязательные компоненты подключения", () => {
  test("без явного порта отвергается (PG defaults не принимаются)", () => {
    expectRefusal(
      "postgresql://orbit:secret@127.0.0.1/orbit_test",
      /explicit port/,
    );
  });

  test("без user или password отвергается (PGUSER/PGPASSWORD/system user не принимаются)", () => {
    expectRefusal("postgresql://127.0.0.1:55432/orbit_test", /explicit user and password/);
    expectRefusal(
      "postgresql://orbit@127.0.0.1:55432/orbit_test",
      /explicit user and password/,
    );
  });

  test("чужое имя namespace отвергается (включая другие *_test)", () => {
    expectRefusal(
      "postgresql://orbit:secret@127.0.0.1:55432/crm_test",
      /orbit_test/,
    );
    expectRefusal(
      "postgresql://orbit:secret@127.0.0.1:55432/production",
      /orbit_test/,
    );
  });
});

describe("уникальное имя создаваемой базы (R1)", () => {
  test("имена уникальны, соответствуют шаблону и распознаются как созданные раннером", () => {
    const first = createUniqueTestDbName();
    const second = createUniqueTestDbName();
    expect(first).not.toBe(second);
    expect(first).toMatch(/^orbit_test_[0-9]+_[a-z0-9]+$/);
    expect(isRunnerCreatedDbName(first)).toBe(true);
    expect(isRunnerCreatedDbName("orbit_test")).toBe(false);
    expect(isRunnerCreatedDbName("crm_test")).toBe(false);
    expect(isRunnerCreatedDbName("orbit_test; DROP DATABASE x")).toBe(false);
  });

  test("валидный target собирается из частей, без сырого URL и query", () => {
    const target = resolveWith(valid);
    expect(target).toEqual({
      host: "127.0.0.1",
      port: 55432,
      user: "orbit",
      password: "secret",
      database: target.database,
    });
    expect(target.database).toMatch(/^orbit_test_[0-9]+_[a-z0-9]+$/);
  });
});
