import { expect, test, type Page } from "@playwright/test";

// Владелец fixtures — пользователь C: сессию никто не ревокирует; чистые
// mode reads Upcoming/Today/Inbox без активных форм/writes.
const USER_C_STATE = "test-results/.auth/user-c.json";
const run = `t8r3-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

// TASK-008-R3a/R3b browser: устаревший read не меняет tasks/context/
// error/pending нового read — guards после каждого await (fetch, JSON
// parsing), в catch и finally. Синхронизация детерминированная: delivery
// через expect.poll, вход в json() — сигнал jsonEntered ДО нового read,
// завершение старого исхода — settle-счётчик + flush, без sleeps.
test.describe.configure({ mode: "default" });

type StatusGate = {
  status: string;
  gate: Promise<void>;
  heldCount: () => number;
  isArmed: () => boolean;
  markHeld: () => void;
  release: (abort: boolean) => void;
  isAborted: () => boolean;
  resolveAbortedDelivered: () => void;
  abortedDelivered: () => Promise<void>;
};

// One-shot гейт: удерживает только первую доставку своего status
// (поколение 1); последующие reads того же статуса проходят свободно.
function makeStatusGate(status: string): StatusGate {
  let held = 0;
  let armed = true;
  let abortNow = false;
  let releaseFn!: () => void;
  let resolveAbortedDelivered!: () => void;
  const gate = new Promise<void>((resolve) => {
    releaseFn = resolve;
  });
  const abortedDelivered = new Promise<void>((resolve) => {
    resolveAbortedDelivered = resolve;
  });
  return {
    status,
    gate,
    heldCount: () => held,
    isArmed: () => armed,
    markHeld: () => {
      held += 1;
      armed = false;
    },
    release: (abort: boolean) => {
      abortNow = abort;
      armed = false;
      releaseFn();
    },
    isAborted: () => abortNow,
    resolveAbortedDelivered,
    abortedDelivered: () => abortedDelivered,
  };
}

async function installGetHolds(page: Page, gates: StatusGate[]): Promise<void> {
  await page.route("**/api/v1/tasks*", async (route) => {
    const request = route.request();
    const url = request.url();
    if (request.method() !== "GET" || !url.includes("/api/v1/tasks?")) {
      await route.continue();
      return;
    }
    for (const gate of gates) {
      if (gate.isArmed() && url.includes(`status=${gate.status}`)) {
        gate.markHeld();
        await gate.gate;
        if (gate.isAborted()) {
          await route.abort();
          gate.resolveAbortedDelivered();
          return;
        }
        break;
      }
    }
    await route.continue();
  });
}

// Test-only page-side read tracker: settle-счётчики по status (fetch
// resolve/reject), управляемая задержка json() для armed статусов
// (jsonEntered/jsonSettled сигналы). Никаких product endpoints/hooks.
function installReadTracker(page: Page): void {
  void page.addInitScript(() => {
    const w = window as unknown as {
      fetch: typeof fetch;
      __reads?: {
        settle: Record<string, number>;
        jsonEntered: Record<string, number>;
        jsonSettled: Record<string, number>;
        jsonArmed: Record<string, boolean>;
        jsonGates: Record<string, () => void>;
        armJsonHold: (status: string) => void;
        releaseJsonHold: (status: string) => void;
        restore: () => void;
      };
    };
    const bump = (bag: Record<string, number>, key: string): void => {
      bag[key] = (bag[key] ?? 0) + 1;
    };
    const reads = {
      settle: {} as Record<string, number>,
      jsonEntered: {} as Record<string, number>,
      jsonSettled: {} as Record<string, number>,
      jsonArmed: {} as Record<string, boolean>,
      jsonGates: {} as Record<string, () => void>,
      armJsonHold: (status: string) => {
        reads.jsonArmed[status] = true;
      },
      releaseJsonHold: (status: string) => {
        reads.jsonArmed[status] = false;
        reads.jsonGates[status]?.();
      },
      restore: () => {
        w.fetch = original;
      },
    };
    const original = w.fetch;
    w.__reads = reads;
    w.fetch = (async (
      input: RequestInfo | URL,
      init?: RequestInit,
    ): Promise<Response> => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      const status = /status=([a-z]+)/.exec(url)?.[1] ?? "none";
      try {
        const response = await original.call(w, input, init);
        if (response.ok && reads.jsonArmed[status]) {
          const text = await response.clone().text();
          let release!: () => void;
          const gate = new Promise<void>((resolve) => {
            release = resolve;
          });
          reads.jsonGates[status] = release;
          const payload = new Response(text, {
            status: response.status,
            statusText: response.statusText,
            headers: response.headers,
          });
          payload.json = async () => {
            bump(reads.jsonEntered, status);
            await gate;
            bump(reads.jsonSettled, status);
            return JSON.parse(text) as unknown;
          };
          bump(reads.settle, status);
          return payload;
        }
        bump(reads.settle, status);
        return response;
      } catch (error) {
        bump(reads.settle, status);
        throw error;
      }
    }) as typeof fetch;
  });
}

async function readCounter(
  page: Page,
  bag: "settle" | "jsonEntered" | "jsonSettled",
  status: string,
): Promise<number> {
  return page.evaluate(
    ([bagName, key]) => {
      const reads = (
        window as unknown as {
          __reads?: Record<string, Record<string, number>>;
        }
      ).__reads;
      return reads?.[bagName]?.[key] ?? 0;
    },
    [bag, status],
  );
}

async function waitForCounter(
  page: Page,
  bag: "settle" | "jsonEntered" | "jsonSettled",
  status: string,
  min: number,
): Promise<void> {
  await expect
    .poll(() => readCounter(page, bag, status))
    .toBeGreaterThanOrEqual(min);
}

// Один macrotask-flush: после settle-сигнала catch/finally read-колбэка
// обрабатываются в микрозадачах; evaluate-раунд гарантирует их выполнение
// (это синхронизация, не sleep).
async function flush(page: Page): Promise<void> {
  await page.evaluate(
    () => new Promise<void>((resolve) => setTimeout(resolve, 0)),
  );
}

async function releaseGateQuietly(gate: StatusGate): Promise<void> {
  gate.release(false);
  await gate.gate;
}

test.describe("Read lifecycle (R3a/R3b desktop 1280)", () => {
  test.use({ viewport: { width: 1280, height: 800 }, storageState: USER_C_STATE });

  test("R3a Upcoming: старый abort после успешного нового read без ошибки; последний failed read показывает error/retry", async ({
    page,
  }) => {
    const { openTitle, completedTitle, today } = await seedUpcomingFixtures(
      page,
      "abort",
    );
    installReadTracker(page);
    await page.goto(`/upcoming?start=${today}`);
    const openRow = page.locator("li[data-task-id]", { hasText: openTitle });
    const completedRow = page.locator("li[data-task-id]", {
      hasText: completedTitle,
    });
    const listError = page.getByText("Не удалось обновить список задач.");
    const retry = page.getByRole("button", { name: "Повторить" });

    const completedGate = makeStatusGate("completed");
    await installGetHolds(page, [completedGate]);
    let failNextGet = false;
    // Этот handler зарегистрирован ПОСЛЕ гейт-маршрута и выполняется
    // первым; проброс к гейт-маршруту — только через route.fallback()
    // (route.continue() ушёл бы в сеть, минуя удержание).
    await page.route("**/api/v1/tasks*", async (route) => {
      const request = route.request();
      if (
        failNextGet &&
        request.method() === "GET" &&
        request.url().includes("/api/v1/tasks?")
      ) {
        failNextGet = false;
        await route.abort();
        return;
      }
      await route.fallback();
    });

    try {
      // Старый read (completed) удержан.
      await page.getByRole("button", { name: "Завершённые" }).click();
      await expect.poll(() => completedGate.heldCount()).toBe(1);

      // Новый read (all) успешно применён.
      await page.getByRole("button", { name: "Все" }).click();
      await expect(page.getByRole("button", { name: "Все" })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      await expect(openRow).toBeVisible();
      await expect(completedRow).toBeVisible();

      // Старый completed прерван; ждём его фактический исход (settle)
      // до отрицательных проверок.
      completedGate.release(true);
      await completedGate.abortedDelivered();
      await waitForCounter(page, "settle", "completed", 1);
      await flush(page);
      await expect(listError).toHaveCount(0);
      await expect(retry).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Все" })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      await expect(openRow).toBeVisible();
      await expect(completedRow).toBeVisible();

      // Последний failed read показывает error/retry; GET-only retry
      // восстанавливает список.
      failNextGet = true;
      await page.getByRole("button", { name: "Открытые" }).click();
      await expect(listError).toBeVisible();
      await expect(retry).toBeVisible();
      await retry.click();
      await expect(listError).toHaveCount(0);
      await expect(openRow).toBeVisible();
      await expect(completedRow).toHaveCount(0);
    } finally {
      await releaseGateQuietly(completedGate);
    }
  });

  test("R3a Upcoming: abort старого при удержанном новом не снимает pending; release нового применяет success", async ({
    page,
  }) => {
    const { openTitle, completedTitle, today } = await seedUpcomingFixtures(
      page,
      "pending",
    );
    installReadTracker(page);
    await page.goto(`/upcoming?start=${today}`);

    const completedGate = makeStatusGate("completed");
    const allGate = makeStatusGate("all");
    await installGetHolds(page, [completedGate, allGate]);

    const refresh = page.getByRole("button", { name: "Обновить" });
    const refreshing = page.getByRole("button", { name: "Обновление…" });

    try {
      // Старый completed удержан; новый all тоже удержан.
      await page.getByRole("button", { name: "Завершённые" }).click();
      await expect.poll(() => completedGate.heldCount()).toBe(1);
      await page.getByRole("button", { name: "Все" }).click();
      await expect.poll(() => allGate.heldCount()).toBe(1);
      await expect(refreshing).toBeVisible();

      // Старый abort, пока новый удержан: ждём исход старого, pending
      // нового не снят, ошибки нет.
      completedGate.release(true);
      await completedGate.abortedDelivered();
      await waitForCounter(page, "settle", "completed", 1);
      await flush(page);
      await expect(refreshing).toBeVisible();
      await expect(
        page.getByText("Не удалось обновить список задач."),
      ).toHaveCount(0);

      // Release нового: success применён, pending снят.
      allGate.release(false);
      await expect(page.getByRole("button", { name: "Все" })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      await expect(
        page.locator("li[data-task-id]", { hasText: openTitle }),
      ).toBeVisible();
      await expect(
        page.locator("li[data-task-id]", { hasText: completedTitle }),
      ).toBeVisible();
      await expect(refresh).toBeVisible();
      await expect(refreshing).toHaveCount(0);
    } finally {
      await releaseGateQuietly(completedGate);
      await releaseGateQuietly(allGate);
    }
  });

  test("R3a Upcoming: задержанный response.json() старого read не перезаписывает применённый новый", async ({
    page,
  }) => {
    const pageErrors: Error[] = [];
    page.on("pageerror", (error) => pageErrors.push(error));

    const { openTitle, completedTitle, today } = await seedUpcomingFixtures(
      page,
      "json",
    );
    installReadTracker(page);

    await page.goto(`/upcoming?start=${today}`);
    const openRow = page.locator("li[data-task-id]", { hasText: openTitle });
    const completedRow = page.locator("li[data-task-id]", {
      hasText: completedTitle,
    });
    const refresh = page.getByRole("button", { name: "Обновить" });

    try {
      // Взводим задержку JSON следующего completed GET.
      await page.evaluate(() => {
        (
          window as unknown as { __reads?: { armJsonHold: (s: string) => void } }
        ).__reads?.armJsonHold("completed");
      });

      // Старый completed: вход в json() подтверждён сигналом ДО нового read.
      await page.getByRole("button", { name: "Завершённые" }).click();
      await expect
        .poll(() => readCounter(page, "jsonEntered", "completed"))
        .toBeGreaterThanOrEqual(1);

      // Новый all успешно применён.
      await page.getByRole("button", { name: "Все" }).click();
      await expect(page.getByRole("button", { name: "Все" })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      await expect(openRow).toBeVisible();
      await expect(completedRow).toBeVisible();
      await expect(refresh).toBeVisible();

      // Отпускаем старый JSON и ждём его фактической обработки:
      // tasks/context остаются latest, без ошибки и без повторного pending.
      await page.evaluate(() => {
        (
          window as unknown as {
            __reads?: { releaseJsonHold: (s: string) => void };
          }
        ).__reads?.releaseJsonHold("completed");
      });
      await expect
        .poll(() => readCounter(page, "jsonSettled", "completed"))
        .toBeGreaterThanOrEqual(1);
      await flush(page);
      await expect(openRow).toBeVisible();
      await expect(completedRow).toBeVisible();
      await expect(refresh).toBeVisible();
      await expect(page.getByRole("button", { name: "Все" })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      await expect(
        page.getByText("Не удалось обновить список задач."),
      ).toHaveCount(0);
    } finally {
      await page.evaluate(() => {
        (
          window as unknown as { __reads?: { restore: () => void } }
        ).__reads?.restore();
      });
    }
    // Wrapper восстановлен: обычный GET работает.
    await page.getByRole("button", { name: "Открытые" }).click();
    await expect(
      page.getByRole("button", { name: "Открытые" }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(openRow).toBeVisible();
    await expect(completedRow).toHaveCount(0);
    expect(pageErrors).toEqual([]);
  });

  test("R3b Today: старый abort после успешного нового read без ошибки", async ({
    page,
  }) => {
    const { openTitle, completedTitle } = await seedTodayFixtures(page, "abort");
    installReadTracker(page);
    await page.goto("/today");
    const openRow = page.locator("li[data-task-id]", { hasText: openTitle });
    const completedRow = page.locator("li[data-task-id]", {
      hasText: completedTitle,
    });

    const completedGate = makeStatusGate("completed");
    await installGetHolds(page, [completedGate]);

    try {
      // Старый completed удержан; новый open успешно применён.
      await page.getByRole("button", { name: "Завершённые" }).click();
      await expect.poll(() => completedGate.heldCount()).toBe(1);
      await page.getByRole("button", { name: "Открытые" }).click();
      await expect(
        page.getByRole("button", { name: "Открытые" }),
      ).toHaveAttribute("aria-pressed", "true");
      await expect(openRow).toBeVisible();
      await expect(completedRow).toHaveCount(0);

      // Старый abort; ждём исход до отрицательных проверок.
      completedGate.release(true);
      await completedGate.abortedDelivered();
      await waitForCounter(page, "settle", "completed", 1);
      await flush(page);
      await expect(
        page.getByText("Не удалось обновить список задач."),
      ).toHaveCount(0);
      await expect(
        page.getByRole("button", { name: "Открытые" }),
      ).toHaveAttribute("aria-pressed", "true");
      await expect(openRow).toBeVisible();
    } finally {
      await releaseGateQuietly(completedGate);
    }
  });

  test("R3b Today: abort старого при удержанном новом не снимает pending", async ({
    page,
  }) => {
    const { openTitle, completedTitle } = await seedTodayFixtures(
      page,
      "pending",
    );
    installReadTracker(page);
    await page.goto("/today");
    const openRow = page.locator("li[data-task-id]", { hasText: openTitle });
    const completedRow = page.locator("li[data-task-id]", {
      hasText: completedTitle,
    });

    const completedGate = makeStatusGate("completed");
    const openGate = makeStatusGate("open");
    await installGetHolds(page, [completedGate, openGate]);

    const refresh = page.getByRole("button", { name: "Обновить" });
    const refreshing = page.getByRole("button", { name: "Обновление…" });

    try {
      // Оба read удержаны.
      await page.getByRole("button", { name: "Завершённые" }).click();
      await expect.poll(() => completedGate.heldCount()).toBe(1);
      await page.getByRole("button", { name: "Открытые" }).click();
      await expect.poll(() => openGate.heldCount()).toBe(1);
      await expect(refreshing).toBeVisible();

      // Старый abort: pending нового не снят, ошибки нет.
      completedGate.release(true);
      await completedGate.abortedDelivered();
      await waitForCounter(page, "settle", "completed", 1);
      await flush(page);
      await expect(refreshing).toBeVisible();
      await expect(
        page.getByText("Не удалось обновить список задач."),
      ).toHaveCount(0);

      // Release нового: success применён, pending снят.
      openGate.release(false);
      await expect(
        page.getByRole("button", { name: "Открытые" }),
      ).toHaveAttribute("aria-pressed", "true");
      await expect(openRow).toBeVisible();
      await expect(completedRow).toHaveCount(0);
      await expect(refresh).toBeVisible();
      await expect(refreshing).toHaveCount(0);
    } finally {
      await releaseGateQuietly(completedGate);
      await releaseGateQuietly(openGate);
    }
  });

  test("R3b Today: задержанный json() старого read не перезаписывает новый", async ({
    page,
  }) => {
    const pageErrors: Error[] = [];
    page.on("pageerror", (error) => pageErrors.push(error));

    const { openTitle, completedTitle } = await seedTodayFixtures(page, "json");
    installReadTracker(page);

    await page.goto("/today");
    const openRow = page.locator("li[data-task-id]", { hasText: openTitle });
    const completedRow = page.locator("li[data-task-id]", {
      hasText: completedTitle,
    });
    const refresh = page.getByRole("button", { name: "Обновить" });

    try {
      await page.evaluate(() => {
        (
          window as unknown as { __reads?: { armJsonHold: (s: string) => void } }
        ).__reads?.armJsonHold("completed");
      });

      // Старый completed: jsonEntered ДО нового read.
      await page.getByRole("button", { name: "Завершённые" }).click();
      await expect
        .poll(() => readCounter(page, "jsonEntered", "completed"))
        .toBeGreaterThanOrEqual(1);

      // Новый open применён.
      await page.getByRole("button", { name: "Открытые" }).click();
      await expect(
        page.getByRole("button", { name: "Открытые" }),
      ).toHaveAttribute("aria-pressed", "true");
      await expect(openRow).toBeVisible();
      await expect(completedRow).toHaveCount(0);
      await expect(refresh).toBeVisible();

      // Отпускаем старый json, ждём обработки: latest не перезаписан.
      await page.evaluate(() => {
        (
          window as unknown as {
            __reads?: { releaseJsonHold: (s: string) => void };
          }
        ).__reads?.releaseJsonHold("completed");
      });
      await expect
        .poll(() => readCounter(page, "jsonSettled", "completed"))
        .toBeGreaterThanOrEqual(1);
      await flush(page);
      await expect(
        page.getByRole("button", { name: "Открытые" }),
      ).toHaveAttribute("aria-pressed", "true");
      await expect(openRow).toBeVisible();
      await expect(completedRow).toHaveCount(0);
      await expect(refresh).toBeVisible();
      await expect(
        page.getByText("Не удалось обновить список задач."),
      ).toHaveCount(0);
    } finally {
      await page.evaluate(() => {
        (
          window as unknown as { __reads?: { restore: () => void } }
        ).__reads?.restore();
      });
    }
    // Wrapper восстановлен.
    await page.getByRole("button", { name: "Завершённые" }).click();
    await expect(
      page.getByRole("button", { name: "Завершённые" }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(completedRow).toBeVisible();
    await expect(openRow).toHaveCount(0);
    expect(pageErrors).toEqual([]);
  });

  test("R3b Inbox: старый manual refresh удержан; quick-add применяет новый read; старый отказ не создаёт ложных ошибок", async ({
    page,
  }) => {
    const title = `R3b inbox ${run}`;
    installReadTracker(page);
    await page.goto("/inbox");

    const openGate = makeStatusGate("open");
    const completedGate = makeStatusGate("completed");
    await installGetHolds(page, [openGate, completedGate]);

    const refresh = page.getByRole("button", { name: "Обновить" });
    const refreshing = page.getByRole("button", { name: "Обновление…" });

    try {
      // Старый manual refresh: пара GET open/completed удержана.
      await refresh.click();
      await expect.poll(() => openGate.heldCount()).toBe(1);
      await expect.poll(() => completedGate.heldCount()).toBe(1);
      await expect(refreshing).toBeVisible();

      // Реальный quick-add: POST проходит, новый onConfirmed read
      // применяется (гейты уже не armed) — задача видна, черновик очищен.
      await page.getByLabel("Название задачи").fill(title);
      await page.getByRole("button", { name: "Добавить задачу" }).click();
      const row = page.locator("li[data-task-id]", { hasText: title });
      await expect(row).toBeVisible();
      await expect(page.getByLabel("Название задачи")).toHaveValue("");

      // Старая пара завершается отказом ПОСЛЕ успеха нового: без list
      // error и без ложного failed create; pending снимает только новый.
      openGate.release(true);
      completedGate.release(true);
      await openGate.abortedDelivered();
      await completedGate.abortedDelivered();
      await waitForCounter(page, "settle", "open", 1);
      await waitForCounter(page, "settle", "completed", 1);
      await flush(page);
      await expect(
        page.getByText("Не удалось обновить список задач."),
      ).toHaveCount(0);
      await expect(
        page.locator("#task-create-status [role=alert]"),
      ).toHaveCount(0);
      await expect(row).toBeVisible();
      await expect(refresh).toBeVisible();
      await expect(refreshing).toHaveCount(0);
    } finally {
      await releaseGateQuietly(openGate);
      await releaseGateQuietly(completedGate);
    }
  });
});

async function seedUpcomingFixtures(
  page: Page,
  label: string,
): Promise<{ openTitle: string; completedTitle: string; today: string }> {
  const today = await serverToday(page);
  // Уникальные titles на тест: строки накапливаются в аккаунте C.
  const openTitle = `R3a open ${run}-${label}`;
  const completedTitle = `R3a done ${run}-${label}`;
  const plannedDay = shift(today, 2);

  await page.goto("/inbox");
  for (const title of [openTitle, completedTitle]) {
    await page.getByLabel("Название задачи").fill(title);
    await page.getByRole("button", { name: "Добавить задачу" }).click();
    const row = page.locator("li[data-task-id]", { hasText: title });
    await expect(row).toBeVisible();
    await row.getByRole("button", { name: "Планирование" }).click();
    await row.getByLabel("Дата выполнения").fill(plannedDay);
    await row.getByRole("button", { name: "Сохранить" }).click();
    await expect(row).toHaveCount(0);
  }

  // Завершаем вторую задачу реальным toggle в Upcoming.
  await page.goto(`/upcoming?start=${today}`);
  const doneRow = page.locator("li[data-task-id]", { hasText: completedTitle });
  await expect(doneRow).toBeVisible();
  await doneRow.getByRole("button", { name: "Завершить" }).click();
  await expect(doneRow).toHaveCount(0);

  return { openTitle, completedTitle, today };
}

async function seedTodayFixtures(
  page: Page,
  label: string,
): Promise<{ openTitle: string; completedTitle: string }> {
  // Today quick-add ставит plannedDate = server today: обе задачи на доске.
  const openTitle = `R3b open ${run}-${label}`;
  const completedTitle = `R3b done ${run}-${label}`;

  await page.goto("/today");
  await page.getByLabel("Название задачи").fill(openTitle);
  await page.getByRole("button", { name: "Добавить задачу" }).click();
  await expect(
    page.locator("li[data-task-id]", { hasText: openTitle }),
  ).toBeVisible();

  await page.getByLabel("Название задачи").fill(completedTitle);
  await page.getByRole("button", { name: "Добавить задачу" }).click();
  const doneRow = page.locator("li[data-task-id]", { hasText: completedTitle });
  await expect(doneRow).toBeVisible();
  await doneRow.getByRole("button", { name: "Завершить" }).click();
  await expect(doneRow).toHaveCount(0);

  return { openTitle, completedTitle };
}

async function serverToday(page: Page): Promise<string> {
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
