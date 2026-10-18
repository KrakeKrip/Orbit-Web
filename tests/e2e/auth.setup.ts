import { expect, test } from "@playwright/test";
import path from "node:path";
import {
  userAEmail,
  userAPassword,
  userBEmail,
  userBPassword,
  userCEmail,
  userCPassword,
} from "./credentials";

/**
 * Playwright setup: аутентифицируется как синтетические пользователи A и B
 * через реальную форму /login и сохраняет storageState для проектов.
 * Файлы состояния — test-results/.auth/user-{a,b}.json (gitignored).
 * Пользователь C (смена аккаунта в settings.spec) логинится через UI
 * в самом тесте, storageState не нужен.
 */

test("login as user A and persist storage state", async ({ page }) => {
  const storageFile = path.join("test-results", ".auth", "user-a.json");
  await page.goto("/login");
  await expect(
    page.getByRole("heading", { name: "Вход в Orbit" }),
  ).toBeVisible();

  await page.getByLabel("Email").fill(userAEmail);
  await page.getByLabel("Пароль").fill(userAPassword);
  await page.getByRole("button", { name: "Войти" }).click();

  await expect(page).toHaveURL(/\/today$/);
  await expect(
    page.getByRole("heading", { level: 1, name: "Сегодня" }),
  ).toBeVisible();

  await page.context().storageState({ path: storageFile });
});

test("login as user B and persist storage state", async ({ page }) => {
  const storageFile = path.join("test-results", ".auth", "user-b.json");
  await page.goto("/login");
  await page.getByLabel("Email").fill(userBEmail);
  await page.getByLabel("Пароль").fill(userBPassword);
  await page.getByRole("button", { name: "Войти" }).click();

  await expect(page).toHaveURL(/\/today$/);
  await expect(
    page.getByRole("heading", { level: 1, name: "Сегодня" }),
  ).toBeVisible();

  await page.context().storageState({ path: storageFile });
});


test("login as user C and persist storage state", async ({ page }) => {
  const storageFile = path.join("test-results", ".auth", "user-c.json");
  await page.goto("/login");
  await page.getByLabel("Email").fill(userCEmail);
  await page.getByLabel("Пароль").fill(userCPassword);
  await page.getByRole("button", { name: "Войти" }).click();

  await expect(page).toHaveURL(/\/today$/);
  await expect(
    page.getByRole("heading", { level: 1, name: "Сегодня" }),
  ).toBeVisible();

  await page.context().storageState({ path: storageFile });
});