"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { resolveCanonicalTimezone } from "@/lib/settings";
import { ru } from "@/lib/i18n/ru";

type TimezoneStatus = "idle" | "pending" | "saved" | "error";

/**
 * Поле timezone аккаунта с явным сохранением: draft не перетирается до
 * успешного ответа сервера; server failure показывает ошибку и оставляет
 * draft для retry без ложного «Сохранено». На время pending поле и кнопка
 * заблокированы — ответ применяется ровно к отправленному значению, новый
 * ввод во время запроса невозможен и не может быть потерян. Локальная
 * pure-проверка даёт быстрый понятный отказ, канонизацию и запись
 * выполняет сервер. Автосохранения и сохранения при mount/hydration нет.
 */
export function TimezoneField({
  initialTimezone,
}: {
  initialTimezone: string;
}) {
  const [draft, setDraft] = useState(initialTimezone);
  const [status, setStatus] = useState<TimezoneStatus>("idle");
  const [invalid, setInvalid] = useState(false);
  const inFlight = useRef(false);

  async function handleSave(): Promise<void> {
    if (inFlight.current) {
      return;
    }
    const canonical = resolveCanonicalTimezone(draft);
    if (canonical === null) {
      setInvalid(true);
      setStatus("error");
      return;
    }
    setInvalid(false);
    setStatus("pending");
    inFlight.current = true;
    try {
      const response = await fetch("/api/v1/settings", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ timezone: canonical }),
      });
      if (response.ok) {
        const payload = (await response.json()) as {
          settings?: { timezone?: string };
        };
        const savedTimezone = payload.settings?.timezone;
        if (typeof savedTimezone === "string" && savedTimezone !== "") {
          // Показываем подтверждённое сервером каноническое значение.
          setDraft(savedTimezone);
          setStatus("saved");
          return;
        }
        setStatus("error");
        return;
      }
      if (response.status === 400) {
        // Значение отвергнуто сервером: показываем invalid-подсказку,
        // draft сохраняем для правки.
        setInvalid(true);
      }
      setStatus("error");
    } catch {
      setStatus("error");
    } finally {
      inFlight.current = false;
    }
  }

  const pending = status === "pending";
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void handleSave();
      }}
      aria-busy={pending}
    >
      <Label htmlFor="timezone-input">{ru.settings.timezone.label}</Label>
      <p className="mt-1 text-sm leading-5 text-muted-foreground">
        {ru.settings.timezone.hint}
      </p>
      <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
        <Input
          id="timezone-input"
          name="timezone"
          type="text"
          autoComplete="off"
          spellCheck={false}
          className="min-h-11 max-w-56"
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value);
            if (status === "saved") {
              setStatus("idle");
            }
          }}
          // На время сохранения поле заблокировано: ответ запроса применяется
          // только к значению на момент отправки, поэтому редактирование
          // во время pending не может быть потеряно или помечено сохранённым.
          disabled={pending}
          aria-invalid={invalid || undefined}
          aria-describedby="timezone-status"
        />
        <Button
          type="submit"
          variant="outline"
          className="min-h-11 px-4"
          disabled={pending}
        >
          {pending ? ru.settings.timezone.saving : ru.settings.timezone.save}
        </Button>
      </div>
      <p
        id="timezone-status"
        aria-live="polite"
        className="mt-2 text-sm leading-5"
      >
        {status === "pending" ? (
          <span className="text-muted-foreground">
            {ru.settings.timezone.saving}
          </span>
        ) : status === "saved" ? (
          <span className="text-muted-foreground">
            {ru.settings.timezone.saved}
          </span>
        ) : status === "error" ? (
          <span role="alert" className="text-destructive">
            {invalid ? ru.settings.timezone.invalid : ru.settings.timezone.saveError}
          </span>
        ) : null}
      </p>
    </form>
  );
}
