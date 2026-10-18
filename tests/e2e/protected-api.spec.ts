import { expect, test } from "@playwright/test";
import { userBEmail, userBPassword } from "./credentials";

test.describe("GET /api/v1/me: actor isolation", () => {
  test("два контекста пользователей получают разные actor id", async ({
    request,
    browser,
  }) => {
    // Пользователь A — из project storageState (залогинен в auth.setup).
    const meA = await request.get("/api/v1/me");
    expect(meA.status()).toBe(200);
    expect(meA.headers()["cache-control"]).toContain("no-store");
    const bodyA = await meA.json();
    expect(typeof bodyA.user.id).toBe("string");

    // Пользователь B — чистый контекст (без project storageState) с реальным
    // входом через форму.
    const contextB = await browser.newContext({
      storageState: { cookies: [], origins: [] },
    });
    const pageB = await contextB.newPage();
    await pageB.goto("/login");
    await pageB.getByLabel("Email").fill(userBEmail);
    await pageB.getByLabel("Пароль").fill(userBPassword);
    await pageB.getByRole("button", { name: "Войти" }).click();
    await expect(pageB).toHaveURL(/\/today$/);

    const meB = await pageB.request.get("/api/v1/me");
    expect(meB.status()).toBe(200);
    const bodyB = await meB.json();
    expect(bodyB.user.id).not.toBe(bodyA.user.id);

    // A не меняется после входа B.
    const meA2 = await request.get("/api/v1/me");
    expect((await meA2.json()).user.id).toBe(bodyA.user.id);

    await contextB.close();
  });

  test("анонимный запрос: 401 UNAUTHENTICATED", async ({ browser }) => {
    const anonymousContext = await browser.newContext({
      storageState: { cookies: [], origins: [] },
    });
    const page = await anonymousContext.newPage();
    const response = await page.request.get("/api/v1/me");
    expect(response.status()).toBe(401);
    expect(await response.json()).toEqual({ error: { code: "UNAUTHENTICATED" } });
    await anonymousContext.close();
  });
});
