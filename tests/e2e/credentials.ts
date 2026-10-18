import { createHash } from "node:crypto";

/**
 * Единый источник синтетических учётных данных E2E. Импортируется и
 * playwright.config (несколько процессов), и сервером, и тестами:
 * детерминированный вывод из E2E_PORT гарантирует одинаковые значения во
 * всех процессах одного запуска. Это не секреты: аккаунты синтетические,
 * базы одноразовые и уничтожаются раннером.
 */

export const e2ePort = Number(process.env.E2E_PORT ?? 3123);
export const userAEmail = "e2e-user-a@orbit.test";
export const userBEmail = "e2e-user-b@orbit.test";
export const userCEmail = "e2e-user-c@orbit.test";

function derive(name: string): string {
  return (
    createHash("sha256")
      .update(`orbit-e2e:${e2ePort}:${name}`)
      .digest("hex")
      .slice(0, 20) + "A1"
  );
}

export const userAPassword = derive("user-a-password");
export const userBPassword = derive("user-b-password");
export const userCPassword = derive("user-c-password");
export const e2eSecret = createHash("sha256")
  .update(`orbit-e2e-secret:${e2ePort}`)
  .digest("hex");
