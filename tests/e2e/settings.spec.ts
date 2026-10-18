import { expect, test } from "@playwright/test";
import { userCEmail, userCPassword } from "./credentials";

const htmlClass = (className: "light" | "dark") =>
  new RegExp(`(?:^|\\s)${className}(?:\\s|$)`);

const USER_B_STATE = "test-results/.auth/user-b.json";

// Все тесты файла — один worker, строго по порядку: они мутируют настройки
// пользователя B, а завершающий сценарий выходит из его сессии (изоляция
// mutable settings fixtures: theme.spec параллельно работает с A, поэтому
// A здесь не используется вовсе).
test.describe.configure({ mode: "default" });

test.describe("настройки аккаунта: часовой пояс и тема (desktop 1280)", () => {
  test.use({ viewport: { width: 1280, height: 800 }, storageState: USER_B_STATE });

  test("timezone: невалидное значение отклоняется, валидное сохраняется и переживает refresh", async ({
    page,
  }) => {
    await page.goto("/settings");
    const input = page.getByLabel("Часовой пояс");

    await input.fill("Mars");
    await page.getByRole("button", { name: "Сохранить часовой пояс" }).click();
    await expect(page.getByText("Укажите именованную зону IANA")).toBeVisible();
    await expect(page.getByText("Часовой пояс сохранён")).toHaveCount(0);

    await input.fill("Europe/Moscow");
    await input.press("Enter");
    await expect(page.getByText("Часовой пояс сохранён")).toBeVisible();
    await expect(input).toHaveValue("Europe/Moscow");

    await page.reload();
    await expect(page.getByLabel("Часовой пояс")).toHaveValue("Europe/Moscow");
  });

  test("timezone: во время pending ввод заблокирован, поздний ответ применяется без потерь", async ({
    page,
  }) => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let fulfilled = false;
    await page.route("**/api/v1/settings", async (route) => {
      await gate;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: '{"settings":{"timezone":"Asia/Tokyo","theme":"dark"}}',
      });
      fulfilled = true;
    });

    await page.goto("/settings");
    const input = page.getByLabel("Часовой пояс");
    await input.fill("Asia/Tokyo");
    await input.press("Enter");
    // R2: на время сохранения поле недоступно — ответ применяется ровно к
    // отправленному значению, новый ввод невозможен и не может быть потерян.
    await expect(input).toBeDisabled();
    await expect(
      page.getByRole("button", { name: /Сохранение(…)?|Сохранить часовой пояс/ }),
    ).toBeDisabled();

    release();
    await expect.poll(() => fulfilled).toBe(true);
    await expect(input).toBeEnabled();
    await expect(input).toHaveValue("Asia/Tokyo");
    await expect(page.getByText("Часовой пояс сохранён")).toBeVisible();

    // Обычное сохранение после завершения pending работает (Enter/retry).
    await page.unroute("**/api/v1/settings");
    await input.fill("Europe/Moscow");
    await input.press("Enter");
    await expect(page.getByText("Часовой пояс сохранён")).toBeVisible();
    await expect(input).toHaveValue("Europe/Moscow");
  });

  test("тема сохраняется в аккаунте и применяется без localStorage", async ({
    page,
  }) => {
    await page.goto("/settings");
    await page.getByRole("combobox", { name: "Тема" }).click();
    await page.getByRole("option", { name: "Тёмная" }).click();
    await expect(page.locator("html")).toHaveClass(htmlClass("dark"));
    await expect(page.getByText("Тема сохранена")).toBeVisible();

    // DB settings — источник истины: после очистки локального cache сервер
    // возвращает тему аккаунта при refresh, локальный cache восстанавливается.
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await expect(page.locator("html")).toHaveClass(htmlClass("dark"));
    await expect(page.locator("#theme-select")).toContainText("Тёмная");
    expect(await page.evaluate(() => localStorage.getItem("orbit-theme"))).toBe(
      "dark",
    );
  });

  test("ошибка сервера: rollback текущего actor; уход со Settings при pending не репейнтит тему", async ({
    page,
  }) => {
    await page.route("**/api/v1/settings", (route) =>
      route.fulfill({
        status: 500,
        contentType: "application/json",
        body: '{"error":{"code":"INTERNAL"}}',
      }),
    );

    await page.goto("/settings");
    await page.getByRole("combobox", { name: "Тема" }).click();
    await page.getByRole("option", { name: "Светлая" }).click();
    // Optimistic preview не считается сохранением: после отказа сервера
    // тема возвращается к последней подтверждённой (тёмная).
    await expect(page.getByRole("alert").first()).toBeVisible();
    await expect(page.locator("html")).toHaveClass(htmlClass("dark"));
    await expect(page.locator("#theme-select")).toContainText("Тёмная");
    await expect(page.getByText("Тема сохранена")).toHaveCount(0);

    await page.getByLabel("Часовой пояс").fill("Asia/Tokyo");
    await page.getByRole("button", { name: "Сохранить часовой пояс" }).click();
    await expect(
      page.getByText("Не удалось сохранить часовой пояс"),
    ).toBeVisible();
    // Draft остаётся для retry, «Сохранено» не показывается.
    await expect(page.getByLabel("Часовой пояс")).toHaveValue("Asia/Tokyo");
    await expect(page.getByText("Часовой пояс сохранён")).toHaveCount(0);

    // После устранения сбоя retry успешно сохраняет draft.
    await page.unroute("**/api/v1/settings");
    await page.getByRole("button", { name: "Сохранить часовой пояс" }).click();
    await expect(page.getByText("Часовой пояс сохранён")).toBeVisible();
    await expect(page.getByLabel("Часовой пояс")).toHaveValue("Asia/Tokyo");

    // R1: уход со Settings при pending — ответ после unmount не действует,
    // включая rollback через глобальный setTheme.
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let fulfilled = false;
    await page.route("**/api/v1/settings", async (route) => {
      await gate;
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: '{"error":{"code":"INTERNAL"}}',
      });
      fulfilled = true;
    });
    await page.getByRole("combobox", { name: "Тема" }).click();
    await page.getByRole("option", { name: "Светлая" }).click();
    await expect(page.locator("html")).toHaveClass(htmlClass("light"));

    await page.getByRole("link", { name: "Сегодня", exact: true }).click();
    await expect(page).toHaveURL(/\/today$/);
    release();
    await expect.poll(() => fulfilled).toBe(true);
    // Поздний отказ обрабатывается после ухода с экрана: репейнт темы
    // старым обработчиком отсутствует.
    await page.waitForTimeout(400);
    await expect(page.locator("html")).toHaveClass(htmlClass("light"));

    // Серверная тема аккаунта (тёмная) применяется при следующей загрузке.
    await page.reload();
    await expect(page.locator("html")).toHaveClass(htmlClass("dark"));
    expect(await page.evaluate(() => localStorage.getItem("orbit-theme"))).toBe(
      "dark",
    );
    await page.unroute("**/api/v1/settings");
  });
});

