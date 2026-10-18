import { createInterface, type Interface } from "node:readline";
import { askHidden } from "./bootstrap-input.ts";
import { ProvisioningError, provisionLocalUser } from "../src/server/auth/bootstrap-core.ts";

/**
 * Локальная одноразовая bootstrap-процедура первого аккаунта (операторский CLI):
 *   npm run auth:bootstrap
 *
 * - Работает только с локальным PostgreSQL: протокол postgresql/postgres,
 *   host обязателен явно и должен быть loopback (127.0.0.1/localhost/::1),
 *   query-параметры запрещены; production/unknown targets отвергаются
 *   до любых операций.
 * - Явное разрешение provisioning: интерактивное подтверждение "yes".
 * - Email/password вводятся оператором интерактивно; пароль читается скрыто
 *   через raw-mode stdin (не argv, не stdout, не отчёты, не env); после
 *   чтения raw mode/listeners восстанавливаются, висячих хендлов нет.
 * - Повторный запуск с существующим email отказывает без изменения пароля,
 *   аккаунта и без создания сессии (никаких upsert/reset).
 * - Успех не оставляет активную сессию; при частичном сбое provisioning core
 *   откатывает собственные строки (bootstrap-core.ts).
 */

function loadDotEnv(): void {
  try {
    process.loadEnvFile(".env");
  } catch {
    // .env может отсутствовать: DATABASE_URL берётся из окружения.
  }
}

function assertLocalDatabaseUrl(): string {
  const raw = process.env.DATABASE_URL;
  if (!raw || raw.trim() === "") {
    console.error("DATABASE_URL is not set. Copy .env.example to .env first.");
    process.exit(1);
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    console.error("DATABASE_URL is not a valid URL.");
    process.exit(1);
  }
  if (url.protocol !== "postgresql:" && url.protocol !== "postgres:") {
    console.error(
      `Refusing protocol ${url.protocol}: only postgresql:// (or postgres://) is allowed.`,
    );
    process.exit(1);
  }
  if ([...url.searchParams.keys()].length > 0) {
    console.error("Refusing DATABASE_URL with query parameters.");
    process.exit(1);
  }
  const rawHost = url.hostname.replace(/^\[|\]$/g, "");
  let host = rawHost;
  if (rawHost.includes("%")) {
    try {
      host = decodeURIComponent(rawHost);
    } catch {
      console.error("Refusing DATABASE_URL host: invalid percent-encoding.");
      process.exit(1);
    }
  }
  const localHosts = new Set(["localhost", "127.0.0.1", "::1"]);
  if (!localHosts.has(rawHost) || !localHosts.has(host)) {
    console.error(
      `Refusing non-local database host: ${host}. Bootstrap is a local operator procedure only.`,
    );
    process.exit(1);
  }
  const port = url.port === "" ? "5432" : url.port;
  return `postgresql://${encodeURIComponent(url.username)}:${encodeURIComponent(decodeURIComponent(url.password))}@${host}:${port}${url.pathname}`;
}

function ask(rl: Interface, question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer: string) => resolve(answer.trim()));
  });
}

async function main(): Promise<void> {
  loadDotEnv();
  const connectionString = assertLocalDatabaseUrl();

  if (!process.stdin.isTTY) {
    console.error(
      "Bootstrap requires an interactive terminal: email/password are entered privately via prompts.",
    );
    process.exit(1);
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });

  const confirm = await ask(
    rl,
    "This creates a local user account in the configured LOCAL database. Continue? (yes/no) ",
  );
  if (confirm.toLowerCase() !== "yes") {
    console.log("Aborted.");
    process.exit(0);
  }

  const email = await ask(rl, "Email: ");
  rl.close();
  if (!email || !email.includes("@")) {
    console.error("A valid email is required.");
    process.exit(1);
  }

  const password = await askHidden("Password (hidden, min 8 chars): ");
  if (password.length < 8) {
    console.error("Password must be at least 8 characters.");
    process.exit(1);
  }

  try {
    const result = await provisionLocalUser(connectionString, {
      email,
      password,
      name: email.split("@")[0] ?? email,
    });
    console.log(
      `Account created for ${result.email} (user id: ${result.userId}).`,
    );
    console.log("No session was created. Sign in via /login in the app.");
  } catch (error) {
    if (error instanceof ProvisioningError) {
      console.error(`Bootstrap refused (${error.code}): ${error.message}`);
      process.exit(2);
    }
    console.error("Bootstrap failed.");
    process.exit(1);
  }
}

process.on("SIGINT", () => {
  process.stdout.write("\n");
  process.exit(130);
});

await main();
