import { expect, test } from "@playwright/test";

const USER_A_STATE = "test-results/.auth/user-a.json";
const run = `t7-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

// Задачи — mutable fixtures пользователя A: settings.spec ревокирует
// сессию B (нельзя делить), projects.spec мутирует только projects.
// Файл сериализован: тесты используют общее состояние списка A.
test.describe.configure({ mode: "default" });

test.describe("входящие: quick-add/rename/complete (desktop 1280)", () => {
  test.use({ viewport: { width: 1280, height: 800 }, storageState: USER_A_STATE });

  test("quick-add по Enter, rename cancel/save, reload сохраняет", async ({
    page,
  }) => {
    await page.goto("/inbox");
    const input = page.getByLabel("Название задачи");

    await input.fill(`Задача ${run}`);
    await input.press("Enter");
    const row = page.locator("li[data-task-id]", { hasText: `Задача ${run}` });
    await expect(row).toBeVisible();

    await page.reload();
    await expect(row).toBeVisible();

    // Rename: cancel ничего не пишет, фокус возвращается к trigger.
    const trigger = row.getByRole("button", { name: "Переименовать" });
    await trigger.click();
    const renameInput = page.getByLabel("Переименовать");
    await renameInput.fill(`Задача ${run} ОТМЕНА`);
    await page.getByRole("button", { name: "Отмена" }).click();
    await expect(row).toBeVisible();
    await expect(trigger).toBeFocused();

    await trigger.click();
    await renameInput.fill(`Задача ${run} (обновлена)`);
    await page.getByRole("button", { name: "Сохранить" }).click();
    await expect(
      page.locator("li[data-task-id]", { hasText: `Задача ${run} (обновлена)` }),
    ).toBeVisible();

    await page.reload();
    await expect(
      page.locator("li[data-task-id]", { hasText: `Задача ${run} (обновлена)` }),
    ).toBeVisible();
  });

  test("complete → вкладка Завершённые → reopen → открытые", async ({ page }) => {
    const name = `Цикл ${run}`;
    await page.goto("/inbox");
    await page.getByLabel("Название задачи").fill(name);
    await page.getByRole("button", { name: "Добавить задачу" }).click();
    const row = page.locator("li[data-task-id]", { hasText: name });
    await expect(row).toBeVisible();

    await row.getByRole("button", { name: "Завершить" }).click();
    await expect(page.locator("li[data-task-id]", { hasText: name })).toHaveCount(0);

    await page.getByRole("button", { name: "Завершённые", exact: true }).click();
    const completedRow = page.locator("li[data-task-id]", { hasText: name });
    await expect(completedRow).toBeVisible();

    await completedRow.getByRole("button", { name: "Открыть снова" }).click();
    await expect(page.locator("li[data-task-id]", { hasText: name })).toHaveCount(0);

    await page.getByRole("button", { name: "Открытые", exact: true }).click();
    await expect(page.locator("li[data-task-id]", { hasText: name })).toBeVisible();
  });

  test("удаление: cancel ничего не меняет, confirm скрывает после reload", async ({
    page,
  }) => {
    const name = `Удаление ${run}`;
    await page.goto("/inbox");
    await page.getByLabel("Название задачи").fill(name);
    await page.getByRole("button", { name: "Добавить задачу" }).click();
    const row = page.locator("li[data-task-id]", { hasText: name });
    await expect(row).toBeVisible();

    await row.getByRole("button", { name: "Удалить" }).click();
    await expect(page.getByText("Удалить задачу?")).toBeVisible();
    await row.getByRole("button", { name: "Отмена", exact: true }).click();
    await expect(row).toBeVisible();

    await row.getByRole("button", { name: "Удалить" }).click();
    await expect(page.getByText("Удалить задачу?")).toBeVisible();
    await row
      .getByRole("button", { name: "Удалить", exact: true })
      .last()
      .click();
    await expect(page.locator("li[data-task-id]", { hasText: name })).toHaveCount(0);

    await page.reload();
    await expect(page.locator("li[data-task-id]", { hasText: name })).toHaveCount(0);
    // Ни в завершённых тоже.
    await page.getByRole("button", { name: "Завершённые", exact: true }).click();
    await expect(page.locator("li[data-task-id]", { hasText: name })).toHaveCount(0);
  });

  test("failed create: draft и сообщение об ошибке, retry успешен", async ({
    page,
  }) => {
    await page.route("**/api/v1/tasks", (route) =>
      route.fulfill({
        status: 500,
        contentType: "application/json",
        body: '{"error":{"code":"INTERNAL"}}',
      }),
    );
    await page.goto("/inbox");
    const input = page.getByLabel("Название задачи");
    await input.fill(`Отказ ${run}`);
    await page.getByRole("button", { name: "Добавить задачу" }).click();
    await expect(page.getByText("Не удалось добавить задачу")).toBeVisible();
    await expect(input).toHaveValue(`Отказ ${run}`);
    await expect(
      page.locator("li[data-task-id]", { hasText: `Отказ ${run}` }),
    ).toHaveCount(0);

    await page.unroute("**/api/v1/tasks");
    await page.getByRole("button", { name: "Добавить задачу" }).click();
    await expect(
      page.locator("li[data-task-id]", { hasText: `Отказ ${run}` }),
    ).toBeVisible();
    await expect(page.getByText("Не удалось добавить задачу")).toHaveCount(0);
  });

  test("500 cp emoji title вставляется полностью; 501 отклоняется", async ({
    page,
  }) => {
    await page.goto("/inbox");
    const input = page.getByLabel("Название задачи");
    await input.click();
    await page.keyboard.insertText("🦄".repeat(500));
    const codePoints = await input.evaluate(
      (el) => Array.from((el as HTMLInputElement).value).length,
    );
    expect(codePoints).toBe(500);
    await input.press("Enter");
    const row = page
      .locator("li[data-task-id]")
      .filter({ hasText: "🦄".repeat(500) });
    await expect(row).toBeVisible();

    await input.click();
    await page.keyboard.insertText("🦄".repeat(501));
    await input.press("Enter");
    await expect(page.getByText("Введите название задачи")).toBeVisible();
    const invalid = await input.evaluate(
      (el) => Array.from((el as HTMLInputElement).value).length,
    );
    expect(invalid).toBe(501);
  });

  test("R1: подтверждённый create + сбой чтения → read error/retry без повторного POST", async ({
    page,
  }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => {
      pageErrors.push(String(error));
    });
    let postCount = 0;
    let getAborted = false;
    await page.route("**/api/v1/tasks*", async (route) => {
      if (route.request().method() === "POST") {
        // POST проходит на реальный сервер: create подтверждён и записан в БД.
        postCount += 1;
        await route.fallback();
        return;
      }
      getAborted = true;
      await route.abort();
    });

    await page.goto("/inbox");
    const input = page.getByLabel("Название задачи");
    await input.fill("R1 задача");
    await page.getByRole("button", { name: "Добавить задачу" }).click();
    // POST подтверждён (201): ложный failed create недопустим — показывается
    // read error с retry (только GET), draft очищен.
    await expect(
      page.getByText("Не удалось обновить список задач."),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Повторить" })).toBeVisible();
    await expect(input).toHaveValue("");
    await expect(page.getByText("Не удалось добавить задачу")).toHaveCount(0);

    // Retry выполняет только чтение; восстановление GET показывает задачу
    // ровно один раз, без повторного POST; unhandled rejections отсутствуют.
    await page.unroute("**/api/v1/tasks*");
    await page.getByRole("button", { name: "Повторить" }).click();
    await expect(
      page.locator("li[data-task-id]", { hasText: "R1 задача" }),
    ).toBeVisible();
    expect(
      await page.locator("li[data-task-id]", { hasText: "R1 задача" }).count(),
    ).toBe(1);
    expect(postCount).toBe(1);
    expect(getAborted).toBe(true);
    expect(pageErrors).toEqual([]);
  });

  test("R2: при pending complete строки её rename/delete/toggle недоступны, вторая mutation не отправляется", async ({
    page,
  }) => {
    const name = `R2 ${run}`;
    let patchCount = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route("**/api/v1/tasks/**", async (route) => {
      if (route.request().method() === "PATCH") {
        patchCount += 1;
        await gate;
        await route.fulfill({
          status: 500,
          contentType: "application/json",
          body: '{"error":{"code":"INTERNAL"}}',
        });
        return;
      }
      await route.fallback();
    });

    await page.goto("/inbox");
    await page.getByLabel("Название задачи").fill(name);
    await page.getByRole("button", { name: "Добавить задачу" }).click();
    const row = page.locator("li[data-task-id]", { hasText: name });
    await expect(row).toBeVisible();

    await row.getByRole("button", { name: "Завершить" }).click();
    // Пока completion в полёте: конфликтующие действия строки недоступны.
    await expect(row.getByRole("button", { name: "Переименовать" })).toBeDisabled();
    await expect(row.getByRole("button", { name: "Удалить" })).toBeDisabled();
    // Pending-лейбл кнопки toggle — «Завершение…».
    await expect(
      row.getByRole("button", { name: /Завершить|Завершение/ }),
    ).toBeDisabled();

    // Force/programmatic попытки не открывают editor/confirmation и не шлют
    // вторую mutation.
    await row
      .getByRole("button", { name: "Переименовать" })
      .click({ force: true })
      .catch(() => undefined);
    await expect(row.getByRole("textbox")).toHaveCount(0);
    await row
      .getByRole("button", { name: "Удалить" })
      .click({ force: true })
      .catch(() => undefined);
    await expect(page.getByText("Удалить задачу?")).toHaveCount(0);
    await row
      .getByRole("button", { name: /Завершить|Завершение/ })
      .click({ force: true })
      .catch(() => undefined);
    expect(patchCount).toBe(1);

    // После отказа guards сняты: кнопки доступны, задача осталась открытой.
    release();
    await expect(row.getByRole("alert")).toBeVisible();
    await expect(row.getByRole("button", { name: "Переименовать" })).toBeEnabled();
    await expect(row.getByRole("button", { name: "Удалить" })).toBeEnabled();
    await expect(row.getByRole("button", { name: "Завершить" })).toBeEnabled();
    await page.unroute("**/api/v1/tasks/**");
    await row.getByRole("button", { name: "Завершить" }).click();
    await expect(page.locator("li[data-task-id]", { hasText: name })).toHaveCount(0);
  });

  test("R3: delete confirmation — keyboard focus/Escape/cancel/confirm", async ({
    page,
  }) => {
    let deleteCount = 0;
    await page.route("**/api/v1/tasks/**", async (route) => {
      if (route.request().method() === "DELETE") {
        deleteCount += 1;
      }
      await route.fallback();
    });
    const name = `R3 ${run}`;
    await page.goto("/inbox");
    await page.getByLabel("Название задачи").fill(name);
    await page.getByRole("button", { name: "Добавить задачу" }).click();
    const row = page.locator("li[data-task-id]", { hasText: name });
    await expect(row).toBeVisible();
    const taskId = await row.getAttribute("data-task-id");
    expect(taskId).not.toBeNull();

    // Keyboard open: фокус внутри confirmation — безопасная «Отмена».
    await row.getByRole("button", { name: "Удалить" }).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByText("Удалить задачу?")).toBeVisible();
    // Под нагрузкой коммиты запаздывают: авто-ретраящий локатор-ассерт.
    await expect(
      page.locator(`#task-delete-cancel-${taskId}`),
    ).toBeFocused({ timeout: 5000 });

    // Escape до DELETE: отмена + фокус на trigger, мутирующего запроса нет.
    await page.keyboard.press("Escape");
    await expect(page.getByText("Удалить задачу?")).toHaveCount(0);
    await expect(
      page.locator(`#task-delete-trigger-${taskId}`),
    ).toBeFocused({ timeout: 5000 });
    expect(deleteCount).toBe(0);

    // Явная Отмена: фокус на trigger, без DELETE.
    await row.getByRole("button", { name: "Удалить" }).click();
    await expect(page.getByText("Удалить задачу?")).toBeVisible();
    await row.getByRole("button", { name: "Отмена", exact: true }).click();
    await expect(
      page.locator(`#task-delete-trigger-${taskId}`),
    ).toBeFocused({ timeout: 5000 });
    expect(deleteCount).toBe(0);

    // Keyboard confirm: ровно один DELETE; после удаления фокус на quick-add.
    await row.getByRole("button", { name: "Удалить" }).click();
    await expect(page.getByText("Удалить задачу?")).toBeVisible();
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Enter");
    await expect(
      page.locator("li[data-task-id]", { hasText: name }),
    ).toHaveCount(0);
    expect(deleteCount).toBe(1);
    await expect(page.locator("#task-title-input")).toBeFocused({
      timeout: 5000,
    });
    await page.unroute("**/api/v1/tasks/**");
  });

  test("R3b: отказ DELETE (500 и network) возвращает фокус в confirmation", async ({
    page,
  }) => {
    const name = `R3b ${run}`;
    let deleteCount = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let mode: "error500" | "network" = "error500";
    await page.route("**/api/v1/tasks/**", async (route) => {
      if (route.request().method() !== "DELETE") {
        await route.fallback();
        return;
      }
      deleteCount += 1;
      await gate;
      if (mode === "error500") {
        await route.fulfill({
          status: 500,
          contentType: "application/json",
          body: '{"error":{"code":"INTERNAL"}}',
        });
        return;
      }
      await route.abort();
    });

    await page.goto("/inbox");
    await page.getByLabel("Название задачи").fill(name);
    await page.getByRole("button", { name: "Добавить задачу" }).click();
    const row = page.locator("li[data-task-id]", { hasText: name });
    await expect(row).toBeVisible();
    const taskId = await row.getAttribute("data-task-id");
    expect(taskId).not.toBeNull();

    const cancel = () => page.locator(`#task-delete-cancel-${taskId}`);
    const trigger = () => page.locator(`#task-delete-trigger-${taskId}`);

    // Фаза 1: held DELETE → HTTP 500.
    await row.getByRole("button", { name: "Удалить" }).click();
    await expect(page.getByText("Удалить задачу?")).toBeVisible();
    await expect(cancel()).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Enter");
    await expect(cancel()).toBeDisabled();
    release();
    await expect(page.getByText("Не удалось удалить задачу")).toBeVisible();
    await expect(row).toBeVisible();
    await expect(cancel()).toBeEnabled();
    // R3b: после отказа и снятия pending фокус в живом confirmation.
    await expect(cancel()).toBeFocused();

    // Escape после отказа: отмена + фокус на trigger; DELETE не повторился.
    await page.keyboard.press("Escape");
    await expect(page.getByText("Удалить задачу?")).toHaveCount(0);
    await expect(trigger()).toBeFocused();
    expect(deleteCount).toBe(1);

    // Фаза 2: network rejection DELETE.
    mode = "network";
    await row.getByRole("button", { name: "Удалить" }).click();
    await expect(page.getByText("Удалить задачу?")).toBeVisible();
    await expect(cancel()).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Enter");
    release();
    await expect(page.getByText("Не удалось удалить задачу")).toBeVisible();
    await expect(cancel()).toBeEnabled();
    await expect(cancel()).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(page.getByText("Удалить задачу?")).toHaveCount(0);
    await expect(trigger()).toBeFocused();
    expect(deleteCount).toBe(2);

    // Retry-delete: успешное удаление, фокус на quick-add.
    await page.unroute("**/api/v1/tasks/**");
    await row.getByRole("button", { name: "Удалить" }).click();
    await expect(page.getByText("Удалить задачу?")).toBeVisible();
    await row.getByRole("button", { name: "Удалить", exact: true }).click();
    await expect(page.locator("li[data-task-id]", { hasText: name })).toHaveCount(0);
    // R2a: create input disabled до конца write flow — фокус landится
    // сразу после снятия pending (кадр-два); ждём его авто-ретраящим
    // toBeFocused вместо мгновенного чтения activeElement.
    await expect(page.locator("#task-title-input")).toBeFocused();
  });

  test("delayed complete + навигация: stale ответ не меняет UI", async ({
    page,
  }) => {
    const name = `Delayed ${run}`;
    await page.goto("/inbox");
    await page.getByLabel("Название задачи").fill(name);
    await page.getByRole("button", { name: "Добавить задачу" }).click();
    const row = page.locator("li[data-task-id]", { hasText: name });
    await expect(row).toBeVisible();

    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let fulfilled = false;
    await page.route("**/api/v1/tasks/**", async (route) => {
      await gate;
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: '{"error":{"code":"INTERNAL"}}',
      });
      fulfilled = true;
    });

    await row.getByRole("button", { name: "Завершить" }).click();
    // Уходим со страницы до ответа: stale обработчик ничего не применяет.
    await page.getByRole("link", { name: "Сегодня", exact: true }).click();
    await expect(page).toHaveURL(/\/today$/);
    release();
    await expect.poll(() => fulfilled).toBe(true);
    await page.waitForTimeout(300);

    await page.goto("/inbox");
    await page.unroute("**/api/v1/tasks/**");
    // Задача осталась открытой (запрос не дошёл до сервера).
    await expect(page.locator("li[data-task-id]", { hasText: name })).toBeVisible();
    // Обычное завершение после возврата работает.
    await page
      .locator("li[data-task-id]", { hasText: name })
      .getByRole("button", { name: "Завершить" })
      .click();
    await expect(page.locator("li[data-task-id]", { hasText: name })).toHaveCount(0);
    await page.getByRole("button", { name: "Завершённые", exact: true }).click();
    await expect(page.locator("li[data-task-id]", { hasText: name })).toBeVisible();
  });

  test("rename pending блокирует чужой editor; ответ закрывает только свою форму", async ({
    page,
  }) => {
    const nameP = `Rename P ${run}`;
    const nameQ = `Rename Q ${run}`;
    await page.goto("/inbox");
    for (const name of [nameP, nameQ]) {
      await page.getByLabel("Название задачи").fill(name);
      await page.getByRole("button", { name: "Добавить задачу" }).click();
      await expect(
        page.locator("li[data-task-id]", { hasText: name }),
      ).toBeVisible();
    }

    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route("**/api/v1/tasks/**", async (route) => {
      await gate;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: '{"task":{"id":"held","title":"held","projectId":null,"parentId":null,"completedAt":null,"revision":1,"createdAt":"2026-01-01T00:00:00.000Z","updatedAt":"2026-01-01T00:00:00.000Z"}}',
      });
    });

    const pTrigger = page
      .locator("li[data-task-id]", { hasText: nameP })
      .getByRole("button", { name: "Переименовать" });
    await pTrigger.click();
    await page.getByLabel("Переименовать").fill(`${nameP} — новое`);
    await page.getByRole("button", { name: "Сохранить" }).click();

    const qTrigger = page
      .locator("li[data-task-id]", { hasText: nameQ })
      .getByRole("button", { name: "Переименовать" });
    await expect(qTrigger).toBeDisabled();
    await qTrigger.click({ force: true }).catch(() => undefined);
    await expect(
      page.locator("li[data-task-id]", { hasText: nameQ }).getByRole("textbox"),
    ).toHaveCount(0);

    release();
    await expect(page.getByLabel("Переименовать")).toHaveCount(0);
    await expect(qTrigger).toBeEnabled();
    await page.unroute("**/api/v1/tasks/**");
  });
});

test.describe("входящие на мобильной ширине (360)", () => {
  test.use({ viewport: { width: 360, height: 740 }, storageState: USER_A_STATE });

  test("quick-add с клавиатуры, complete, tabs, без overflow", async ({
    page,
  }) => {
    await page.goto("/today");
    await page.getByRole("link", { name: "Входящие", exact: true }).click();
    await expect(page).toHaveURL(/\/inbox$/);

    const input = page.getByLabel("Название задачи");
    await input.fill(`Мобильная ${run}`);
    await input.press("Enter");
    const row = page.locator("li[data-task-id]", { hasText: `Мобильная ${run}` });
    await expect(row).toBeVisible();

    await row.getByRole("button", { name: "Завершить" }).click();
    await expect(
      page.locator("li[data-task-id]", { hasText: `Мобильная ${run}` }),
    ).toHaveCount(0);
    await page.getByRole("button", { name: "Завершённые", exact: true }).click();
    await expect(
      page.locator("li[data-task-id]", { hasText: `Мобильная ${run}` }),
    ).toBeVisible();

    const scrollWidth = await page.evaluate(
      () => document.documentElement.scrollWidth,
    );
    expect(scrollWidth).toBeLessThanOrEqual(360);
  });
});
