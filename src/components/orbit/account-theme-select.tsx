"use client";

import { useEffect, useRef, useState } from "react";
import { useTheme } from "next-themes";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { SettingsTheme } from "@/lib/settings";
import { ru } from "@/lib/i18n/ru";

const THEME_OPTIONS = [
  { value: "system", label: ru.settings.theme.options.system },
  { value: "light", label: ru.settings.theme.options.light },
  { value: "dark", label: ru.settings.theme.options.dark },
] as const;

async function patchSettingsTheme(theme: SettingsTheme): Promise<boolean> {
  const response = await fetch("/api/v1/settings", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ theme }),
  });
  return response.ok;
}

/**
 * Выбор темы с сохранением в аккаунте: выбор применяется сразу (preview и
 * визуальный cache orbit-theme) и отправляется PATCH; подтверждённым
 * значением считается только ответ сервера. Pending блокирует повторные
 * собственные сохранения; при ошибке тема откатывается к последней
 * подтверждённой account theme и видима ошибка. Значение Select берётся из
 * серверного состояния аккаунта, а не из localStorage: устаревший cache
 * другого actor не отображается и не сохраняется.
 *
 * Lifecycle/actor guard (R1): завершение сохранения обрабатывается, только
 * если экран жив и actor не сменился. setTheme из useTheme — глобальный
 * setter переживающего navigation root provider'а: без guard'а отказ
 * задержавшегося PATCH прежнего аккаунта перекрашивал бы нового (catch/
 * rollback/finally защищены целиком, не только setState). Сам запрос не
 * прерывается — законная серверная запись прежнего аккаунта завершается.
 */
export function AccountThemeSelect({
  confirmedTheme,
  actorId,
}: {
  confirmedTheme: SettingsTheme;
  actorId: string;
}) {
  const { setTheme } = useTheme();
  const [confirmed, setConfirmed] = useState<SettingsTheme>(confirmedTheme);
  const [pendingTheme, setPendingTheme] = useState<SettingsTheme | null>(null);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState(false);
  const inFlight = useRef(false);
  const mountedRef = useRef(true);
  const actorRef = useRef(actorId);

  useEffect(() => {
    actorRef.current = actorId;
  }, [actorId]);
  // Симметричный lifecycle guard: каждый setup восстанавливает mounted=true,
  // cleanup ставит false. React StrictMode (next dev) повторяет
  // setup → cleanup → setup с тем же ref — асимметричный вариант навсегда
  // оставлял mounted=false и пропускал успешные/ошибочные завершения
  // сохранения (R1b). Реальный unmount по-прежнему гасит stale callbacks.
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  async function handleChange(next: string): Promise<void> {
    if (inFlight.current) {
      return;
    }
    const requestedActorId = actorRef.current;
    const isCurrentSave = () =>
      mountedRef.current && actorRef.current === requestedActorId;
    const theme = next as SettingsTheme;
    setTheme(theme);
    setError(false);
    setSaved(false);
    setPendingTheme(theme);
    inFlight.current = true;
    try {
      if (await patchSettingsTheme(theme)) {
        if (!isCurrentSave()) {
          return;
        }
        setConfirmed(theme);
        setSaved(true);
      } else {
        if (!isCurrentSave()) {
          return;
        }
        setTheme(confirmed);
        setError(true);
      }
    } catch {
      if (!isCurrentSave()) {
        return;
      }
      setTheme(confirmed);
      setError(true);
    } finally {
      inFlight.current = false;
      if (isCurrentSave()) {
        setPendingTheme(null);
      }
    }
  }

  return (
    <div aria-busy={pendingTheme !== null}>
      <Select
        value={pendingTheme ?? confirmed}
        onValueChange={(value) => void handleChange(value)}
      >
        {/* min-h-11 перекрывает data-[size]:h-8: фактическая область нажатия >= 44px */}
        <SelectTrigger id="theme-select" className="min-h-11 w-full max-w-56">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {THEME_OPTIONS.map((option) => (
            <SelectItem
              key={option.value}
              value={option.value}
              className="min-h-11"
            >
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p aria-live="polite" className="mt-2 text-sm leading-5">
        {pendingTheme !== null ? (
          <span className="text-muted-foreground">{ru.settings.theme.saving}</span>
        ) : error ? (
          <span role="alert" className="text-destructive">
            {ru.settings.theme.saveError}
          </span>
        ) : saved ? (
          <span className="text-muted-foreground">{ru.settings.theme.saved}</span>
        ) : null}
      </p>
    </div>
  );
}
