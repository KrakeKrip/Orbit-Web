import { finalizeE2ERunResources } from "./run-finalization.ts";

/**
 * Global teardown E2E (выполняется в runner-процессе после всех тестов).
 * Вся логика финализации — в run-finalization.ts: пересылка SIGTERM живому
 * серверу (playwright убивает shell webServer'а), проверка exit-ожидания,
 * достоверного completion-исхода остановки (R3c) и зачистка собственной
 * test-базы. Ошибка здесь делает итог всего прогона ненулевым.
 */
export default async function teardown(): Promise<void> {
  await finalizeE2ERunResources();
}
