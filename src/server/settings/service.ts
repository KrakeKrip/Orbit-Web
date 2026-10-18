import "server-only";

import { eq, sql } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import { userSettings } from "@/server/db/schema";
import {
  DEFAULT_SETTINGS,
  type SettingsPatch,
  type SettingsTheme,
} from "@/lib/settings";

/**
 * Account settings service (TASK-005): timezone/theme текущего пользователя
 * в user_settings. Доверенный actor передаёт сюда только server-derived id
 * из requireUser; client owner_id/user_id не принимается. Данные выбираются
 * строго WHERE user_id = actor.id — настройки других users недостижимы.
 *
 * GET отсутствующей строки возвращает эффективные defaults UTC/system БЕЗ
 * INSERT: чтение не создаёт данных, settings row не добавляется в
 * signup/bootstrap.
 *
 * PATCH — один атомарный INSERT … ON CONFLICT (user_id) DO UPDATE,
 * изменяющий только явно переданные поля: отсутствие строки создаёт её с
 * defaults для остальных полей, присутствие сохраняет created_at и
 * нетронутые поля; конкурентные обновления разных полей не перетирают друг
 * друга, одного поля — завершившийся последним побеждает. updated_at
 * выставляется явным server write; read-all → write-all не используется.
 * Никакого cross-request/global cache: каждый вызов читает актуальную
 * строку, ошибки сервиса не подменяются defaults.
 */

export type AccountSettings = {
  timezone: string;
  theme: SettingsTheme;
};

export async function getAccountSettings(
  actorId: string,
): Promise<AccountSettings> {
  const rows = await getDb()
    .select({
      timezone: userSettings.timezone,
      theme: userSettings.theme,
    })
    .from(userSettings)
    .where(eq(userSettings.userId, actorId))
    .limit(1);
  const row = rows[0];
  if (!row) {
    return { ...DEFAULT_SETTINGS };
  }
  return { timezone: row.timezone, theme: row.theme };
}

export async function updateAccountSettings(
  actorId: string,
  patch: SettingsPatch,
): Promise<AccountSettings> {
  const rows = await getDb()
    .insert(userSettings)
    .values({
      userId: actorId,
      timezone: patch.timezone ?? DEFAULT_SETTINGS.timezone,
      theme: patch.theme ?? DEFAULT_SETTINGS.theme,
      createdAt: sql`now()`,
      updatedAt: sql`now()`,
    })
    .onConflictDoUpdate({
      target: userSettings.userId,
      set: {
        ...(patch.timezone === undefined
          ? {}
          : { timezone: patch.timezone }),
        ...(patch.theme === undefined ? {} : { theme: patch.theme }),
        // now() из БД: server write теми же часами, что и created_at.
        updatedAt: sql`now()`,
      },
    })
    .returning({
      timezone: userSettings.timezone,
      theme: userSettings.theme,
    });
  const row = rows[0];
  if (!row) {
    throw new Error("Account settings upsert returned no row.");
  }
  return { timezone: row.timezone, theme: row.theme };
}
