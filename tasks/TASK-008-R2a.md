# TASK-008-R2a — один task write в полёте

Актуальный статус: R2a принят на 437e5a2, reports/TASK-008-R2a-fix.md. Ниже сохранено предыдущее задание/review.

Статус review 9932004: NEEDS_FIXES — reports/TASK-008-R2a.md; назначен только узкий остаток tasks/TASK-008-R2a-fix.md.

## Назначение

Только первая часть R2 из `reports/TASK-008.md`: **create и row mutations используют общий write guard**. R1 принят на `3b3688ad66845dc80216105bb20d85375293592e`, review `reports/TASK-008-R1.md`. Старт — текущий coordinator assignment commit; проверить root/HEAD/status. Ветка `task/TASK-008`, worktree `/Users/atlhnv/Codex/orbit-worktrees/TASK-008`.

Дефект: держим POST quick-add → «Завершить» существующей строки enabled → отправляется PATCH. Create guard отдельный, shared writes-hook его не знает. Это нарушает правило одного UI write в полёте.

## Scope

Только `use-task-writes.ts`, `task-items-list.tsx`, `tasks-view.tsx`, `today-board.tsx`, при необходимости минимально `task-row.tsx`; один небольшой browser spec для write guard либо additions inbox/planning specs; executor report. Ориентир — небольшой patch на общую блокировку, без переписывания экранов/контроллеров. Frozen snapshot R1, service/API/schema/auth/read context не менять. Ненужный focusElement dependency/известный warning в изменяемом hook допустимо исправить точечно.

**Не исправлять в этом запуске** выбор единственного активного editor и переключение status/window (это следующая отдельная R2b), R3–R8, timezone gates, rename draft, границы календаря, сортировку и метки timezone.

## Результат

- В Inbox/Today один синхронный guard охватывает create/rename/toggle/schedule/delete; shared row hook знает о pending create. Guard срабатывает до fetch, а не только после React render.
- При любой pending записи create input/submit и конфликтующие row action/form controls disabled; submit/open handler guards запрещают второй запрос даже при программной попытке обойти disabled. Idle editor может сохранять draft; другая pending запись его не стирает. Контролы вновь доступны после HTTP/network отказа или успеха.
- Existing write-response/read-error distinction, retry, focus и actor/unmount/StrictMode guards сохранены. Pending guard удерживается до завершения текущего write flow; confirmed write + failed read не становится false failed write.
- Самостоятельные row writes в Upcoming используют тот же shared guard без нового create UI. Выбор status/window там в этой коррекции не переделывать.

## Регрессии

1. Inbox и Today (два коротких варианта): своя existing task, удержать POST quick-add. Assert row controls disabled; force/programmatic toggle/editor submit не отправляют PATCH/DELETE/второй POST. Отпустить POST с 500 или network abort → guard снят, create draft сохранён, retry работает.
2. Удержать настоящий schedule PATCH существующей задачи. Create input/button disabled; программный submit create не отправляет POST. HTTP refusal снимает общий guard; повторное сохранение успешно. Синхронизировать по фактической доставке route intercept, без sleeps.
3. Existing pending-complete regression и R1 snapshot regressions остаются зелёными.

## Проверки / handoff

Node24; lint/typecheck/unit; штатный production build + targeted new guard tests, existing Inbox pending-complete и planning R1 regressions. Full auth/E2E здесь не требуются: R6 отдельно открыт. Guards runner/CI=1, own unique test DB/free loopback port, cleanup обязателен. Coordinator обнаружил Colima OFF/55432 недоступен; разрешён отдельный временный локальный test PostgreSQL с явным TEST_DATABASE_URL и честным указанием версии (R1 независимо проверен на PG18). Не запускать сторонние сервисы ради тестов и не подменять dev DB.

Обычный scoped commit + секция R2a executor report, полный SHA/files/commands/exits/counts/ограничения; остановиться до review. Не объявлять R2 целиком или TASK-008 DONE. Без main/других worktree/CRM/localhost3000/hooks changes, без merge/push/amend/rebase/reset/stash/деплоя; secrets не коммитить. Остальные коррекции только после отдельного задания.
