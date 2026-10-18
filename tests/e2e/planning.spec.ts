import { expect, test, request as apiRequest } from "@playwright/test";
import { e2ePort } from "./credentials";

// Владелец planning fixtures — пользователь C: его сессию никто не
// ревокирует, а задачи C не пересекаются с inbox-фикстурами A.
const USER_C_STATE = "test-results/.auth/user-c.json";
const run = `t8-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

// TASK-008 browser: Inbox планирование, Today интеграция и секции,
// Upcoming 7-дневные группы/навигация. Mutable fixtures — пользователь A
// (settings.spec ревокирует B); файл сериализован.
test.describe.configure({ mode: "default" });

test.describe("Inbox планирование (desktop 1280)", () => {
  test.use({ viewport: { width: 1280, height: 800 }, storageState: USER_C_STATE });

  test("create → планирование на сегодня → исчезает из Inbox → виден Today один раз", async ({
    page,
  }) => {
    const title = `План ${run}`;
    await page.goto("/inbox");
    await page.getByLabel("Название задачи").fill(title);
    await page.getByRole("button", { name: "Добавить задачу" }).click();
    const row = page.locator("li[data-task-id]", { hasText: title });
    await expect(row).toBeVisible();

    await row.getByRole("button", { name: "Планирование" }).click();
    await row.getByLabel("Дата выполнения").fill(await serverToday(page));
    await row.getByRole("button", { name: "Сохранить" }).click();
    // Исчезает из Inbox (planned_date = today).
    await expect(page.locator("li[data-task-id]", { hasText: title })).toHaveCount(0);

    // Today: ровно одна строка (в секции «На сегодня»).
    await page.goto("/today");
    const todayRows = page.locator("li[data-task-id]", { hasText: title });
    await expect(todayRows).toHaveCount(1);
    await expect(
      page.locator("section[data-section='planToday'] li", { hasText: title }),
    ).toHaveCount(1);
  });

  test("смена плана на будущий день → Upcoming; deadline сохраняется", async ({
    page,
  }) => {
    const title = `Будущий ${run}`;
    const today = await serverToday(page);
    const future = shift(today, 3);
    const deadline = shift(today, 5);

    // Создаём и планируем на сегодня (план+дедлайн одним PATCH).
    await page.goto("/inbox");
    await page.getByLabel("Название задачи").fill(title);
    await page.getByRole("button", { name: "Добавить задачу" }).click();
    const row = page.locator("li[data-task-id]", { hasText: title });
    await expect(row).toBeVisible();
    await row.getByRole("button", { name: "Планирование" }).click();
    await row.getByLabel("Дата выполнения").fill(today);
    await row.getByLabel("Дедлайн").fill(deadline);
    await row.getByRole("button", { name: "Сохранить" }).click();
    await expect(page.locator("li[data-task-id]", { hasText: title })).toHaveCount(0);

    // Today: задача в секции «На сегодня»; переносим план на future.
    await page.goto("/today");
    const todayRow = page.locator("li[data-task-id]", { hasText: title }).first();
    await expect(todayRow).toBeVisible();
    await expect(
      page.locator("section[data-section='planToday'] li", { hasText: title }),
    ).toHaveCount(1);
    await todayRow.getByRole("button", { name: "Планирование" }).click();
    await todayRow.getByLabel("Дата выполнения").fill(future);
    await todayRow.getByRole("button", { name: "Сохранить" }).click();
    await expect(page.locator("li[data-task-id]", { hasText: title })).toHaveCount(0);

    // Upcoming: задача в день future, дедлайн не сдвинулся.
    await page.goto(`/upcoming?start=${future}`);
    const upcomingRow = page.locator("li[data-task-id]", { hasText: title });
    await expect(upcomingRow).toBeVisible();
    await expect(upcomingRow).toContainText(`Дедлайн: ${ru_date(deadline)}`);
  });

  test("очистка плана → возвращение в Inbox; время очищено; дедлайн сохранён", async ({
    page,
  }) => {
    const title = `Очистка ${run}`;
    const today = await serverToday(page);
    await page.goto("/inbox");
    await page.getByLabel("Название задачи").fill(title);
    await page.getByRole("button", { name: "Добавить задачу" }).click();
    const row = page.locator("li[data-task-id]", { hasText: title });
    await expect(row).toBeVisible();

    await row.getByRole("button", { name: "Планирование" }).click();
    await row.getByLabel("Дата выполнения").fill(today);
    await row.getByLabel("Время выполнения").fill("09:30");
    await row.getByLabel("Дедлайн").fill(shift(today, 4));
    await row.getByRole("button", { name: "Сохранить" }).click();
    await expect(page.locator("li[data-task-id]", { hasText: title })).toHaveCount(0);

    // Снова в Inbox-режиме с датой задачи нет; планируем заново и чистим.
    await page.goto("/today");
    const todayRow = page.locator("li[data-task-id]", { hasText: title }).first();
    await expect(todayRow).toBeVisible();
    await todayRow.getByRole("button", { name: "Планирование" }).click();
    await todayRow.getByLabel("Дата выполнения").fill("");
    // Очистка даты блокирует время (disabled).
    await expect(todayRow.getByLabel("Время выполнения")).toBeDisabled();
    await todayRow.getByRole("button", { name: "Сохранить" }).click();
    await expect(page.locator("li[data-task-id]", { hasText: title })).toHaveCount(0);

    // Возвращается в Inbox (planned NULL), дедлайн сохранён.
    await page.goto("/inbox");
    const inboxRow = page.locator("li[data-task-id]", { hasText: title });
    await expect(inboxRow).toBeVisible();
    await expect(inboxRow).toContainText("Дедлайн:");
  });

  test("failed schedule save: draft/error сохраняются, retry успешен", async ({
    page,
  }) => {
    await page.goto("/inbox");
    await page.getByLabel("Название задачи").fill("Отказ план DBG");
    await page.getByRole("button", { name: "Добавить задачу" }).click();
    const row = page.locator("li[data-task-id]", { hasText: "Отказ план DBG" });
    await expect(row).toBeVisible();

    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route("**/api/v1/tasks/**", async (route) => {
      await gate;
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: '{"error":{"code":"INTERNAL"}}',
      });
    });

    await row.getByRole("button", { name: "Планирование" }).click();
    const dateInput = row.getByLabel("Дата выполнения");
    await dateInput.fill(shift(await serverToday(page), 2));
    // Ждём фактический PATCH-ответ (500): исключаем гонку клик/ассерт.
    const failedPatch = page.waitForResponse(
      (response) =>
        response.url().includes("/api/v1/tasks/") &&
        response.request().method() === "PATCH" &&
        response.status() === 500,
    );
    await row.getByRole("button", { name: "Сохранить" }).click();
    // Отпускаем gate ДО ожидания: PATCH вернёт 500 только после release.
    release();
    await failedPatch;
    await expect(row.getByRole("alert")).toBeVisible();
    // Draft сохранён.
    await expect(dateInput).toHaveValue(shift(await serverToday(page), 2));

    await page.unroute("**/api/v1/tasks/**");
    await row.getByRole("button", { name: "Сохранить" }).click();
    await expect(
      page.locator("li[data-task-id]", { hasText: "Отказ план DBG" }),
    ).toHaveCount(0);
  });
});

test.describe("Planning editor snapshot (R1, desktop 1280)", () => {
  test.use({ viewport: { width: 1280, height: 800 }, storageState: USER_C_STATE });

  test("refresh при открытом dirty editor: Save отправляет только plannedDate, чужой deadline сохранён", async ({
    page,
  }) => {
    const title = `R1 дедлайн ${run}`;
    const today = await serverToday(page);
    const future = shift(today, 3);
    const foreignDeadline = shift(today, 7);

    // 1. Своя synthetic задача: plan/time/deadline NULL.
    await page.goto("/inbox");
    await page.getByLabel("Название задачи").fill(title);
    await page.getByRole("button", { name: "Добавить задачу" }).click();
    const row = page.locator("li[data-task-id]", { hasText: title });
    await expect(row).toBeVisible();
    const taskId = await row.getAttribute("data-task-id");
    expect(taskId).not.toBeNull();

    // 2. Editor: меняем только plannedDate.
    await row.getByRole("button", { name: "Планирование" }).click();
    const dateInput = row.getByLabel("Дата выполнения");
    await dateInput.fill(future);

    // 3. Второй клиент (тот же аккаунт, authenticated API, Origin) пишет deadline.
    await secondPatch(taskId as string, { deadlineDate: foreignDeadline });

    // 4. «Обновить»: editor остаётся открыт с draft (snapshot открытия).
    const refreshRead = page.waitForResponse(
      (response) =>
        response.url().includes("/api/v1/tasks?") &&
        response.request().method() === "GET" &&
        response.status() === 200,
    );
    await page.getByRole("button", { name: "Обновить" }).click();
    await refreshRead;
    await expect(dateInput).toHaveValue(future);
    // Поле дедлайна показывает snapshot открытия (NULL), не чужое значение.
    await expect(row.getByLabel("Дедлайн")).toHaveValue("");

    // 5. Save: тело настоящего PATCH, ушедшего в сеть (200).
    const savedPatch = page.waitForResponse(
      (response) =>
        response.url().includes(`/api/v1/tasks/${taskId}`) &&
        response.request().method() === "PATCH" &&
        response.status() === 200,
    );
    await row.getByRole("button", { name: "Сохранить" }).click();
    const patchResponse = await savedPatch;
    const sent = JSON.parse(
      patchResponse.request().postData() ?? "null",
    ) as Record<string, unknown> | null;
    expect(sent).not.toBeNull();
    expect(Object.keys(sent as Record<string, unknown>).sort()).toEqual([
      "plannedDate",
    ]);

    // 6. Чужой deadline не стёрт: GET item после записи.
    const item = await secondGetTask(taskId as string);
    expect(item.plannedDate).toBe(future);
    expect(item.plannedTime).toBeNull();
    expect(item.deadlineDate).toBe(foreignDeadline);

    // Editor закрыт, задача ушла из Inbox (planned = future).
    await expect(
      page.locator("li[data-task-id]", { hasText: title }),
    ).toHaveCount(0);
  });

  test("Cancel и повторное открытие: snapshot из актуального task, отменённый draft не воскресает", async ({
    page,
  }) => {
    const title = `R1 cancel ${run}`;
    const today = await serverToday(page);
    const future = shift(today, 3);
    const foreignDeadline = shift(today, 5);

    await page.goto("/inbox");
    await page.getByLabel("Название задачи").fill(title);
    await page.getByRole("button", { name: "Добавить задачу" }).click();
    const row = page.locator("li[data-task-id]", { hasText: title });
    await expect(row).toBeVisible();
    const taskId = await row.getAttribute("data-task-id");
    expect(taskId).not.toBeNull();

    await row.getByRole("button", { name: "Планирование" }).click();
    await row.getByLabel("Дата выполнения").fill(future);

    await secondPatch(taskId as string, { deadlineDate: foreignDeadline });

    const refreshRead = page.waitForResponse(
      (response) =>
        response.url().includes("/api/v1/tasks?") &&
        response.request().method() === "GET" &&
        response.status() === 200,
    );
    await page.getByRole("button", { name: "Обновить" }).click();
    await refreshRead;
    await row.getByRole("button", { name: "Отмена" }).click();
    await row.getByRole("button", { name: "Планирование" }).click();

    // Новый snapshot из актуального task: deadline подставлен, отменённый
    // draft даты не воскресает.
    await expect(row.getByLabel("Дедлайн")).toHaveValue(foreignDeadline);
    await expect(row.getByLabel("Дата выполнения")).toHaveValue("");
    // No-op: Save disabled — PATCH невозможен.
    await expect(
      row.getByRole("button", { name: "Сохранить" }),
    ).toBeDisabled();
  });

  test("правка только deadline: независимое чужое время не попадает в PATCH и сохраняется", async ({
    page,
  }) => {
    const title = `R1 время ${run}`;
    const today = await serverToday(page);
    const plannedDay = shift(today, 2);
    const foreignDeadline = shift(today, 6);

    // Создаём и планируем на future день (уходит из Inbox в Upcoming).
    await page.goto("/inbox");
    await page.getByLabel("Название задачи").fill(title);
    await page.getByRole("button", { name: "Добавить задачу" }).click();
    const row = page.locator("li[data-task-id]", { hasText: title });
    await expect(row).toBeVisible();
    const taskId = await row.getAttribute("data-task-id");
    expect(taskId).not.toBeNull();
    await row.getByRole("button", { name: "Планирование" }).click();
    await row.getByLabel("Дата выполнения").fill(plannedDay);
    await row.getByRole("button", { name: "Сохранить" }).click();
    await expect(page.locator("li[data-task-id]", { hasText: title })).toHaveCount(0);

    await page.goto(`/upcoming?start=${today}`);
    const upcomingRow = page.locator("li[data-task-id]", { hasText: title });
    await expect(upcomingRow).toBeVisible();

    // Editor: меняем только deadline.
    await upcomingRow.getByRole("button", { name: "Планирование" }).click();
    await upcomingRow.getByLabel("Дедлайн").fill(foreignDeadline);

    // Второй клиент ставит время (независимое поле) через API.
    await secondPatch(taskId as string, { plannedTime: "10:00" });

    const refreshRead = page.waitForResponse(
      (response) =>
        response.url().includes("/api/v1/tasks?") &&
        response.request().method() === "GET" &&
        response.status() === 200,
    );
    await page.getByRole("button", { name: "Обновить" }).click();
    await refreshRead;
    await expect(upcomingRow.getByLabel("Дедлайн")).toHaveValue(foreignDeadline);
    // Время показывает snapshot открытия (пусто), не чужое значение.
    await expect(upcomingRow.getByLabel("Время выполнения")).toHaveValue("");

    const savedPatch = page.waitForResponse(
      (response) =>
        response.url().includes(`/api/v1/tasks/${taskId}`) &&
        response.request().method() === "PATCH" &&
        response.status() === 200,
    );
    await upcomingRow.getByRole("button", { name: "Сохранить" }).click();
    const patchResponse = await savedPatch;
    const sent = JSON.parse(
      patchResponse.request().postData() ?? "null",
    ) as Record<string, unknown> | null;
    expect(sent).not.toBeNull();
    expect(Object.keys(sent as Record<string, unknown>).sort()).toEqual([
      "deadlineDate",
    ]);

    const item = await secondGetTask(taskId as string);
    expect(item.plannedDate).toBe(plannedDay);
    expect(item.plannedTime).toBe("10:00");
    expect(item.deadlineDate).toBe(foreignDeadline);
  });
});

test.describe("Today/Upcoming (desktop 1280)", () => {
  test.use({ viewport: { width: 1280, height: 800 }, storageState: USER_C_STATE });

  test("Today quick-add ставит plannedDate = server today", async ({ page }) => {
    const title = `Today qa ${run}`;
    await page.goto("/today");
    await page.getByLabel("Название задачи").fill(title);
    await page.getByRole("button", { name: "Добавить задачу" }).click();
    const row = page.locator("li[data-task-id]", { hasText: title });
    await expect(row).toBeVisible();

    // После reload остаётся на Сегодня (plannedDate = today персистентен).
    await page.reload();
    await expect(page.locator("li[data-task-id]", { hasText: title })).toBeVisible();

    // Проверка значения через Inbox planning editor (plannedDate = today).
    await page.goto("/inbox");
    // Задача спланирована — в Inbox её нет; открываем Today и планируем
    // заново на другой день не требуется: достаточно что она не в Inbox.
    await expect(page.locator("li[data-task-id]", { hasText: title })).toHaveCount(0);
  });

  test("deadline-only задача видна в Today с badge; без дублей", async ({
    page,
  }) => {
    const title = `Deadline only ${run}`;
    const today = await serverToday(page);
    // Через Inbox: создаём, ставим только дедлайн (без плана).
    await page.goto("/inbox");
    await page.getByLabel("Название задачи").fill(title);
    await page.getByRole("button", { name: "Добавить задачу" }).click();
    const row = page.locator("li[data-task-id]", { hasText: title });
    await expect(row).toBeVisible();
    await row.getByRole("button", { name: "Планирование" }).click();
    await row.getByLabel("Дедлайн").fill(shift(today, 1));
    await row.getByRole("button", { name: "Сохранить" }).click();
    // Deadline в будущем — остаётся в Inbox (deadline не убирает из Inbox).
    await expect(page.locator("li[data-task-id]", { hasText: title })).toBeVisible();

    // Ставим deadline на сегодня: задача остаётся в Inbox И видна в Today
    // (секция «Дедлайн сегодня») ровно один раз.
    await row.getByRole("button", { name: "Планирование" }).click();
    await row.getByLabel("Дедлайн").fill(today);
    await row.getByRole("button", { name: "Сохранить" }).click();
    await expect(page.locator("li[data-task-id]", { hasText: title })).toBeVisible();

    await page.goto("/today");
    const rows = page.locator("li[data-task-id]", { hasText: title });
    await expect(rows).toHaveCount(1);
    await expect(
      page.locator("section[data-section='deadlineToday'] li", { hasText: title }),
    ).toHaveCount(1);
    await expect(row.first()).toContainText("Дедлайн:");
  });

  test("Upcoming: prev/next/current навигация и reload сохраняют диапазон", async ({
    page,
  }) => {
    await page.goto("/upcoming");
    const range = page.getByTestId("upcoming-range");
    await expect(range).toBeVisible();
    const initialText = await range.textContent();

    await page.getByRole("button", { name: "Следующие 7 дней" }).click();
    await expect(range).not.toHaveText(initialText ?? "");
    // URL обновлён — reload сохраняет диапазон.
    await page.reload();
    await expect(range).not.toHaveText(initialText ?? "");

    await page.getByRole("button", { name: "Предыдущие 7 дней" }).click();
    await page.getByRole("button", { name: "Предыдущие 7 дней" }).click();
    await expect(range).toBeVisible();
    await page.getByRole("button", { name: "Ближайшие 7 дней" }).click();
    await expect(range).toHaveText(initialText ?? "");
  });

  test("невалидный start → явная ошибка", async ({ page }) => {
    await page.goto("/upcoming?start=not-a-date");
    await expect(page.getByText("Некорректная дата начала периода")).toBeVisible();
  });

test.describe("Timezone labels (R6, desktop 1280)", () => {
  // R6: браузер явно в UTC; account зона меняется серверно (Asia/Tokyo) —
  // «Сегодня» обязан показывать server-derived context, а не зону браузера.
  test.use({
    viewport: { width: 1280, height: 800 },
    storageState: USER_C_STATE,
    timezoneId: "UTC",
  });

  test("R6: account Asia/Tokyo — Сегодня показывает server context из ответа Refresh", async ({
    page,
  }) => {
    const pageErrors: Error[] = [];
    page.on("pageerror", (error) => pageErrors.push(error));

    // Фактическая зона браузера — UTC (не полагаемся на настройки стенда).
    expect(
      await page.evaluate(() =>
        Intl.DateTimeFormat().resolvedOptions().timeZone,
      ),
    ).toBe("UTC");

    // Прежняя зона аккаунта для восстановления в finally.
    const initialSettings = await page.request.get("/api/v1/settings");
    expect(initialSettings.status()).toBe(200);
    const initialZone = (
      (await initialSettings.json()) as { settings: { timezone: string } }
    ).settings.timezone;
    await page.goto("/today");
    const origin = new URL(page.url()).origin;

    try {
      // Установка Asia/Tokyo: валидный Origin, точный 200, GET-подтверждение
      // (403 не успех).
      const patch = await page.request.patch("/api/v1/settings", {
        data: { timezone: "Asia/Tokyo" },
        headers: { "content-type": "application/json", origin },
      });
      expect(patch.status()).toBe(200);
      const confirm = await page.request.get("/api/v1/settings");
      expect(confirm.status()).toBe(200);
      expect(
        (
          (await confirm.json()) as { settings: { timezone: string } }
        ).settings.timezone,
      ).toBe("Asia/Tokyo");

      // Ждём ответ РЕАЛЬНОГО Refresh (waitForResponse до клика), UI
      // проверяем по ЕГО context — без отдельного прежнего GET и без
      // гонки полуночи.
      const refreshed = page.waitForResponse(
        (response) =>
          response.request().method() === "GET" &&
          response.url().includes("/api/v1/tasks?") &&
          response.status() === 200,
      );
      await page.getByRole("button", { name: "Обновить" }).click();
      const context = (
        (await (await refreshed).json()) as {
          context: { timezone: string; today: string; asOf: string };
        }
      ).context;
      expect(context.timezone).toBe("Asia/Tokyo");
      // today из собственного asOf в зоне ответа.
      const tokyoToday = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Tokyo",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date(context.asOf));
      expect(context.today).toBe(tokyoToday);

      // UI показывает server-derived зону и дату (браузер при этом в UTC).
      await expect(
        page.getByText(`${context.today} · Asia/Tokyo`),
      ).toBeVisible();
    } finally {
      // Восстановление прежней зоны: точный 200 + GET-подтверждение.
      const restore = await page.request.patch("/api/v1/settings", {
        data: { timezone: initialZone },
        headers: { "content-type": "application/json", origin },
      });
      expect(restore.status()).toBe(200);
      const confirmRestore = await page.request.get("/api/v1/settings");
      expect(confirmRestore.status()).toBe(200);
      expect(
        (
          (await confirmRestore.json()) as { settings: { timezone: string } }
        ).settings.timezone,
      ).toBe(initialZone);
    }
    expect(pageErrors).toEqual([]);
  });
});
});

test.describe("Upcoming границы окна (R5, desktop 1280)", () => {
  test.use({ viewport: { width: 1280, height: 800 }, storageState: USER_C_STATE });

  test("R5: нижняя граница — 7 групп 1900-01-01..07, prev disabled, bypass безопасен, next работает", async ({
    page,
  }) => {
    const pageErrors: Error[] = [];
    page.on("pageerror", (error) => pageErrors.push(error));

    await page.goto("/upcoming?start=1900-01-01");
    const groups = page.locator("[data-testid='upcoming-groups'] section");
    await expect(groups).toHaveCount(7);
    await expect(groups.first()).toHaveAttribute("data-group-date", "1900-01-01");
    await expect(groups.last()).toHaveAttribute("data-group-date", "1900-01-07");
    await expect(page.getByTestId("upcoming-range")).toHaveText(
      "Период: 01.01.1900 — 07.01.1900",
    );

    const prev = page.getByRole("button", { name: "Предыдущие 7 дней" });
    const next = page.getByRole("button", { name: "Следующие 7 дней" });
    await expect(prev).toBeDisabled();
    await expect(next).toBeEnabled();

    // Программный обход disabled: URL не меняется, без uncaught.
    const urlBefore = page.url();
    await prev.dispatchEvent("click");
    await flushMicrotasks(page);
    expect(page.url()).toBe(urlBefore);

    // Обычный next работает; после перехода prev снова доступен.
    await next.click();
    await expect(page).toHaveURL(/start=1900-01-08/);
    await expect(page.getByTestId("upcoming-range")).toHaveText(
      "Период: 08.01.1900 — 14.01.1900",
    );
    await expect(prev).toBeEnabled();
    expect(pageErrors).toEqual([]);
  });

  test("R5: последнее допустимое окно 2199-12-25..31 — next disabled, bypass безопасен, prev/next работают", async ({
    page,
  }) => {
    const pageErrors: Error[] = [];
    page.on("pageerror", (error) => pageErrors.push(error));

    await page.goto("/upcoming?start=2199-12-25");
    const groups = page.locator("[data-testid='upcoming-groups'] section");
    await expect(groups).toHaveCount(7);
    await expect(groups.first()).toHaveAttribute("data-group-date", "2199-12-25");
    await expect(groups.last()).toHaveAttribute("data-group-date", "2199-12-31");
    await expect(page.getByTestId("upcoming-range")).toHaveText(
      "Период: 25.12.2199 — 31.12.2199",
    );

    const prev = page.getByRole("button", { name: "Предыдущие 7 дней" });
    const next = page.getByRole("button", { name: "Следующие 7 дней" });
    await expect(next).toBeDisabled();
    await expect(prev).toBeEnabled();

    const urlBefore = page.url();
    await next.dispatchEvent("click");
    await flushMicrotasks(page);
    expect(page.url()).toBe(urlBefore);

    // Обычная навигация: prev → 2199-12-18, next обратно → 2199-12-25,
    // reload сохраняет диапазон.
    await prev.click();
    await expect(page).toHaveURL(/start=2199-12-18/);
    await expect(next).toBeEnabled();
    await next.click();
    await expect(page).toHaveURL(/start=2199-12-25/);
    await expect(next).toBeDisabled();
    await page.reload();
    await expect(page).toHaveURL(/start=2199-12-25/);
    await expect(page.getByTestId("upcoming-range")).toHaveText(
      "Период: 25.12.2199 — 31.12.2199",
    );
    expect(pageErrors).toEqual([]);
  });

  test("R5: промежуточный край start=2199-12-20 — next запрещён из-за недопустимого end", async ({
    page,
  }) => {
    const pageErrors: Error[] = [];
    page.on("pageerror", (error) => pageErrors.push(error));

    // Окно 20..26 валидно (SSR принимает), но +7 дало бы 27..33 —
    // next запрещён, хотя start=2199-12-27 сам по себе валиден.
    await page.goto("/upcoming?start=2199-12-20");
    const groups = page.locator("[data-testid='upcoming-groups'] section");
    await expect(groups).toHaveCount(7);
    await expect(groups.last()).toHaveAttribute("data-group-date", "2199-12-26");

    const prev = page.getByRole("button", { name: "Предыдущие 7 дней" });
    const next = page.getByRole("button", { name: "Следующие 7 дней" });
    await expect(next).toBeDisabled();
    await expect(prev).toBeEnabled();

    const urlBefore = page.url();
    await next.dispatchEvent("click");
    await flushMicrotasks(page);
    expect(page.url()).toBe(urlBefore);

    // Безопасная навигация: prev → 2199-12-13, next обратно → 2199-12-20.
    await prev.click();
    await expect(page).toHaveURL(/start=2199-12-13/);
    await expect(next).toBeEnabled();
    await next.click();
    await expect(page).toHaveURL(/start=2199-12-20/);
    await expect(next).toBeDisabled();
    expect(pageErrors).toEqual([]);
  });
});

async function flushMicrotasks(page: import("@playwright/test").Page): Promise<void> {
  // Один macrotask-flush: обработка заблокированного handler-а в странице.
  await page.evaluate(
    () => new Promise<void>((resolve) => setTimeout(resolve, 0)),
  );
}

test.describe("Timezone editor label (R8, desktop 1280)", () => {
  test.use({
    viewport: { width: 1280, height: 800 },
    storageState: USER_C_STATE,
    timezoneId: "UTC",
  });

  test("R8: подпись зоны в Inbox/Today/Upcoming; Refresh обновляет её при dirty draft без unsolicited PATCH", async ({
    page,
  }) => {
    const pageErrors: Error[] = [];
    page.on("pageerror", (error) => pageErrors.push(error));

    // Прежняя зона аккаунта для восстановления в finally.
    const initialSettings = await page.request.get("/api/v1/settings");
    expect(initialSettings.status()).toBe(200);
    const initialZone = (
      (await initialSettings.json()) as { settings: { timezone: string } }
    ).settings.timezone;

    // Fixtures: Inbox (без плана), Today (план сегодня), Upcoming (план +2).
    const today = await serverToday(page);
    const upcomingDay = shift(today, 2);
    await page.goto("/inbox");
    const inboxTitle = `R8 inbox ${run}`;
    const todayTitle = `R8 today ${run}`;
    const upcomingTitle = `R8 upcoming ${run}`;
    const created = page.getByLabel("Название задачи");
    async function quickAdd(title: string): Promise<string> {
      await created.fill(title);
      await page.getByRole("button", { name: "Добавить задачу" }).click();
      const row = page.locator("li[data-task-id]", { hasText: title });
      await expect(row).toBeVisible();
      const id = await row.getAttribute("data-task-id");
      expect(id).not.toBeNull();
      return id as string;
    }
    const inboxTaskId = await quickAdd(inboxTitle);
    const todayTaskId = await quickAdd(todayTitle);
    const todayRow = page.locator(`li[data-task-id="${todayTaskId}"]`);
    await todayRow.getByRole("button", { name: "Планирование" }).click();
    await todayRow.getByLabel("Дата выполнения").fill(today);
    await todayRow.getByRole("button", { name: "Сохранить" }).click();
    await expect(todayRow).toHaveCount(0);
    const upcomingTaskId = await quickAdd(upcomingTitle);
    const upcomingRow = page.locator(`li[data-task-id="${upcomingTaskId}"]`);
    await upcomingRow.getByRole("button", { name: "Планирование" }).click();
    await upcomingRow.getByLabel("Дата выполнения").fill(upcomingDay);
    await upcomingRow.getByRole("button", { name: "Сохранить" }).click();
    await expect(upcomingRow).toHaveCount(0);

    // Account Asia/Tokyo: Origin, точный 200, GET-подтверждение.
    await page.goto("/inbox");
    const origin = new URL(page.url()).origin;
    try {
    const patch = await page.request.patch("/api/v1/settings", {
      data: { timezone: "Asia/Tokyo" },
      headers: { "content-type": "application/json", origin },
    });
    expect(patch.status()).toBe(200);
    const confirm = await page.request.get("/api/v1/settings");
    expect(confirm.status()).toBe(200);
    expect(
      (
        (await confirm.json()) as { settings: { timezone: string } }
      ).settings.timezone,
    ).toBe("Asia/Tokyo");

    // Inbox получил зону из SSR до патча — metadata обновляется штатным
    // Refresh (waitForResponse до клика), как в принятой R6 модели.
    const tokyoRefreshed = page.waitForResponse(
      (response) =>
        response.request().method() === "GET" &&
        response.url().includes("/api/v1/tasks?") &&
        response.status() === 200,
    );
    await page.getByRole("button", { name: "Обновить" }).click();
    const tokyoContext = (
      (await (await tokyoRefreshed).json()) as {
        context: { timezone: string };
      }
    ).context;
    expect(tokyoContext.timezone).toBe("Asia/Tokyo");

    // PATCH-наблюдатель для unsolicited-PATCH проверки.
    let patchCount = 0;
    await page.route("**/api/v1/tasks/*", async (route) => {
      if (route.request().method() === "PATCH") {
        patchCount += 1;
      }
      await route.continue();
    });

    // Таблица-сценарий: подпись зоны editor на трёх экранах.
    const inboxRow = page.locator(`li[data-task-id="${inboxTaskId}"]`);
    await inboxRow.getByRole("button", { name: "Планирование" }).click();
    await expect(
      inboxRow.getByText("Время в зоне Asia/Tokyo"),
    ).toBeVisible();
    await inboxRow.getByRole("button", { name: "Отмена" }).click();

    await page.goto("/today");
    const todayBoardRow = page.locator(`li[data-task-id="${todayTaskId}"]`);
    await expect(todayBoardRow).toBeVisible();
    await todayBoardRow.getByRole("button", { name: "Планирование" }).click();
    await expect(
      todayBoardRow.getByText("Время в зоне Asia/Tokyo"),
    ).toBeVisible();
    await todayBoardRow.getByRole("button", { name: "Отмена" }).click();

    await page.goto(`/upcoming?start=${today}`);
    const upcomingBoardRow = page.locator(
      `li[data-task-id="${upcomingTaskId}"]`,
    );
    await expect(upcomingBoardRow).toBeVisible();
    await upcomingBoardRow.getByRole("button", { name: "Планирование" }).click();
    await expect(
      upcomingBoardRow.getByText("Время в зоне Asia/Tokyo"),
    ).toBeVisible();
    await upcomingBoardRow.getByRole("button", { name: "Отмена" }).click();

    // Inbox dirty draft: смена зоны на Europe/Moscow через API, реальный
    // Refresh — подпись обновляется в открытом editor, draft сохранён,
    // без unsolicited PATCH.
    await page.goto("/inbox");
    await inboxRow.getByRole("button", { name: "Планирование" }).click();
    const dateInput = inboxRow.getByLabel("Дата выполнения");
    const draftDay = shift(today, 4);
    await dateInput.fill(draftDay);

    const moscowPatch = await page.request.patch("/api/v1/settings", {
      data: { timezone: "Europe/Moscow" },
      headers: { "content-type": "application/json", origin },
    });
    expect(moscowPatch.status()).toBe(200);

    const refreshed = page.waitForResponse(
      (response) =>
        response.request().method() === "GET" &&
        response.url().includes("/api/v1/tasks?") &&
        response.status() === 200,
    );
    const patchesBeforeRefresh = patchCount;
    await page.getByRole("button", { name: "Обновить" }).click();
    const refreshedResponse = await refreshed;
    const refreshedContext = (
      (await refreshedResponse.json()) as {
        context: { timezone: string };
      }
    ).context;
    expect(refreshedContext.timezone).toBe("Europe/Moscow");
    await expect(
      inboxRow.getByText("Время в зоне Europe/Moscow"),
    ).toBeVisible();
    await expect(dateInput).toHaveValue(draftDay);
    expect(patchCount).toBe(patchesBeforeRefresh);

    // Save: только dirty plannedDate, значение без преобразования; GET item
    // подтверждает сохранение.
    const saved = page.waitForResponse(
      (response) =>
        response.request().method() === "PATCH" &&
        response.url().includes(`/api/v1/tasks/${inboxTaskId}`) &&
        response.status() === 200,
    );
    await inboxRow.getByRole("button", { name: "Сохранить" }).click();
    const savedResponse = await saved;
    const sent = JSON.parse(
      savedResponse.request().postData() ?? "{}",
    ) as Record<string, unknown>;
    expect(Object.keys(sent).sort()).toEqual(["plannedDate"]);
    expect(sent.plannedDate).toBe(draftDay);
    const item = await page.request.get(`/api/v1/tasks/${inboxTaskId}`);
    expect(item.status()).toBe(200);
    const itemTask = (
      (await item.json()) as {
        task: {
          plannedDate: string | null;
          plannedTime: string | null;
          deadlineDate: string | null;
        };
      }
    ).task;
    expect(itemTask.plannedDate).toBe(draftDay);
    expect(itemTask.plannedTime).toBeNull();
    expect(itemTask.deadlineDate).toBeNull();
    await expect(inboxRow).toHaveCount(0);

    } finally {
      // Восстановление захваченной initialZone работает и при упавшем
      // assertion: Origin, точный 200, GET-подтверждение.
      const restore = await page.request.patch("/api/v1/settings", {
        data: { timezone: initialZone },
        headers: { "content-type": "application/json", origin },
      });
      expect(restore.status()).toBe(200);
      const confirmRestore = await page.request.get("/api/v1/settings");
      expect(confirmRestore.status()).toBe(200);
      expect(
        (
          (await confirmRestore.json()) as { settings: { timezone: string } }
        ).settings.timezone,
      ).toBe(initialZone);
    }
    expect(pageErrors).toEqual([]);
  });
});

test.describe("Inbox планирование на мобильной ширине (360)", () => {
  test.use({ viewport: { width: 360, height: 740 }, storageState: USER_C_STATE });

  test("планирование с клавиатуры, без overflow", async ({ page }) => {
    const title = `Моб план ${run}`;
    await page.goto("/inbox");
    await page.getByLabel("Название задачи").fill(title);
    await page.getByRole("button", { name: "Добавить задачу" }).click();
    const row = page.locator("li[data-task-id]", { hasText: title });
    await expect(row).toBeVisible();

    await row.getByRole("button", { name: "Планирование" }).click();
    const dateInput = row.getByLabel("Дата выполнения");
    await dateInput.fill("2026-09-01");
    await row.getByRole("button", { name: "Сохранить" }).click();
    await expect(page.locator("li[data-task-id]", { hasText: title })).toHaveCount(0);

    const scrollWidth = await page.evaluate(
      () => document.documentElement.scrollWidth,
    );
    expect(scrollWidth).toBeLessThanOrEqual(360);
  });
});

async function serverToday(page: import("@playwright/test").Page): Promise<string> {
  const response = await page.request.get("/api/v1/tasks?view=today&status=all");
  const payload = (await response.json()) as {
    context: { today: string };
  };
  return payload.context.today;
}

type TaskItemPayload = {
  task: {
    plannedDate: string | null;
    plannedTime: string | null;
    deadlineDate: string | null;
  };
};

/**
 * Второй клиент (R1): тот же аккаунт C, независимый APIRequestContext
 * с правильным Origin — пишет в ту же задачу мимо UI первого экрана.
 */
async function secondPatch(
  taskId: string,
  patch: Record<string, string | null>,
): Promise<void> {
  const origin = `http://127.0.0.1:${e2ePort}`;
  const context = await apiRequest.newContext({
    baseURL: origin,
    storageState: USER_C_STATE,
  });
  try {
    const response = await context.patch(`/api/v1/tasks/${taskId}`, {
      data: patch,
      headers: { "content-type": "application/json", origin },
    });
    expect(response.status()).toBe(200);
  } finally {
    await context.dispose();
  }
}

async function secondGetTask(taskId: string): Promise<TaskItemPayload["task"]> {
  const origin = `http://127.0.0.1:${e2ePort}`;
  const context = await apiRequest.newContext({
    baseURL: origin,
    storageState: USER_C_STATE,
  });
  try {
    const response = await context.get(`/api/v1/tasks/${taskId}`);
    expect(response.status()).toBe(200);
    const payload = (await response.json()) as TaskItemPayload;
    return payload.task;
  } finally {
    await context.dispose();
  }
}

function shift(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

function ru_date(date: string): string {
  return `${date.slice(8, 10)}.${date.slice(5, 7)}.${date.slice(0, 4)}`;
}
