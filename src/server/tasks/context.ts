import "server-only";

import { sql } from "drizzle-orm";
import { instantToLocalDate } from "@/lib/calendar";
import { getDb } from "@/server/db/client";
import { getAccountSettings } from "@/server/settings/service";

/**
 * Server read context (TASK-008): timezone — из проверенного actor
 * getAccountSettings (default UTC, без INSERT settings row); reference
 * instant снимается ровно один раз из часов PostgreSQL на read; today —
 * civil date этого instant в actor timezone (Intl/явная зона). Никаких
 * client clock/timezone overrides.
 */
export type TasksReadContext = {
  timezone: string;
  today: string;
  asOf: string;
};

export async function getTasksReadContext(
  actorId: string,
): Promise<TasksReadContext> {
  const settings = await getAccountSettings(actorId);
  const result = await getDb().execute(sql`SELECT current_timestamp AS "asOf"`);
  const rows = result.rows as Array<{ asOf: Date | string }>;
  const raw = rows[0]?.asOf;
  const asOfDate = raw instanceof Date ? raw : new Date(String(raw));
  const asOf = asOfDate.toISOString();
  const today = instantToLocalDate(asOfDate, settings.timezone);
  return { timezone: settings.timezone, today, asOf };
}
