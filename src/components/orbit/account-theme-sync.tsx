"use client";

import { useEffect, useRef } from "react";
import { useTheme } from "next-themes";
import type { SettingsTheme } from "@/lib/settings";

/**
 * Мост account theme (TASK-005): применяет серверную тему аккаунта ко всем
 * workspace маршрутам при входе/refresh/смене аккаунта. DB settings —
 * источник истины: устаревший локальный orbit-theme (в том числе от другого
 * actor) замещается значением этого запроса. Мост только применяет тему —
 * он НЕ отправляет сохранение (PATCH инициирует только явный выбор в
 * Settings), поэтому mount/hydration не порождают записи.
 *
 * setTheme в next-themes пересоздаётся при каждом изменении темы (useCallback
 * по значению), поэтому он берётся из ref: эффект запускается ТОЛЬКО при
 * изменении серверного значения — локальный выбор пользователя после mount
 * мост не перезаписывает.
 */
export function AccountThemeSync({ theme }: { theme: SettingsTheme }) {
  const { setTheme } = useTheme();
  const setThemeRef = useRef(setTheme);
  useEffect(() => {
    setThemeRef.current = setTheme;
  }, [setTheme]);
  useEffect(() => {
    setThemeRef.current(theme);
  }, [theme]);
  return null;
}
