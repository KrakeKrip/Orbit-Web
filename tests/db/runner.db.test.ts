import { randomBytes } from "node:crypto";
import { afterAll, describe, expect, test } from "vitest";
import { Client } from "pg";
import { loadDotEnv, resolveTestDatabaseTarget } from "./db-target";
import { prepareTestDatabase } from "./runner";

/**
 * R1 acceptance: раннер не трогает ранее существовавшие базы.
 * Sentinel-фикстура получает уникальное имя и создаётся этим тестом через
 * CREATE БЕЗ предварительного DROP; cleanup выполняется только для
 * успешно созданной фикстуры (владение фиксируется после CREATE и
 * соблюдается во всех путях, включая сбои setup/assertions). На
 * пользовательских данных проверка не выполняется.
 */

loadDotEnv();
const base = resolveTestDatabaseTarget();

async function withDatabase(
  name: string,
  fn: (client: Client) => Promise<void>,
): Promise<void> {
  const client = new Client({
    host: base.host,
    port: base.port,
    user: base.user,
    password: base.password,
    database: name,
  });
  await client.connect();
  try {
    await fn(client);
  } finally {
    await client.end();
  }
}

async function withAdmin(fn: (client: Client) => Promise<void>): Promise<void> {
  await withDatabase("postgres", fn);
}

async function databaseExists(name: string): Promise<boolean> {
  let exists = false;
  await withAdmin(async (admin) => {
    const { rows } = await admin.query<{ found: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM "pg_database" WHERE "datname" = $1) AS "found"`,
      [name],
    );
    exists = rows[0].found;
  });
  return exists;
}

async function createSentinelFixture(): Promise<string> {
  const name = `orbit_test_sentinel_${randomBytes(4).toString("hex")}`;
  await withAdmin(async (admin) => {
    // CREATE без IF NOT EXISTS: коллизия даёт ошибку, чужие базы не удаляются.
    await admin.query(`CREATE DATABASE "${name}"`);
  });
  // Владение фиксируется только после успешного CREATE.
  await withDatabase(name, async (client) => {
    await client.query(`CREATE TABLE "sentinel" ("value" text NOT NULL)`);
    await client.query(`INSERT INTO "sentinel" ("value") VALUES ('keep-me')`);
  });
  return name;
}

async function readSentinel(name: string): Promise<string[]> {
  const rows: string[] = [];
  await withDatabase(name, async (client) => {
    const result = await client.query<{ value: string }>(
      `SELECT "value" FROM "sentinel"`,
    );
    rows.push(...result.rows.map((r) => r.value));
  });
  return rows;
}

// Ресурсы, созданные этим тестовым файлом (cleanup только своих).
let sentinelFixture: string | null = null;
let secondRunDb: string | null = null;

afterAll(async () => {
  if (sentinelFixture) {
    const name = sentinelFixture;
    sentinelFixture = null;
    // WITH (FORCE) допустим: это база, успешно созданная этим файлом.
    await withAdmin(async (admin) => {
      await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);
    });
  }
  if (secondRunDb) {
    const name = secondRunDb;
    secondRunDb = null;
    // Дополнительная защита после теста «двух запусков»: база создана
    // раннером в этом тесте; удаляем, только если teardown её не убрал.
    if (await databaseExists(name)) {
      await withAdmin(async (admin) => {
        await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);
      });
    }
  }
});

describe("R1: раннер не уничтожает существующие базы", () => {
  test("sentinel в заранее созданной fixture-базе остаётся нетронутым после setup/teardown", async () => {
    // 1. Фикстура: уникальное имя, CREATE без предварительного DROP.
    const fixture = await createSentinelFixture();
    sentinelFixture = fixture;

    // 2. Реальный запуск подготовки test-базы.
    const prepared = await prepareTestDatabase(process.env);
    try {
      // 3. Создана уникальная база, а не чужая/фикстурная.
      expect(prepared.target.database).toMatch(/^orbit_test_[0-9]+_[a-z0-9]+$/);
      expect(prepared.target.database).not.toBe(fixture);
      expect(await databaseExists(prepared.target.database)).toBe(true);

      // 4. Фикстура и её данные не тронуты работой раннера.
      expect(await readSentinel(fixture)).toEqual(["keep-me"]);
    } finally {
      // 5. teardown удаляет только созданную этим запуском базу.
      await prepared.teardown();
      await expect(await databaseExists(prepared.target.database)).toBe(false);
    }

    // 6. Фикстура и sentinel живы и после teardown.
    expect(await databaseExists(fixture)).toBe(true);
    expect(await readSentinel(fixture)).toEqual(["keep-me"]);
  });

  test("два последовательных запуска создают разные базы и обе удаляются teardown", async () => {
    const first = await prepareTestDatabase(process.env);
    const second = await prepareTestDatabase(process.env);
    secondRunDb = second.target.database;
    try {
      expect(first.target.database).not.toBe(second.target.database);
      expect(await databaseExists(first.target.database)).toBe(true);
      expect(await databaseExists(second.target.database)).toBe(true);
    } finally {
      await first.teardown();
      await second.teardown();
    }
    expect(await databaseExists(first.target.database)).toBe(false);
    expect(await databaseExists(second.target.database)).toBe(false);
  });
});

describe("R1/R2: отказ без DDL", () => {
  test("без TEST_DATABASE_URL подготовка падает до DDL", async () => {
    await expect(
      prepareTestDatabase({ ...process.env, TEST_DATABASE_URL: undefined }),
    ).rejects.toThrowError(/explicit test permission/);
    await expect(
      prepareTestDatabase({
        ...process.env,
        TEST_DATABASE_URL: undefined,
        DATABASE_URL: "postgresql://orbit:secret@127.0.0.1:55432/orbit_test",
      }),
    ).rejects.toThrowError(/explicit test permission/);
  });

  test("remote host и query-подмена отвергаются до DDL", async () => {
    await expect(
      prepareTestDatabase({
        ...process.env,
        TEST_DATABASE_URL:
          "postgresql://orbit:secret@10.0.0.5:55432/orbit_test",
      }),
    ).rejects.toThrowError(/non-local test database host/);
    await expect(
      prepareTestDatabase({
        ...process.env,
        TEST_DATABASE_URL: `${base.host === "127.0.0.1" ? "postgresql://orbit:secret@127.0.0.1:55432" : "postgresql://orbit:secret@localhost:55432"}/orbit_test?host=10.0.0.5`,
      }),
    ).rejects.toThrowError(/query parameters/);
  });
});
