# TASK-008-R7 — единый порядок Today в raw API

**ACCEPTED**, 2026-10-12: 3b1bd4035ad7bd98048bd2a75d84143d3e4aa23c, reports/TASK-008-R7.md. Следующее задание tasks/TASK-008-R8.md.

## Одна цель и старт

Закрыть R7 из reports/TASK-008.md: GET /api/v1/tasks?view=today возвращает задачи в том же порядке, что Today UI. R1–R6 приняты, последний executor HEAD ed07ce2fc1c42a276ec993734536ba4ab4542b35, review reports/TASK-008-R6.md. Начать с нового coordinator assignment HEAD, записать полный SHA и проверить root/branch/status. Ветка task/TASK-008, worktree /Users/atlhnv/Codex/orbit-worktrees/TASK-008.

## Малый scope

src/server/tasks/service.ts (только read ordering), при необходимости минимальный shared ordering helper в src/lib/task-view.ts, tests/auth/tasks-planning.auth.test.ts и executor report. При правке pure helper разрешены targeted assertions tests/calendar-view.test.ts. Не менять DTO/API shape, UI/controllers, schema, writes/transactions/locks/completion, timezone persistence/context. R8 и debug/EOF cleanup не входят.

Существующий контракт tasks/TASK-008.md:
- rank1 plannedDate<today; внутри plannedDate ASC, plannedTime ASC NULLS LAST, затем sort_order/created_at/id ASC;
- rank2 plannedDate=today; внутри plannedTime ASC NULLS LAST, затем stable triple;
- rank3 ещё не включённые deadlineDate<today; внутри deadlineDate ASC, затем stable triple;
- rank4 ещё не включённые deadlineDate=today; внутри stable triple.
Каждая задача ровно один раз: overdue/today plan приоритетнее deadline. Today union/status/owner/active-project/root/one-off/deleted filters сохраняются; Inbox и Upcoming ordering не меняются.

Минимально переиспользовать существующий общий контракт группировки/сортировки service/UI; не вводить второй расходящийся comparator или большую SQL/controller переработку. При stable tie сохранить порядок sort_order/created_at/id (DTO не расширять техническими полями ради сортировки). Не мутировать сохранённые task values. Разрешено небольшое согласование типов shared helper, без переписывания экранов.

## Детерминированная регрессия raw API

Свои синтетические fixtures, даты от server context.today, intentionally перемешанный порядок создания/базовый sort_order. Проверить реальный response.tasks order по id, а не только результат client helper:
- все четыре ranks, включая task с plan+deadline, без дублей;
- rank1 более ранняя дата прежде поздней, time 09:00 прежде 10:00 и NULL last при одной дате;
- rank2 time NULL last; rank3 deadline date раньше; rank4 stable triple;
- stable tie sort_order, затем created_at, затем id — контролируемые значения только в собственных fixture rows, без зависимости от скорости часов/случайного порядка UUID;
- open/completed/all используют тот же порядок (можно общим таблица-тестом), чужие/deleted/archived/child/recurrence rows не проникают; существующие фильтр-тесты не ослаблять.
Пригоден один компактный набор fixtures; не раздувать suite множеством повторяющихся tests. Не сравнивать весь response с глобально чистой БД: скоупить assertions на свои fixture IDs либо отдельного синтетического actor.

## Целевые проверки

Node24 перед gates; runtime /private/tmp/orbit-r4-review-runtime/node-v24.21.0-darwin-arm64/bin, если исчез — отдельный официальный Node24, системный Node не менять.

npm run lint (0 warnings), npm run typecheck; npm test -- tests/calendar-view.test.ts; npm run test:auth -- tests/auth/tasks-planning.auth.test.ts на свежем production build (весь planning integration file, включая merge/context/filters). Full auth/DB/E2E пока не нужны. UI не меняется: browser прогон не требуется без нового основания.

Только own guarded per-run DB через существующий runner. PG17 если доступен; иначе разрешён отдельный временный PG18 loopback с честной версией, эфемерным паролем, stop/cleanup своего кластера. Colima/CRM не запускать. Credentials/URI не печатать. Проверить leftovers/соединения; tests запускать последовательно.

## Завершение

Подробный отчёт только reports/TASK-008-executor.md, секция R7: точные commands/exits/counts, raw API order evidence, cleanup/ограничения. В чат 4–5 коротких строк: статус, полный SHA, итог, checks, путь отчёта. Scoped обычный новый commit, остановиться до review. R8/TASK-009 не начинать, TASK-008 DONE не объявлять. Без merge/push/amend/rebase/reset/stash/deploy; main/CRM/localhost3000/hooks не менять; secrets не коммитить.
