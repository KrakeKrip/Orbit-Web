import { expect, test } from "@playwright/test";

// Владелец project fixtures — пользователь A: его сессию никто не
// ревокирует (settings.spec завершается logout'ом B), а данные projects
// не пересекаются с theme/settings мутациями других specs.
const USER_A_STATE = "test-results/.auth/user-a.json";
const run = `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

// Проекты — mutable fixtures пользователя B (settings.spec мутирует только
// user_settings, theme.spec — тему A; пересечений по данным нет). Файл
// сериализован: тесты используют общее состояние списка B.
test.describe.configure({ mode: "default" });

test.describe("проекты: создание/переименование/архив (desktop 1280)", () => {
  test.use({ viewport: { width: 1280, height: 800 }, storageState: USER_A_STATE });

  test("создание по Enter, переименование, reload сохраняет состояние", async ({
    page,
  }) => {
    await page.goto("/projects");
    const input = page.getByLabel("Название проекта");

    await input.fill(`Проект ${run}`);
    await input.press("Enter");
    const row = page.locator("li", { hasText: `Проект ${run}` });
    await expect(row).toBeVisible();

    await page.reload();
    await expect(page.locator("li", { hasText: `Проект ${run}` })).toBeVisible();

    // Переименование: cancel ничего не пишет, фокус возвращается к trigger.
    const trigger = page
      .locator("li", { hasText: `Проект ${run}` })
      .getByRole("button", { name: "Переименовать" });
    await trigger.click();
    const renameInput = page.getByLabel("Переименовать");
    await renameInput.fill(`Проект ${run} ОТМЕНА`);
    await page.getByRole("button", { name: "Отмена" }).click();
    await expect(
      page.locator("li", { hasText: `Проект ${run}` }),
    ).toBeVisible();
    await expect(trigger).toBeFocused();

    // Переименование с сохранением.
    await trigger.click();
    await renameInput.fill(`Проект ${run} (обновлён)`);
    await page.getByRole("button", { name: "Сохранить" }).click();
    const renamed = page.locator("li", { hasText: `Проект ${run} (обновлён)` });
    await expect(renamed).toBeVisible();

    await page.reload();
    await expect(
      page.locator("li", { hasText: `Проект ${run} (обновлён)` }),
    ).toBeVisible();
  });

  test("невалидное имя: сообщение без создания проекта", async ({ page }) => {
    await page.goto("/projects");
    const before = await page.locator("li[data-project-id]").count();
    await page.getByLabel("Название проекта").fill("   ");
    await page.getByRole("button", { name: "Создать проект" }).click();
    await expect(page.getByText("Введите название проекта")).toBeVisible();
    expect(await page.locator("li[data-project-id]").count()).toBe(before);
  });

  test("архив: исчезает из активных, виден в архиве, restore возвращает", async ({
    page,
  }) => {
    const name = `Архивный ${run}`;
    await page.goto("/projects");
    await page.getByLabel("Название проекта").fill(name);
    await page.getByRole("button", { name: "Создать проект" }).click();
    const row = page.locator("li", { hasText: name });
    await expect(row).toBeVisible();

    await row.getByRole("button", { name: "Архивировать" }).click();
    await expect(page.locator("li", { hasText: name })).toHaveCount(0);

    await page.getByRole("button", { name: "Архив", exact: true }).click();
    const archivedRow = page.locator("li", { hasText: name });
    await expect(archivedRow).toBeVisible();

    // Rename доступен и в архиве.
    await archivedRow.getByRole("button", { name: "Переименовать" }).click();
    await page.getByLabel("Переименовать").fill(`${name} (архив)`);
    await page.getByRole("button", { name: "Сохранить" }).click();
    await expect(
      page.locator("li", { hasText: `${name} (архив)` }),
    ).toBeVisible();

    await page
      .locator("li", { hasText: `${name} (архив)` })
      .getByRole("button", { name: "Восстановить" })
      .click();
    await expect(
      page.locator("li", { hasText: `${name} (архив)` }),
    ).toHaveCount(0);

    await page.getByRole("button", { name: "Активные", exact: true }).click();
    await expect(
      page.locator("li", { hasText: `${name} (архив)` }),
    ).toBeVisible();
  });

  test("120 emoji code points: вставка без обрезания, 121 отклоняется", async ({
    page,
  }) => {
    await page.goto("/projects");
    const input = page.getByLabel("Название проекта");
    // keyboard.insertText — путь реальной вставки; HTML maxLength считает
    // UTF-16 units и молча резал бы non-BMP имена, поэтому лимит только
    // pure-валидацией по code points.
    await input.click();
    await page.keyboard.insertText("🦄".repeat(120));
    const inserted = await input.evaluate(
      (el) => Array.from((el as HTMLInputElement).value).length,
    );
    expect(inserted).toBe(120);
    await input.press("Enter");
    const row = page
      .locator("li[data-project-id]")
      .filter({ hasText: "🦄".repeat(120) });
    await expect(row).toBeVisible();

    await page.reload();
    await expect(row).toBeVisible();

    // 121 code point отклоняется локальной валидацией: сообщение + draft сохранён.
    await input.click();
    await page.keyboard.insertText("🦄".repeat(121));
    await input.press("Enter");
    await expect(page.getByText("Введите название проекта")).toBeVisible();
    const invalidLength = await input.evaluate(
      (el) => Array.from((el as HTMLInputElement).value).length,
    );
    expect(invalidLength).toBe(121);
  });

  test("rename Q недоступен при pending rename P; поздний ответ P не меняет Q", async ({
    page,
  }) => {
    await page.goto("/projects");
    for (const name of [`Rename P ${run}`, `Rename Q ${run}`]) {
      await page.getByLabel("Название проекта").fill(name);
      await page.getByRole("button", { name: "Создать проект" }).click();
      await expect(
        page.locator("li[data-project-id]", { hasText: name }),
      ).toBeVisible();
    }

    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let fulfilled = false;
    await page.route("**/api/v1/projects/**", async (route) => {
      await gate;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: '{"project":{"id":"held","name":"held","archivedAt":null,"createdAt":"2026-01-01T00:00:00.000Z","updatedAt":"2026-01-01T00:00:00.000Z"}}',
      });
      fulfilled = true;
    });

    const pRow = page.locator("li[data-project-id]", { hasText: `Rename P ${run}` });
    const pTrigger = pRow.getByRole("button", { name: "Переименовать" });
    await pTrigger.click();
    await page.getByLabel("Переименовать").fill(`Rename P ${run} — новое`);
    await page.getByRole("button", { name: "Сохранить" }).click();

    // Пока save P в pending: чужой trigger заблокирован, editor Q не
    // открывается (даже force-click по disabled кнопке не открывает форму).
    const qRow = page.locator("li[data-project-id]", { hasText: `Rename Q ${run}` });
    const qTrigger = qRow.getByRole("button", { name: "Переименовать" });
    await expect(qTrigger).toBeDisabled();
    await qTrigger.click({ force: true }).catch(() => undefined);
    await expect(qRow.getByRole("textbox")).toHaveCount(0);

    release();
    await expect.poll(() => fulfilled).toBe(true);
    // Ответ P закрывает только форму P; Q-триггер снова доступен.
    await expect(page.getByLabel("Переименовать")).toHaveCount(0);
    await expect(qTrigger).toBeEnabled();
    await page.unroute("**/api/v1/projects/**");
  });

  test("failed mutation: список/строка/draft сохраняются, retry успешен", async ({
    page,
  }) => {
    const name = `Отказ ${run}`;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route("**/api/v1/projects", async (route) => {
      await gate;
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: '{"error":{"code":"INTERNAL"}}',
      });
    });

    await page.goto("/projects");
    await page.getByLabel("Название проекта").fill(name);
    await page.getByRole("button", { name: "Создать проект" }).click();
    await expect(page.getByRole("alert").first()).toBeVisible();
    // Draft сохранён для retry, проект не показан как созданный.
    await expect(page.getByLabel("Название проекта")).toHaveValue(name);
    await expect(page.locator("li", { hasText: name })).toHaveCount(0);

    // Delayed/late ответ после ухода со страницы не ломает новый UI (R1
    // инвариант TASK-005): уходим, отпускаем 500, возвращаемся.
    await page.getByRole("link", { name: "Сегодня", exact: true }).click();
    await expect(page).toHaveURL(/\/today$/);
    release();
    await page.waitForTimeout(300);
    await expect(page.locator("html")).toBeVisible();

    await page.goto("/projects");
    await page.unroute("**/api/v1/projects");
    await page.getByLabel("Название проекта").fill(name);
    await page.getByRole("button", { name: "Создать проект" }).click();
    await expect(page.locator("li", { hasText: name })).toBeVisible();
    // Ошибка предыдущей попытки ушла (route announcer — тоже alert, поэтому
    // проверяем отсутствие конкретного текста, а не счётчик роли).
    await expect(page.getByText("Не удалось создать проект")).toHaveCount(0);
  });

  test("длинное имя и разметка: текст без поломки layout", async ({ page }) => {
    const longName = `${"🦄".repeat(30)} Длинное название проекта ${run} с <b>разметкой</b> и эмодзи`;
    await page.goto("/projects");
    await page.getByLabel("Название проекта").fill(longName);
    await page.getByRole("button", { name: "Создать проект" }).click();
    const row = page.locator("li", { hasText: "Длинное название проекта" });
    await expect(row).toBeVisible();
    // markup — экранированный текст.
    await expect(row).toContainText("<b>разметкой</b>");
    const scrollWidth = await page.evaluate(
      () => document.documentElement.scrollWidth,
    );
    expect(scrollWidth).toBeLessThanOrEqual(1280);
  });
});

test.describe("проекты на мобильной ширине (360)", () => {
  test.use({ viewport: { width: 360, height: 740 }, storageState: USER_A_STATE });

  test("create с клавиатуры, tabs и actions доступны, без overflow", async ({
    page,
  }) => {
    await page.goto("/today");
    await page.getByRole("link", { name: "Проекты", exact: true }).click();
    await expect(page).toHaveURL(/\/projects$/);

    const input = page.getByLabel("Название проекта");
    await input.fill(`Мобильный ${run}`);
    await input.press("Enter");
    await expect(page.locator("li", { hasText: `Мобильный ${run}` })).toBeVisible();

    const scrollWidth = await page.evaluate(
      () => document.documentElement.scrollWidth,
    );
    expect(scrollWidth).toBeLessThanOrEqual(360);

    // Tabs переключаются.
    await page.getByRole("button", { name: "Архив", exact: true }).click();
    await expect(page.getByText("В архиве пока нет проектов")).toBeVisible();
    await page.getByRole("button", { name: "Активные", exact: true }).click();
    await expect(page.locator("li", { hasText: `Мобильный ${run}` })).toBeVisible();
  });
});
