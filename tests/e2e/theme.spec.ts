import { expect, test } from "@playwright/test";

const htmlClass = (className: "light" | "dark") =>
  new RegExp(`(?:^|\\s)${className}(?:\\s|$)`);

// Тема теперь сохраняется в аккаунте пользователя A: тесты файла мутируют
// серверное состояние одного owner и обязаны выполняться последовательно
// в одном worker (изоляция mutable settings fixtures, TASK-005).
test.describe.configure({ mode: "default" });

test.describe("тема оформления, 1280px", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("выбор светлой темы сохраняется после refresh", async ({ page }) => {
    await page.goto("/settings");
    await page.getByRole("combobox", { name: "Тема" }).click();
    await page.getByRole("option", { name: "Светлая" }).click();

    await expect(page.locator("html")).toHaveClass(htmlClass("light"));
    await expect(page.locator("#theme-select")).toContainText("Светлая");
    // Тема сохраняется в аккаунте: ждём подтверждение server save до reload,
    // иначе reload может отрендерить прежнее серверное значение.
    await expect(page.getByText("Тема сохранена")).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem("orbit-theme"))).toBe(
      "light",
    );

    await page.reload();
    await expect(page.locator("html")).toHaveClass(htmlClass("light"));
    await expect(page.locator("#theme-select")).toContainText("Светлая");
  });

  test("тёмная тема применяется, переживает навигацию и refresh", async ({
    page,
  }) => {
    await page.goto("/settings");
    await page.getByRole("combobox", { name: "Тема" }).click();
    await page.getByRole("option", { name: "Тёмная" }).click();
    await expect(page.locator("html")).toHaveClass(htmlClass("dark"));
    await expect(page.getByText("Тема сохранена")).toBeVisible();

    await page.getByRole("link", { name: "Входящие", exact: true }).click();
    await expect(page).toHaveURL(/\/inbox$/);
    await expect(page.locator("html")).toHaveClass(htmlClass("dark"));

    await page.reload();
    await expect(page.locator("html")).toHaveClass(htmlClass("dark"));
    expect(await page.evaluate(() => localStorage.getItem("orbit-theme"))).toBe(
      "dark",
    );
  });

  test("выбор темы с клавиатуры, Escape закрывает и возвращает фокус", async ({
    page,
  }) => {
    await page.goto("/settings");
    const trigger = page.locator("#theme-select");
    // Детерминированное предусловие: тема аккаунта — результат предыдущих
    // тестов файла, поэтому сценарий сначала мышью возвращает «Системную»
    // (это также гарантирует завершение гидрации до клавиатурной части),
    // затем выполняется исходная клавиатурная последовательность.
    await trigger.click();
    await page.getByRole("option", { name: "Системная" }).click();
    await expect(page.locator("html")).not.toHaveClass(htmlClass("dark"));

    await trigger.focus();
    await page.keyboard.press("Enter");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");

    await expect(page.locator("html")).toHaveClass(htmlClass("light"));
    await expect(trigger).toBeFocused();

    await page.keyboard.press("Enter");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("option", { name: "Тёмная" })).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test("системная тема следует за prefers-color-scheme", async ({ page }) => {
    // Предыдущие тесты этого файла сохранили пользователю A конкретную тему:
    // сценарий system явно возвращает account theme к «Системная» (это
    // действие сценария, не глобальный сброс fixtures).
    await page.goto("/settings");
    await page.getByRole("combobox", { name: "Тема" }).click();
    await page.getByRole("option", { name: "Системная" }).click();
    await expect(page.locator("html")).not.toHaveClass(htmlClass("dark"));

    await page.emulateMedia({ colorScheme: "dark" });
    await page.goto("/today");
    await expect(page.locator("html")).toHaveClass(htmlClass("dark"));

    await page.emulateMedia({ colorScheme: "light" });
    await expect(page.locator("html")).toHaveClass(htmlClass("light"));
  });

  test("консоль браузера без ошибок на всех маршрутах", async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") {
        errors.push(message.text());
      }
    });
    page.on("pageerror", (error) => {
      errors.push(String(error));
    });

    for (const path of ["/today", "/inbox", "/upcoming", "/projects", "/settings"]) {
      await page.goto(path);
      await expect(
        page.getByRole("heading", { level: 1 }),
      ).toBeVisible();
    }

    expect(errors).toEqual([]);
  });
});

test.describe("тема на мобильной ширине, 360px", () => {
  test.use({ viewport: { width: 360, height: 740 } });

  test("настройки доступны из header, выбор сохраняется", async ({ page }) => {
    await page.goto("/today");
    await page.getByRole("link", { name: "Настройки", exact: true }).click();
    await expect(page).toHaveURL(/\/settings$/);

    await page.getByRole("combobox", { name: "Тема" }).click();
    await page.getByRole("option", { name: "Тёмная" }).click();
    await expect(page.locator("html")).toHaveClass(htmlClass("dark"));
    await expect(page.getByText("Тема сохранена")).toBeVisible();

    await page.reload();
    await expect(page.locator("html")).toHaveClass(htmlClass("dark"));
    await expect(page.locator("#theme-select")).toContainText("Тёмная");
  });
});

// Клавиатурный выбор темы на мобильных ширинах: выполняется здесь, а не в
// navigation.spec, потому что выбор теперь сохраняется в аккаунте и все
// мутации темы одного владельца обязаны идти последовательно (TASK-005).
for (const width of [360, 390]) {
  test.describe(`выбор темы с клавиатуры, ${width}px`, () => {
    test.use({ viewport: { width, height: 740 } });

    test("выбор темы с клавиатуры работает при мобильной ширине", async ({
      page,
    }) => {
      await page.goto("/settings");
      const trigger = page.locator("#theme-select");
      // Детерминированное предусловие: текущая тема аккаунта — результат
      // предыдущих тестов файла, поэтому сценарий сначала возвращает
      // «Системную», затем выполняет исходную клавиатурную последовательность.
      await trigger.click();
      await page.getByRole("option", { name: "Системная" }).click();
      await expect(page.locator("html")).not.toHaveClass(htmlClass("dark"));

      await trigger.focus();
      await page.keyboard.press("Enter");
      await page.keyboard.press("ArrowDown");
      await page.keyboard.press("Enter");
      await expect(page.locator("html")).toHaveClass(/light/);
      await expect(trigger).toBeFocused();
    });
  });
}