test.describe("настройки на мобильной ширине (360)", () => {
  test.use({ viewport: { width: 360, height: 740 }, storageState: USER_B_STATE });

  test("timezone доступен с клавиатуры, сохранение переживает reload", async ({
    page,
  }) => {
    await page.goto("/today");
    await page.getByRole("link", { name: "Настройки", exact: true }).click();
    await expect(page).toHaveURL(/\/settings$/);

    const input = page.getByLabel("Часовой пояс");
    await input.fill("Asia/Tokyo");
    await input.press("Enter");
    await expect(page.getByText("Часовой пояс сохранён")).toBeVisible();

    await page.reload();
    await expect(page.getByLabel("Часовой пояс")).toHaveValue("Asia/Tokyo");
  });
});

test.describe("смена аккаунта в том же browser storage", () => {
  test.use({ viewport: { width: 1280, height: 800 }, storageState: USER_B_STATE });

  test("настройки нового аккаунта не наследуют cache прежнего; поздний отказ PATCH прежнего не перекрашивает нового", async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: "light" });

    // R1: удержанный PATCH B (светлая) получает 500 уже после смены аккаунта.
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let fulfilled = false;
    await page.route("**/api/v1/settings", async (route) => {
      await gate;
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: '{"error":{"code":"INTERNAL"}}',
      });
      fulfilled = true;
    });

    await page.goto("/settings");
    // Предусловие: серверная тема B — тёмная (подтверждена ранее в файле).
    await expect(page.locator("html")).toHaveClass(htmlClass("dark"));

    await page.getByRole("combobox", { name: "Тема" }).click();
    await page.getByRole("option", { name: "Светлая" }).click();
    await expect(page.locator("html")).toHaveClass(htmlClass("light"));

    await page.getByRole("button", { name: "Выйти" }).click();
    await expect(page).toHaveURL(/\/login$/);

    // Новый аккаунт в том же browser storage: применяется серверная тема C
    // (default system), а не cache/optimistic прежнего пользователя.
    await page.getByLabel("Email").fill(userCEmail);
    await page.getByLabel("Пароль").fill(userCPassword);
    await page.getByRole("button", { name: "Войти" }).click();
    await expect(page).toHaveURL(/\/today$/);
    await expect(page.locator("html")).toHaveClass(htmlClass("light"));
    await page.goto("/settings");
    await expect(page.locator("#theme-select")).toContainText("Системная");
    await expect(page.getByLabel("Часовой пояс")).toHaveValue("UTC");

    // Поздний отказ PATCH B: rollback старого обработчика (тёмная, last
    // confirmed B) не должен действовать — ни на html, ни на cache C.
    release();
    await expect.poll(() => fulfilled).toBe(true);
    await page.waitForTimeout(400);
    await expect(page.locator("html")).toHaveClass(htmlClass("light"));
    expect(await page.evaluate(() => localStorage.getItem("orbit-theme"))).not.toBe(
      "dark",
    );
    await expect(page.getByText("Тема сохранена")).toHaveCount(0);
    await expect(page.locator("#theme-select")).toContainText("Системная");

    // Повторный вход C в том же контексте: настройки C воспроизводятся с
    // сервера, а не из cache.
    await page.reload();
    await expect(page.locator("html")).toHaveClass(htmlClass("light"));
    await expect(page.locator("#theme-select")).toContainText("Системная");
    await expect(page.getByLabel("Часовой пояс")).toHaveValue("UTC");
    await page.unroute("**/api/v1/settings");
  });
});
