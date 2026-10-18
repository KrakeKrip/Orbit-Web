import { expect, test } from "@playwright/test";
import { userAEmail, userAPassword } from "./credentials";

function wrongPassword(): string {
  return `wrong-${Math.random().toString(36).slice(2)}`;
}

test.describe("анонимный доступ и вход (desktop 1280)", () => {
  test.use({
    viewport: { width: 1280, height: 800 },
    storageState: { cookies: [], origins: [] },
  });

  test("workspace маршруты закрыты анонимно: /today → /login", async ({
    page,
  }) => {
    await page.goto("/today");
    await expect(page).toHaveURL(/\/login$/);
    await expect(
      page.getByRole("heading", { name: "Вход в Orbit" }),
    ).toBeVisible();
  });

  test("корень / анонимно ведёт на /login", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/login$/);
  });

  test("неверный пароль: generic ошибка, workspace не открывается", async ({
    page,
  }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill(userAEmail);
    await page.getByLabel("Пароль").fill(wrongPassword());
    await page.getByRole("button", { name: "Войти" }).click();
    await expect(page.getByText("Неверный email или пароль.")).toBeVisible();
    await expect(page).toHaveURL(/\/login$/);
  });

  test("валидный вход → /today → refresh → logout → анонимный доступ закрыт", async ({
    page,
  }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill(userAEmail);
    await page.getByLabel("Пароль").fill(userAPassword);
    await page.getByRole("button", { name: "Войти" }).click();
    await expect(page).toHaveURL(/\/today$/);
    await expect(
      page.getByRole("heading", { level: 1, name: "Сегодня" }),
    ).toBeVisible();

    await page.reload();
    await expect(page).toHaveURL(/\/today$/);

    await page
      .getByRole("link", { name: "Настройки", exact: true })
      .click();
    await expect(page).toHaveURL(/\/settings$/);
    await page.getByRole("button", { name: "Выйти" }).click();
    await expect(page).toHaveURL(/\/login$/);

    await page.goto("/today");
    await expect(page).toHaveURL(/\/login$/);
  });

  test("авторизованный /login перенаправляет на /today", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill(userAEmail);
    await page.getByLabel("Пароль").fill(userAPassword);
    await page.getByRole("button", { name: "Войти" }).click();
    await expect(page).toHaveURL(/\/today$/);

    await page.goto("/login");
    await expect(page).toHaveURL(/\/today$/);
  });
});

test.describe("вход на мобильной ширине (360)", () => {
  test.use({
    viewport: { width: 360, height: 740 },
    storageState: { cookies: [], origins: [] },
  });

  test("полный цикл: guard → ошибка входа → вход → today → logout через header", async ({
    page,
  }) => {
    await page.goto("/today");
    await expect(page).toHaveURL(/\/login$/);

    await page.getByLabel("Email").fill(userAEmail);
    await page.getByLabel("Пароль").fill(wrongPassword());
    await page.getByRole("button", { name: "Войти" }).click();
    await expect(page.getByText("Неверный email или пароль.")).toBeVisible();

    await page.getByLabel("Пароль").fill(userAPassword);
    await page.getByRole("button", { name: "Войти" }).click();
    await expect(page).toHaveURL(/\/today$/);
    await expect(
      page.getByRole("heading", { level: 1, name: "Сегодня" }),
    ).toBeVisible();

    await page.getByRole("link", { name: "Настройки", exact: true }).click();
    await expect(page).toHaveURL(/\/settings$/);
    await page.getByRole("button", { name: "Выйти" }).click();
    await expect(page).toHaveURL(/\/login$/);

    await page.goto("/inbox");
    await expect(page).toHaveURL(/\/login$/);
  });
});
