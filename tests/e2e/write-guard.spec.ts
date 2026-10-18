import {
  expect,
  test,
  request as apiRequest,
} from "@playwright/test";
import { e2ePort } from "./credentials";

// Владелец fixtures — пользователь C: сессию никто не ревокирует, задачи C
// не пересекаются с fixtures A (inbox.spec) и planning-задачами C.
const USER_C_STATE = "test-results/.auth/user-c.json";
const run = `t8g-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

// TASK-008-R2a browser: один общий write guard — удержанный POST quick-add
// блокирует row writes (и наоборот), disabled контролы, программные submit
// обходы не отправляют второй запрос, отказ снимает guard, retry работает.
// Синхронизация по фактическим route/response событиям, без sleeps.
test.describe.configure({ mode: "default" });

test.describe("Write guard (R2a, desktop 1280)", () => {
  test.use({ viewport: { width: 1280, height: 800 }, storageState: USER_C_STATE });

  test("Inbox: удержанный POST блокирует row writes и второй create; отказ снимает guard, retry работает", async ({
    page,
  }) => {
    const existingTitle = `Guard A ${run}`;
    const heldTitle = `Guard B ${run}`;

    await page.goto("/inbox");
    // Existing задача в idle (route-ов ещё нет).
    await page.getByLabel("Название задачи").fill(existingTitle);
    await page.getByRole("button", { name: "Добавить задачу" }).click();
    const row = page.locator("li[data-task-id]", { hasText: existingTitle });
    await expect(row).toBeVisible();

    // Наблюдатель row-запросов: считывает и пропускает в сеть.
    let patchCount = 0;
    let deleteCount = 0;
    await page.route("**/api/v1/tasks/*", async (route) => {
      const method = route.request().method();
      if (method === "PATCH") {
        patchCount += 1;
      }
      if (method === "DELETE") {
        deleteCount += 1;
      }
      await route.continue();
    });

    // Удержанный POST коллекции: 500 только после release.
    let postCount = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route("**/api/v1/tasks", async (route) => {
      if (route.request().method() !== "POST") {
        await route.continue();
        return;
      }
      postCount += 1;
      await gate;
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: '{"error":{"code":"INTERNAL"}}',
      });
    });

    await page.getByLabel("Название задачи").fill(heldTitle);
    await page.getByRole("button", { name: "Добавить задачу" }).click();

    // Create в полёте: create-контролы и row controls disabled.
    const createInput = page.getByLabel("Название задачи");
    await expect(page.getByRole("button", { name: "Добавление…" })).toBeDisabled();
    await expect(createInput).toBeDisabled();
    await expect(row.getByRole("button", { name: "Завершить" })).toBeDisabled();
    await expect(row.getByRole("button", { name: "Переименовать" })).toBeDisabled();
    await expect(row.getByRole("button", { name: "Планирование" })).toBeDisabled();
    await expect(row.getByRole("button", { name: "Удалить" })).toBeDisabled();

    // Программные попытки обойти disabled: guard синхронный, запросов нет.
    await row.getByRole("button", { name: "Завершить" }).click({ force: true });
    await row.getByRole("button", { name: "Планирование" }).click({ force: true });
    // Editor не открылся при pending create.
    await expect(row.getByLabel("Дата выполнения")).toHaveCount(0);
    // Программный submit create — второй POST не отправляется.
    await page.evaluate(() => {
      const form = document
        .getElementById("task-title-input")
        ?.closest("form");
      if (form instanceof HTMLFormElement) {
        form.requestSubmit();
      }
    });
    expect(patchCount).toBe(0);
    expect(deleteCount).toBe(0);
    expect(postCount).toBe(1);

    // Отпустить POST с 500: guard снят, create error виден, draft сохранён.
    const failedPost = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response.url().endsWith("/api/v1/tasks") &&
        response.status() === 500,
    );
    release();
    await failedPost;
    await expect(
      page.locator("#task-create-status [role=alert]"),
    ).toBeVisible();
    await expect(createInput).toHaveValue(heldTitle);
    await expect(createInput).toBeEnabled();
    await expect(
      page.getByRole("button", { name: "Добавить задачу" }),
    ).toBeEnabled();
    await expect(row.getByRole("button", { name: "Завершить" })).toBeEnabled();

    // Retry: тот же черновик успешно создаётся.
    await page.unroute("**/api/v1/tasks");
    await page.getByRole("button", { name: "Добавить задачу" }).click();
    await expect(
      page.locator("li[data-task-id]", { hasText: heldTitle }),
    ).toBeVisible();
  });

  test("Inbox: удержанный schedule PATCH блокирует create; отказ снимает guard, повторный save успешен", async ({
    page,
  }) => {
    const title = `Guard C ${run}`;
    const heldCreateTitle = `Guard D ${run}`;

    await page.goto("/inbox");
    await page.getByLabel("Название задачи").fill(title);
    await page.getByRole("button", { name: "Добавить задачу" }).click();
    const row = page.locator("li[data-task-id]", { hasText: title });
    await expect(row).toBeVisible();

    // Валидный create-черновик заранее: программный submit ниже обязан
    // пройти parse и упереться именно в guard, а не в валидацию.
    await page.getByLabel("Название задачи").fill(heldCreateTitle);

    let postCount = 0;
    await page.route("**/api/v1/tasks", async (route) => {
      if (route.request().method() === "POST") {
        postCount += 1;
      }
      await route.continue();
    });

    let patchCount = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route("**/api/v1/tasks/*", async (route) => {
      if (route.request().method() !== "PATCH") {
        await route.continue();
        return;
      }
      patchCount += 1;
      await gate;
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: '{"error":{"code":"INTERNAL"}}',
      });
    });

    // Удержанный schedule PATCH существующей задачи.
    await row.getByRole("button", { name: "Планирование" }).click();
    await row
      .getByLabel("Дата выполнения")
      .fill(shift(await serverToday(page), 2));
    const failedPatch = page.waitForResponse(
      (response) =>
        response.request().method() === "PATCH" &&
        response.url().includes("/api/v1/tasks/") &&
        response.status() === 500,
    );
    await row.getByRole("button", { name: "Сохранить" }).click();

    // Create контролы disabled при чужой записи в полёте.
    const createInput = page.getByLabel("Название задачи");
    await expect(createInput).toBeDisabled();
    await expect(
      page.getByRole("button", { name: "Добавить задачу" }),
    ).toBeDisabled();

    // Программный submit create и force-клик: POST не отправляется.
    await page.evaluate(() => {
      const form = document
        .getElementById("task-title-input")
        ?.closest("form");
      if (form instanceof HTMLFormElement) {
        form.requestSubmit();
      }
    });
    await page
      .getByRole("button", { name: "Добавить задачу" })
      .click({ force: true });
    expect(postCount).toBe(0);
    expect(patchCount).toBe(1);

    // HTTP отказ снимает общий guard: create снова доступен.
    release();
    await failedPatch;
    await expect(createInput).toBeEnabled();
    await expect(
      page.getByRole("button", { name: "Добавить задачу" }),
    ).toBeEnabled();

    // Повторное сохранение расписания успешно (draft редактора сохранён).
    await page.unroute("**/api/v1/tasks/*");
    const savedPatch = page.waitForResponse(
      (response) =>
        response.request().method() === "PATCH" &&
        response.url().includes("/api/v1/tasks/") &&
        response.status() === 200,
    );
    await row.getByRole("button", { name: "Сохранить" }).click();
    await savedPatch;
    // Editor закрыт, задача ушла из Inbox (planned = future).
    await expect(
      page.locator("li[data-task-id]", { hasText: title }),
    ).toHaveCount(0);
    expect(postCount).toBe(0);
  });

  test("Today: удержанный POST блокирует row controls; отказ и retry работают", async ({
    page,
  }) => {
    const existingTitle = `Guard E ${run}`;
    const heldTitle = `Guard F ${run}`;

    await page.goto("/today");
    await page.getByLabel("Название задачи").fill(existingTitle);
    await page.getByRole("button", { name: "Добавить задачу" }).click();
    const row = page.locator("li[data-task-id]", { hasText: existingTitle });
    await expect(row).toBeVisible();

    let patchCount = 0;
    await page.route("**/api/v1/tasks/*", async (route) => {
      if (route.request().method() === "PATCH") {
        patchCount += 1;
      }
      await route.continue();
    });

    let postCount = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route("**/api/v1/tasks", async (route) => {
      if (route.request().method() !== "POST") {
        await route.continue();
        return;
      }
      postCount += 1;
      await gate;
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: '{"error":{"code":"INTERNAL"}}',
      });
    });

    await page.getByLabel("Название задачи").fill(heldTitle);
    await page.getByRole("button", { name: "Добавить задачу" }).click();

    const createInput = page.getByLabel("Название задачи");
    await expect(page.getByRole("button", { name: "Добавление…" })).toBeDisabled();
    await expect(createInput).toBeDisabled();
    await expect(row.getByRole("button", { name: "Завершить" })).toBeDisabled();

    await row.getByRole("button", { name: "Завершить" }).click({ force: true });
    expect(patchCount).toBe(0);
    expect(postCount).toBe(1);

    const failedPost = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response.url().endsWith("/api/v1/tasks") &&
        response.status() === 500,
    );
    release();
    await failedPost;

    // Guard снят: контролы вновь доступны, create-черновик не потерян.
    await expect(createInput).toBeEnabled();
    await expect(createInput).toHaveValue(heldTitle);
    await expect(row.getByRole("button", { name: "Завершить" })).toBeEnabled();

    await page.unroute("**/api/v1/tasks");
    await page.getByRole("button", { name: "Добавить задачу" }).click();
    await expect(
      page.locator("li[data-task-id]", { hasText: heldTitle }),
    ).toBeVisible();
  });

  test("открытый dirty schedule editor при чужом held POST: controls disabled, программные submit/cancel не действуют; отказ снимает блокировку", async ({
    page,
  }) => {
    const title = `Guard G ${run}`;
    const heldTitle = `Guard H ${run}`;
    const plannedDay = shift(await serverToday(page), 3);

    await page.goto("/inbox");
    await page.getByLabel("Название задачи").fill(title);
    await page.getByRole("button", { name: "Добавить задачу" }).click();
    const row = page.locator("li[data-task-id]", { hasText: title });
    await expect(row).toBeVisible();

    // PATCH наблюдатель: считает и пропускает в сеть.
    let patchCount = 0;
    await page.route("**/api/v1/tasks/*", async (route) => {
      if (route.request().method() === "PATCH") {
        patchCount += 1;
      }
      await route.continue();
    });

    // Открыть dirty editor ДО удержания POST.
    await row.getByRole("button", { name: "Планирование" }).click();
    const dateInput = row.getByLabel("Дата выполнения");
    await dateInput.fill(plannedDay);

    // Удержанный POST quick-add; delivery фиксируем expect.poll'ом.
    let postCount = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route("**/api/v1/tasks", async (route) => {
      if (route.request().method() !== "POST") {
        await route.continue();
        return;
      }
      postCount += 1;
      await gate;
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: '{"error":{"code":"INTERNAL"}}',
      });
    });
    await page.getByLabel("Название задачи").fill(heldTitle);
    await page.getByRole("button", { name: "Добавить задачу" }).click();
    await expect.poll(() => postCount).toBe(1);

    // Чужая pending запись: открытый editor заблокирован целиком, create
    // тоже; собственная операция не изображается («Сохранение…» нет).
    await expect(dateInput).toBeDisabled();
    await expect(row.getByRole("button", { name: "Сохранить" })).toBeDisabled();
    await expect(row.getByRole("button", { name: "Отмена" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Добавление…" })).toBeDisabled();
    await expect(row.getByRole("button", { name: "Сохранение…" })).toHaveCount(0);

    // Программный submit мимо disabled: handler guard — PATCH не уходит.
    await page.evaluate(() => {
      const form = document
        .querySelector('[id^="task-schedule-date-input-"]')
        ?.closest("form");
      if (form instanceof HTMLFormElement) {
        form.requestSubmit();
      }
    });
    // Программный cancel мимо disabled: close guard — editor не закрыт.
    await row.getByRole("button", { name: "Отмена" }).dispatchEvent("click");
    await expect(dateInput).toHaveCount(1);
    expect(patchCount).toBe(0);

    // Отказ чужого POST: блокировка снята, editor/draft прежние.
    const failedPost = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response.url().endsWith("/api/v1/tasks") &&
        response.status() === 500,
    );
    release();
    await failedPost;
    await expect(
      page.locator("#task-create-status [role=alert]"),
    ).toBeVisible();
    await expect(dateInput).toBeEnabled();
    await expect(dateInput).toHaveValue(plannedDay);
    await expect(row.getByRole("button", { name: "Сохранить" })).toBeEnabled();
    await expect(row.getByRole("button", { name: "Отмена" })).toBeEnabled();

    // Последующее настоящее сохранение успешно.
    await page.unroute("**/api/v1/tasks");
    const savedPatch = page.waitForResponse(
      (response) =>
        response.request().method() === "PATCH" &&
        response.url().includes("/api/v1/tasks/") &&
        response.status() === 200,
    );
    await row.getByRole("button", { name: "Сохранить" }).click();
    await savedPatch;
    await expect(
      page.locator("li[data-task-id]", { hasText: title }),
    ).toHaveCount(0);
    expect(patchCount).toBe(1);
  });

  test("одна активная форма: dirty schedule P — открытия Q отказаны, после Cancel P можно открыть Q", async ({
    page,
  }) => {
    const pTitle = `Guard L ${run}`;
    const qTitle = `Guard M ${run}`;
    const plannedDay = shift(await serverToday(page), 4);

    await page.goto("/inbox");
    await page.getByLabel("Название задачи").fill(pTitle);
    await page.getByRole("button", { name: "Добавить задачу" }).click();
    const pRow = page.locator("li[data-task-id]", { hasText: pTitle });
    await expect(pRow).toBeVisible();
    await page.getByLabel("Название задачи").fill(qTitle);
    await page.getByRole("button", { name: "Добавить задачу" }).click();
    const qRow = page.locator("li[data-task-id]", { hasText: qTitle });
    await expect(qRow).toBeVisible();
    const qTaskId = await qRow.getAttribute("data-task-id");
    expect(qTaskId).not.toBeNull();

    // Открытая dirty schedule P.
    await pRow.getByRole("button", { name: "Планирование" }).click();
    const pDate = pRow.getByLabel("Дата выполнения");
    await pDate.fill(plannedDay);

    // Form-триггеры строки Q disabled; write-кнопка остаётся (guard R2a).
    await expect(qRow.getByRole("button", { name: "Переименовать" })).toBeDisabled();
    await expect(qRow.getByRole("button", { name: "Планирование" })).toBeDisabled();
    await expect(qRow.getByRole("button", { name: "Удалить" })).toBeDisabled();
    await expect(qRow.getByRole("button", { name: "Завершить" })).toBeEnabled();

    // Программный bypass handlers: другие формы не открываются, draft цел.
    await qRow.getByRole("button", { name: "Переименовать" }).dispatchEvent("click");
    await qRow.getByRole("button", { name: "Планирование" }).dispatchEvent("click");
    await qRow.getByRole("button", { name: "Удалить" }).dispatchEvent("click");
    await expect(qRow.getByLabel("Дата выполнения")).toHaveCount(0);
    await expect(page.locator(`#task-rename-input-${qTaskId}`)).toHaveCount(0);
    await expect(page.getByText("Удалить задачу?")).toHaveCount(0);
    await expect(pDate).toHaveValue(plannedDay);

    // Cancel P освобождает выбор: теперь rename Q открывается, после его
    // Cancel — снова schedule P (переключение только через Cancel/Save).
    await pRow.getByRole("button", { name: "Отмена" }).click();
    await expect(pDate).toHaveCount(0);
    await qRow.getByRole("button", { name: "Переименовать" }).click();
    await expect(page.locator(`#task-rename-input-${qTaskId}`)).toBeVisible();
    await page
      .locator(`li[data-task-id="${qTaskId}"]`)
      .getByRole("button", { name: "Отмена" })
      .click();
    await expect(page.locator(`#task-rename-input-${qTaskId}`)).toHaveCount(0);
    await pRow.getByRole("button", { name: "Планирование" }).click();
    await expect(pRow.getByLabel("Дата выполнения")).toBeVisible();
    await pRow.getByRole("button", { name: "Отмена" }).click();
  });

  test("failed Save P сохраняет форму/draft/error и активный выбор; успешный Save освобождает", async ({
    page,
  }) => {
    const pTitle = `Guard N ${run}`;
    const qTitle = `Guard O ${run}`;
    const plannedDay = shift(await serverToday(page), 5);

    await page.goto("/inbox");
    await page.getByLabel("Название задачи").fill(pTitle);
    await page.getByRole("button", { name: "Добавить задачу" }).click();
    const pRow = page.locator("li[data-task-id]", { hasText: pTitle });
    await expect(pRow).toBeVisible();
    await page.getByLabel("Название задачи").fill(qTitle);
    await page.getByRole("button", { name: "Добавить задачу" }).click();
    const qRow = page.locator("li[data-task-id]", { hasText: qTitle });
    await expect(qRow).toBeVisible();
    const qTaskId = await qRow.getAttribute("data-task-id");
    expect(qTaskId).not.toBeNull();

    let patchCount = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route("**/api/v1/tasks/*", async (route) => {
      if (route.request().method() !== "PATCH") {
        await route.continue();
        return;
      }
      patchCount += 1;
      await gate;
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: '{"error":{"code":"INTERNAL"}}',
      });
    });

    // Dirty schedule P; Save удержан (500).
    await pRow.getByRole("button", { name: "Планирование" }).click();
    const pDate = pRow.getByLabel("Дата выполнения");
    await pDate.fill(plannedDay);
    await pRow.getByRole("button", { name: "Сохранить" }).click();
    await expect.poll(() => patchCount).toBe(1);

    // Активная форма P: открытие rename Q отказано и во время полёта.
    await qRow.getByRole("button", { name: "Переименовать" }).dispatchEvent("click");
    await expect(page.locator(`#task-rename-input-${qTaskId}`)).toHaveCount(0);

    // Отказ Save: P/draft/error сохранены; P остаётся активной формой —
    // rename Q отказано и теперь (триггер disabled и handler guard).
    const failedPatch = page.waitForResponse(
      (response) =>
        response.request().method() === "PATCH" &&
        response.url().includes("/api/v1/tasks/") &&
        response.status() === 500,
    );
    release();
    await failedPatch;
    await expect(pRow.getByRole("alert")).toBeVisible();
    await expect(pDate).toHaveValue(plannedDay);
    await expect(qRow.getByRole("button", { name: "Переименовать" })).toBeDisabled();
    await qRow.getByRole("button", { name: "Переименовать" }).dispatchEvent("click");
    await expect(page.locator(`#task-rename-input-${qTaskId}`)).toHaveCount(0);

    // Успешный Save P освобождает выбор: rename Q открывается обычным кликом.
    await page.unroute("**/api/v1/tasks/*");
    const savedPatch = page.waitForResponse(
      (response) =>
        response.request().method() === "PATCH" &&
        response.url().includes("/api/v1/tasks/") &&
        response.status() === 200,
    );
    await pRow.getByRole("button", { name: "Сохранить" }).click();
    await savedPatch;
    await expect(pRow).toHaveCount(0);
    await expect(qRow.getByRole("button", { name: "Переименовать" })).toBeEnabled();
    await qRow.getByRole("button", { name: "Переименовать" }).click();
    await expect(page.locator(`#task-rename-input-${qTaskId}`)).toBeVisible();
    await page
      .locator(`li[data-task-id="${qTaskId}"]`)
      .getByRole("button", { name: "Отмена" })
      .click();
    await expect(page.locator(`#task-rename-input-${qTaskId}`)).toHaveCount(0);
  });

  test("открытая форма при чужом held POST: rename и delete варианты последовательно — блокировка, guards, отказ снимает", async ({
    page,
  }) => {
    const renameTitle = `Guard I ${run}`;
    const renameDraft = `Guard I переименован ${run}`;
    const deleteTitle = `Guard J ${run}`;
    const heldRenamePost = `Guard K ${run}`;
    const heldDeletePost = `Guard R ${run}`;

    await page.goto("/inbox");
    await page.getByLabel("Название задачи").fill(renameTitle);
    await page.getByRole("button", { name: "Добавить задачу" }).click();
    const renameRow = page.locator("li[data-task-id]", { hasText: renameTitle });
    await expect(renameRow).toBeVisible();
    const renameTaskId = await renameRow.getAttribute("data-task-id");
    expect(renameTaskId).not.toBeNull();
    await page.getByLabel("Название задачи").fill(deleteTitle);
    await page.getByRole("button", { name: "Добавить задачу" }).click();
    const deleteRow = page.locator("li[data-task-id]", { hasText: deleteTitle });
    await expect(deleteRow).toBeVisible();

    // Наблюдатели row-запросов: считают и пропускают.
    let patchCount = 0;
    let deleteCount = 0;
    await page.route("**/api/v1/tasks/*", async (route) => {
      const method = route.request().method();
      if (method === "PATCH") {
        patchCount += 1;
      }
      if (method === "DELETE") {
        deleteCount += 1;
      }
      await route.continue();
    });

    // Удерживающий POST-маршрут; gate перезаряжается для второй фазы.
    let postCount = 0;
    let gate: Promise<void> = new Promise<void>(() => {});
    let release: () => void = () => {};
    const armGate = (): void => {
      gate = new Promise<void>((resolve) => {
        release = resolve;
      });
    };
    await page.route("**/api/v1/tasks", async (route) => {
      if (route.request().method() !== "POST") {
        await route.continue();
        return;
      }
      postCount += 1;
      await gate;
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: '{"error":{"code":"INTERNAL"}}',
      });
    });

    // Фаза rename: открытый rename editor при удержанном POST (R2b1:
    // единственная активная форма — варианты выполняются последовательно).
    // Открытый editor заменяет title-параграф: локаторы по id/data-task-id.
    const renameBox = page.locator(`li[data-task-id="${renameTaskId}"]`);
    await renameBox.getByRole("button", { name: "Переименовать" }).click();
    const renameInput = page.locator(`#task-rename-input-${renameTaskId}`);
    await renameInput.fill(renameDraft);

    armGate();
    await page.getByLabel("Название задачи").fill(heldRenamePost);
    await page.getByRole("button", { name: "Добавить задачу" }).click();
    await expect.poll(() => postCount).toBe(1);

    await expect(renameInput).toBeDisabled();
    await expect(
      renameBox.getByRole("button", { name: "Сохранить" }),
    ).toBeDisabled();
    await expect(
      renameBox.getByRole("button", { name: "Отмена" }),
    ).toBeDisabled();
    await expect(page.getByRole("button", { name: "Добавление…" })).toBeDisabled();
    // Собственная операция не изображается.
    await expect(renameBox.getByRole("button", { name: "Сохранение…" })).toHaveCount(0);

    // Программный bypass: submit/cancel — без запросов, форма не закрыта.
    await page.evaluate((id) => {
      const form = document
        .getElementById(`task-rename-input-${id}`)
        ?.closest("form");
      if (form instanceof HTMLFormElement) {
        form.requestSubmit();
      }
    }, renameTaskId);
    await renameBox.getByRole("button", { name: "Отмена" }).dispatchEvent("click");
    await expect(renameInput).toHaveCount(1);
    expect(patchCount).toBe(0);

    // Отказ чужого POST снимает блокировку; draft прежний.
    const failedPost1 = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response.url().endsWith("/api/v1/tasks") &&
        response.status() === 500,
    );
    release();
    await failedPost1;
    await expect(renameInput).toBeEnabled();
    await expect(renameInput).toHaveValue(renameDraft);
    await expect(
      renameBox.getByRole("button", { name: "Сохранить" }),
    ).toBeEnabled();

    // Обычная отмена закрывает форму и освобождает выбор.
    await renameBox.getByRole("button", { name: "Отмена" }).click();
    await expect(renameInput).toHaveCount(0);

    // Фаза delete: confirmation при удержанном POST.
    await deleteRow.getByRole("button", { name: "Удалить" }).click();
    await expect(page.getByText("Удалить задачу?")).toBeVisible();

    armGate();
    await page.getByLabel("Название задачи").fill(heldDeletePost);
    await page.getByRole("button", { name: "Добавить задачу" }).click();
    await expect.poll(() => postCount).toBe(2);

    await expect(
      deleteRow.getByRole("button", { name: "Удалить", exact: true }),
    ).toBeDisabled();
    await expect(
      deleteRow.locator('[id^="task-delete-cancel-"]'),
    ).toBeDisabled();
    await expect(deleteRow.getByRole("button", { name: "Удаление…" })).toHaveCount(0);

    await deleteRow
      .getByRole("button", { name: "Удалить", exact: true })
      .dispatchEvent("click");
    await expect(page.getByText("Удалить задачу?")).toBeVisible();
    await deleteRow.locator('[id^="task-delete-cancel-"]').dispatchEvent("click");
    await expect(page.getByText("Удалить задачу?")).toBeVisible();
    expect(patchCount).toBe(0);
    expect(deleteCount).toBe(0);

    const failedPost2 = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response.url().endsWith("/api/v1/tasks") &&
        response.status() === 500,
    );
    release();
    await failedPost2;
    await expect(
      deleteRow.getByRole("button", { name: "Удалить", exact: true }),
    ).toBeEnabled();
    await expect(
      deleteRow.locator('[id^="task-delete-cancel-"]'),
    ).toBeEnabled();

    await deleteRow.locator('[id^="task-delete-cancel-"]').click();
    await expect(page.getByText("Удалить задачу?")).toHaveCount(0);
    expect(patchCount).toBe(0);
    expect(deleteCount).toBe(0);
  });

  test("Upcoming: удержанный completion PATCH блокирует status и диапазон; bypass не меняет mode/URL/GET; release возвращает controls", async ({
    page,
  }) => {
    const title = `Guard S ${run}`;
    const today = await serverToday(page);
    const plannedDay = shift(today, 2);

    // Своя scheduled задача в Upcoming-диапазоне.
    await page.goto("/inbox");
    await page.getByLabel("Название задачи").fill(title);
    await page.getByRole("button", { name: "Добавить задачу" }).click();
    const inboxRow = page.locator("li[data-task-id]", { hasText: title });
    await expect(inboxRow).toBeVisible();
    await inboxRow.getByRole("button", { name: "Планирование" }).click();
    await inboxRow.getByLabel("Дата выполнения").fill(plannedDay);
    await inboxRow.getByRole("button", { name: "Сохранить" }).click();
    await expect(inboxRow).toHaveCount(0);

    await page.goto(`/upcoming?start=${today}`);
    const row = page.locator("li[data-task-id]", { hasText: title });
    await expect(row).toBeVisible();
    const urlBefore = page.url();

    // GET-наблюдатель коллекции (считает и пропускает); PATCH удерживается
    // отдельным item-маршрутом ("**/api/v1/tasks*" не матчит "/tasks/<uuid>").
    let getCount = 0;
    await page.route("**/api/v1/tasks*", async (route) => {
      const request = route.request();
      if (
        request.method() === "GET" &&
        request.url().includes("/api/v1/tasks?")
      ) {
        getCount += 1;
      }
      await route.continue();
    });
    let patchCount = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route("**/api/v1/tasks/*", async (route) => {
      if (route.request().method() !== "PATCH") {
        await route.continue();
        return;
      }
      patchCount += 1;
      await gate;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: "{}",
      });
    });

    // Настоящий completion PATCH — удержан (delivery через expect.poll).
    await row.getByRole("button", { name: "Завершить" }).click();
    await expect.poll(() => patchCount).toBe(1);

    // Status и диапазон disabled при pending записи.
    await expect(page.getByRole("button", { name: "Открытые" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Завершённые" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Все" })).toBeDisabled();
    await expect(
      page.getByRole("button", { name: "Следующие 7 дней" }),
    ).toBeDisabled();
    await expect(
      page.getByRole("button", { name: "Предыдущие 7 дней" }),
    ).toBeDisabled();
    await expect(
      page.getByRole("button", { name: "Ближайшие 7 дней" }),
    ).toBeDisabled();

    // Программный bypass: mode/URL не меняются, GET нового mode/range нет.
    await page.getByRole("button", { name: "Все" }).dispatchEvent("click");
    await page
      .getByRole("button", { name: "Следующие 7 дней" })
      .dispatchEvent("click");
    await expect(page.getByRole("button", { name: "Открытые" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(page.url()).toBe(urlBefore);
    expect(getCount).toBe(0);

    // Release: штатный read текущего mode, controls вновь доступны,
    // обычная смена status работает.
    const savedToggle = page.waitForResponse(
      (response) =>
        response.request().method() === "PATCH" &&
        response.url().includes("/api/v1/tasks/") &&
        response.status() === 200,
    );
    release();
    await savedToggle;
    // Штатный read текущего (open) режима прошёл. PATCH fulfill'нут
    // синтетически — сервер его не получал, задача остаётся в open-виде.
    await expect.poll(() => getCount).toBeGreaterThan(0);
    await expect(page.getByRole("button", { name: "Все" })).toBeEnabled();
    await page.getByRole("button", { name: "Все" }).click();
    await expect(page.getByRole("button", { name: "Все" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(row).toHaveCount(1);
    expect(page.url()).toBe(urlBefore);
  });

  test("Upcoming: dirty schedule editor блокирует status/диапазон; failed Save держит lock; Cancel освобождает", async ({
    page,
  }) => {
    const title = `Guard T ${run}`;
    const today = await serverToday(page);
    const plannedDay = shift(today, 2);
    const deadline = shift(today, 5);

    await page.goto("/inbox");
    await page.getByLabel("Название задачи").fill(title);
    await page.getByRole("button", { name: "Добавить задачу" }).click();
    const inboxRow = page.locator("li[data-task-id]", { hasText: title });
    await expect(inboxRow).toBeVisible();
    await inboxRow.getByRole("button", { name: "Планирование" }).click();
    await inboxRow.getByLabel("Дата выполнения").fill(plannedDay);
    await inboxRow.getByRole("button", { name: "Сохранить" }).click();
    await expect(inboxRow).toHaveCount(0);

    await page.goto(`/upcoming?start=${today}`);
    const row = page.locator("li[data-task-id]", { hasText: title });
    await expect(row).toBeVisible();
    const rangeBefore = await page.getByTestId("upcoming-range").textContent();
    const urlBefore = page.url();

    // Открыть dirty schedule editor.
    await row.getByRole("button", { name: "Планирование" }).click();
    const deadlineInput = row.getByLabel("Дедлайн");
    await deadlineInput.fill(deadline);

    // Status и диапазон disabled при открытой форме.
    await expect(page.getByRole("button", { name: "Открытые" })).toBeDisabled();
    await expect(
      page.getByRole("button", { name: "Следующие 7 дней" }),
    ).toBeDisabled();

    // GET-наблюдатель; bypass: форма не закрыта, draft цел, URL/GET не меняются.
    let getCount = 0;
    await page.route("**/api/v1/tasks*", async (route) => {
      const request = route.request();
      if (
        request.method() === "GET" &&
        request.url().includes("/api/v1/tasks?")
      ) {
        getCount += 1;
      }
      await route.continue();
    });
    await page.getByRole("button", { name: "Все" }).dispatchEvent("click");
    await page
      .getByRole("button", { name: "Следующие 7 дней" })
      .dispatchEvent("click");
    await expect(deadlineInput).toHaveValue(deadline);
    expect(page.url()).toBe(urlBefore);
    expect(getCount).toBe(0);

    // Save с 500: editor/error/mode lock сохраняются.
    let patchCount = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route("**/api/v1/tasks/*", async (route) => {
      if (route.request().method() !== "PATCH") {
        await route.continue();
        return;
      }
      patchCount += 1;
      await gate;
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: '{"error":{"code":"INTERNAL"}}',
      });
    });
    await row.getByRole("button", { name: "Сохранить" }).click();
    await expect.poll(() => patchCount).toBe(1);
    const failedPatch = page.waitForResponse(
      (response) =>
        response.request().method() === "PATCH" &&
        response.url().includes("/api/v1/tasks/") &&
        response.status() === 500,
    );
    release();
    await failedPatch;
    await expect(row.getByRole("alert")).toBeVisible();
    await expect(deadlineInput).toHaveValue(deadline);
    // Mode lock держится (форма открыта).
    await expect(page.getByRole("button", { name: "Открытые" })).toBeDisabled();
    await expect(
      page.getByRole("button", { name: "Следующие 7 дней" }),
    ).toBeDisabled();

    // Cancel освобождает выбор и controls; обычная следующая неделя работает.
    await page.unroute("**/api/v1/tasks/*");
    await row.getByRole("button", { name: "Отмена" }).click();
    await expect(deadlineInput).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Открытые" })).toBeEnabled();
    await expect(
      page.getByRole("button", { name: "Следующие 7 дней" }),
    ).toBeEnabled();
    await page.getByRole("button", { name: "Следующие 7 дней" }).click();
    await expect(page.getByTestId("upcoming-range")).not.toHaveText(
      rangeBefore ?? "",
    );
    expect(page.url()).not.toBe(urlBefore);
  });

  test("Inbox: удержанный POST блокирует вкладки; bypass не меняет вкладку; отказ снимает и переключение работает", async ({
    page,
  }) => {
    const existingTitle = `Guard U ${run}`;
    const heldTitle = `Guard V ${run}`;

    await page.goto("/inbox");
    await page.getByLabel("Название задачи").fill(existingTitle);
    await page.getByRole("button", { name: "Добавить задачу" }).click();
    const existingRow = page.locator("li[data-task-id]", {
      hasText: existingTitle,
    });
    await expect(existingRow).toBeVisible();

    const openTab = page.getByRole("button", { name: "Открытые" });
    const completedTab = page.getByRole("button", { name: "Завершённые" });

    // Удержанный POST quick-add (delivery через expect.poll).
    let postCount = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route("**/api/v1/tasks", async (route) => {
      if (route.request().method() !== "POST") {
        await route.continue();
        return;
      }
      postCount += 1;
      await gate;
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: '{"error":{"code":"INTERNAL"}}',
      });
    });
    await page.getByLabel("Название задачи").fill(heldTitle);
    await page.getByRole("button", { name: "Добавить задачу" }).click();
    await expect.poll(() => postCount).toBe(1);

    // Оба tab controls disabled при pending записи.
    await expect(openTab).toBeDisabled();
    await expect(completedTab).toBeDisabled();

    // Программный bypass: вкладка/aria-pressed/видимый список не меняются.
    await completedTab.dispatchEvent("click");
    await expect(openTab).toHaveAttribute("aria-pressed", "true");
    await expect(completedTab).toHaveAttribute("aria-pressed", "false");
    await expect(existingRow).toBeVisible();

    // Release 500: draft сохранён, tabs вновь доступны, переход работает.
    const failedPost = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response.url().endsWith("/api/v1/tasks") &&
        response.status() === 500,
    );
    release();
    await failedPost;
    await expect(
      page.locator("#task-create-status [role=alert]"),
    ).toBeVisible();
    await expect(page.getByLabel("Название задачи")).toHaveValue(heldTitle);
    await expect(openTab).toBeEnabled();
    await expect(completedTab).toBeEnabled();
    await completedTab.click();
    await expect(completedTab).toHaveAttribute("aria-pressed", "true");
    await expect(existingRow).toHaveCount(0);
  });

  test("Inbox: dirty schedule editor блокирует вкладки; failed Save держит lock; Cancel освобождает", async ({
    page,
  }) => {
    const title = `Guard W ${run}`;
    const plannedDay = shift(await serverToday(page), 3);

    await page.goto("/inbox");
    await page.getByLabel("Название задачи").fill(title);
    await page.getByRole("button", { name: "Добавить задачу" }).click();
    const row = page.locator("li[data-task-id]", { hasText: title });
    await expect(row).toBeVisible();

    const openTab = page.getByRole("button", { name: "Открытые" });
    const completedTab = page.getByRole("button", { name: "Завершённые" });

    // Открыть dirty schedule editor.
    await row.getByRole("button", { name: "Планирование" }).click();
    const dateInput = row.getByLabel("Дата выполнения");
    await dateInput.fill(plannedDay);

    // Оба tab controls disabled при открытой форме; bypass не скрывает
    // editor и не меняет вкладку.
    await expect(openTab).toBeDisabled();
    await expect(completedTab).toBeDisabled();
    await completedTab.dispatchEvent("click");
    await expect(openTab).toHaveAttribute("aria-pressed", "true");
    await expect(dateInput).toHaveValue(plannedDay);

    // Save с 500: editor/error/tab lock сохраняются.
    let patchCount = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route("**/api/v1/tasks/*", async (route) => {
      if (route.request().method() !== "PATCH") {
        await route.continue();
        return;
      }
      patchCount += 1;
      await gate;
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: '{"error":{"code":"INTERNAL"}}',
      });
    });
    await row.getByRole("button", { name: "Сохранить" }).click();
    await expect.poll(() => patchCount).toBe(1);
    const failedPatch = page.waitForResponse(
      (response) =>
        response.request().method() === "PATCH" &&
        response.url().includes("/api/v1/tasks/") &&
        response.status() === 500,
    );
    release();
    await failedPatch;
    await expect(row.getByRole("alert")).toBeVisible();
    await expect(dateInput).toHaveValue(plannedDay);
    await expect(openTab).toBeDisabled();

    // Cancel освобождает выбор и вкладки; обычный переход работает.
    await page.unroute("**/api/v1/tasks/*");
    await row.getByRole("button", { name: "Отмена" }).click();
    await expect(dateInput).toHaveCount(0);
    await expect(openTab).toBeEnabled();
    await expect(completedTab).toBeEnabled();
    await completedTab.click();
    await expect(completedTab).toHaveAttribute("aria-pressed", "true");
    await expect(row).toHaveCount(0);
  });

  test("Today: удержанный POST блокирует режимы; bypass не меняет mode; отказ снимает и переключение работает", async ({
    page,
  }) => {
    const existingTitle = `Guard X ${run}`;
    const heldTitle = `Guard Y ${run}`;

    await page.goto("/today");
    await page.getByLabel("Название задачи").fill(existingTitle);
    await page.getByRole("button", { name: "Добавить задачу" }).click();
    const existingRow = page.locator("li[data-task-id]", {
      hasText: existingTitle,
    });
    await expect(existingRow).toBeVisible();

    const openMode = page.getByRole("button", { name: "Открытые" });
    const completedMode = page.getByRole("button", { name: "Завершённые" });

    // Удержанный POST quick-add (delivery через expect.poll).
    let postCount = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route("**/api/v1/tasks", async (route) => {
      if (route.request().method() !== "POST") {
        await route.continue();
        return;
      }
      postCount += 1;
      await gate;
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: '{"error":{"code":"INTERNAL"}}',
      });
    });
    await page.getByLabel("Название задачи").fill(heldTitle);
    await page.getByRole("button", { name: "Добавить задачу" }).click();
    await expect.poll(() => postCount).toBe(1);

    // Оба mode controls disabled при pending записи.
    await expect(openMode).toBeDisabled();
    await expect(completedMode).toBeDisabled();

    // Программный bypass: режим/aria-pressed/видимый список не меняются.
    await completedMode.dispatchEvent("click");
    await expect(openMode).toHaveAttribute("aria-pressed", "true");
    await expect(completedMode).toHaveAttribute("aria-pressed", "false");
    await expect(existingRow).toBeVisible();

    // Release 500: draft сохранён, controls доступны, переход работает.
    const failedPost = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response.url().endsWith("/api/v1/tasks") &&
        response.status() === 500,
    );
    release();
    await failedPost;
    // Today create-статус без id (в отличие от Inbox): текст ошибки.
    await expect(
      page.getByText("Не удалось добавить задачу. Попробуйте ещё раз."),
    ).toBeVisible();
    await expect(page.getByLabel("Название задачи")).toHaveValue(heldTitle);
    await expect(openMode).toBeEnabled();
    await expect(completedMode).toBeEnabled();
    await completedMode.click();
    await expect(completedMode).toHaveAttribute("aria-pressed", "true");
    await expect(existingRow).toHaveCount(0);
  });

  test("Today: dirty schedule editor блокирует режимы; failed Save держит lock; Cancel освобождает", async ({
    page,
  }) => {
    const title = `Guard Z ${run}`;
    const deadline = shift(await serverToday(page), 5);

    await page.goto("/today");
    await page.getByLabel("Название задачи").fill(title);
    await page.getByRole("button", { name: "Добавить задачу" }).click();
    const row = page.locator("li[data-task-id]", { hasText: title });
    await expect(row).toBeVisible();

    const openMode = page.getByRole("button", { name: "Открытые" });
    const completedMode = page.getByRole("button", { name: "Завершённые" });

    // Открыть dirty schedule editor (draft дедлайна).
    await row.getByRole("button", { name: "Планирование" }).click();
    const deadlineInput = row.getByLabel("Дедлайн");
    await deadlineInput.fill(deadline);

    // Оба mode controls disabled при открытой форме; bypass не скрывает
    // editor и не меняет режим.
    await expect(openMode).toBeDisabled();
    await expect(completedMode).toBeDisabled();
    await completedMode.dispatchEvent("click");
    await expect(openMode).toHaveAttribute("aria-pressed", "true");
    await expect(deadlineInput).toHaveValue(deadline);

    // Save с 500: editor/error/mode lock сохраняются.
    let patchCount = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route("**/api/v1/tasks/*", async (route) => {
      if (route.request().method() !== "PATCH") {
        await route.continue();
        return;
      }
      patchCount += 1;
      await gate;
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: '{"error":{"code":"INTERNAL"}}',
      });
    });
    await row.getByRole("button", { name: "Сохранить" }).click();
    await expect.poll(() => patchCount).toBe(1);
    const failedPatch = page.waitForResponse(
      (response) =>
        response.request().method() === "PATCH" &&
        response.url().includes("/api/v1/tasks/") &&
        response.status() === 500,
    );
    release();
    await failedPatch;
    await expect(row.getByRole("alert")).toBeVisible();
    await expect(deadlineInput).toHaveValue(deadline);
    await expect(openMode).toBeDisabled();

    // Cancel освобождает выбор и режимы; обычный переход работает.
    await page.unroute("**/api/v1/tasks/*");
    await row.getByRole("button", { name: "Отмена" }).click();
    await expect(deadlineInput).toHaveCount(0);
    await expect(openMode).toBeEnabled();
    await expect(completedMode).toBeEnabled();
    await completedMode.click();
    await expect(completedMode).toHaveAttribute("aria-pressed", "true");
    await expect(row).toHaveCount(0);
  });

  test("R4: Cancel→reopen показывает актуальный title; failed Save сохраняет draft/error для retry", async ({
    page,
  }) => {
    const titleA = `R4 A ${run}`;
    const draftB = `R4 B ${run}`;

    await page.goto("/inbox");
    await page.getByLabel("Название задачи").fill(titleA);
    await page.getByRole("button", { name: "Добавить задачу" }).click();
    const createdRow = page.locator("li[data-task-id]", { hasText: titleA });
    await expect(createdRow).toBeVisible();
    const taskId = await createdRow.getAttribute("data-task-id");
    expect(taskId).not.toBeNull();
    // Открытый rename editor заменяет title-параграф: локатор по id.
    const row = page.locator(`li[data-task-id="${taskId}"]`);
    const openRename = () => row.getByRole("button", { name: "Переименовать" }).click();
    const renameInput = row.getByLabel("Переименовать");

    // Первое открытие: draft из актуального title, фокус в поле.
    await openRename();
    await expect(renameInput).toHaveValue(titleA);
    await expect(renameInput).toBeFocused();

    // Cancel: отменённый draft не воскресает при повторном открытии.
    await renameInput.fill(draftB);
    await row.getByRole("button", { name: "Отмена" }).click();
    await expect(renameInput).toHaveCount(0);
    await openRename();
    await expect(renameInput).toHaveValue(titleA);
    await expect(renameInput).toBeFocused();

    // Failed Save: draft/error сохраняются; own pending блокирует controls.
    let patchCount = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route("**/api/v1/tasks/*", async (route) => {
      if (route.request().method() !== "PATCH") {
        await route.continue();
        return;
      }
      patchCount += 1;
      await gate;
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: '{"error":{"code":"INTERNAL"}}',
      });
    });
    await renameInput.fill(draftB);
    await row.getByRole("button", { name: "Сохранить" }).click();
    await expect.poll(() => patchCount).toBe(1);
    await expect(renameInput).toBeDisabled();
    // Собственная операция: label «Сохранение…» + disabled.
    await expect(row.getByRole("button", { name: "Сохранение…" })).toBeDisabled();
    await expect(row.getByRole("button", { name: "Отмена" })).toBeDisabled();

    const failedPatch = page.waitForResponse(
      (response) =>
        response.request().method() === "PATCH" &&
        response.url().includes("/api/v1/tasks/") &&
        response.status() === 500,
    );
    release();
    await failedPatch;
    // Error + draft для retry; фокус возвращён в поле.
    await expect(row.getByRole("alert")).toBeVisible();
    await expect(renameInput).toHaveValue(draftB);
    await expect(renameInput).toBeEnabled();
    await expect(renameInput).toBeFocused();

    // Retry через реальный API успешен; подтверждённый title виден.
    await page.unroute("**/api/v1/tasks/*");
    const savedPatch = page.waitForResponse(
      (response) =>
        response.request().method() === "PATCH" &&
        response.url().includes("/api/v1/tasks/") &&
        response.status() === 200,
    );
    await row.getByRole("button", { name: "Сохранить" }).click();
    await savedPatch;
    await expect(renameInput).toHaveCount(0);
    await expect(row).toContainText(draftB);

    // Новое открытие после успешного Save видит подтверждённый title.
    await openRename();
    await expect(renameInput).toHaveValue(draftB);
    await row.getByRole("button", { name: "Отмена" }).click();
  });

  test("R4: внешний rename через API + Refresh — новое открытие показывает server title", async ({
    page,
  }) => {
    const titleA = `R4 C ${run}`;
    const titleC = `R4 D ${run}`;

    await page.goto("/inbox");
    await page.getByLabel("Название задачи").fill(titleA);
    await page.getByRole("button", { name: "Добавить задачу" }).click();
    const createdRow = page.locator("li[data-task-id]", { hasText: titleA });
    await expect(createdRow).toBeVisible();
    const taskId = await createdRow.getAttribute("data-task-id");
    expect(taskId).not.toBeNull();

    // Второй клиент (тот же аккаунт, authenticated API, Origin): реальный
    // PATCH title=C; ответ 200 и persist подтверждены чтением item.
    const origin = `http://127.0.0.1:${e2ePort}`;
    const second = await apiRequest.newContext({
      baseURL: origin,
      storageState: USER_C_STATE,
    });
    try {
      const patch = await second.patch(`/api/v1/tasks/${taskId}`, {
        data: { title: titleC },
        headers: { "content-type": "application/json", origin },
      });
      expect(patch.status()).toBe(200);
      const patched = (await patch.json()) as { task: { title: string } };
      expect(patched.task.title).toBe(titleC);
      const item = await second.get(`/api/v1/tasks/${taskId}`);
      expect(item.status()).toBe(200);
      const payload = (await item.json()) as { task: { title: string } };
      expect(payload.task.title).toBe(titleC);
    } finally {
      await second.dispose();
    }

    // UI Refresh: форма закрыта, новое открытие берёт server title C.
    await page.getByRole("button", { name: "Обновить" }).click();
    const row = page.locator(`li[data-task-id="${taskId}"]`);
    await expect(row).toContainText(titleC);
    await row.getByRole("button", { name: "Переименовать" }).click();
    await expect(row.getByLabel("Переименовать")).toHaveValue(titleC);
    await row.getByRole("button", { name: "Отмена" }).click();
  });
});

async function serverToday(page: import("@playwright/test").Page): Promise<string> {
  const response = await page.request.get("/api/v1/tasks?view=today&status=all");
  const payload = (await response.json()) as {
    context: { today: string };
  };
  return payload.context.today;
}

function shift(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}
