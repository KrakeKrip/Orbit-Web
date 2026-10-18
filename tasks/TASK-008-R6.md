# TASK-008-R6 — достоверные timezone-тесты

**ACCEPTED**, 2026-10-12: ed07ce2fc1c42a276ec993734536ba4ab4542b35, reports/TASK-008-R6.md. Следующее задание tasks/TASK-008-R7.md.

## Одна цель и старт

Исправить R6 из reports/TASK-008.md: timezone checks не зависят от времени суток и доказывают настоящую смену account timezone. R1–R5 приняты, R5 HEAD a4e8a84f413c56c2a277690e8419671f8ef783f2, review reports/TASK-008-R5.md. Начать с нового coordinator assignment HEAD; записать полный стартовый SHA, проверить root/branch/status. Ветка task/TASK-008, worktree /Users/atlhnv/Codex/orbit-worktrees/TASK-008.

## Test-only scope

Только tests/auth/tasks-planning.auth.test.ts, tests/e2e/planning.spec.ts, tests/calendar-view.test.ts и секция R6 в reports/TASK-008-executor.md. Не менять src, API/schema/settings persistence, limiter/runner/pool/controller и принятые R1–R5. R7/R8, debug/EOF cleanup и новые фичи не входят.

1. Auth timezone test: удалить предположение, что UTC today и Moscow today обязательно различны. Каждое context.today сравнить с local date собственного response.asOf в собственной response.timezone. Смена настроек через правильный Origin, точный status 200 и GET подтверждение новой зоны. Захватить прежнюю зону и восстановить в finally с точным 200 и GET проверкой. Не привязывать проверку неизменности задачи к попаданию в Today: отдельный GET item до/после, сохранить plannedDate/plannedTime/deadlineDate неизменными. Проверки контекста/ownership не ослаблять.
2. Browser timezone test: явно задать timezoneId UTC только нужному test/describe, проверить фактическую Intl browser zone. Установить account Asia/Tokyo через валидный Origin, assert200, GET settings/context подтверждают новую зону. Сегодня показывает account timezone и корректную дату из собственного серверного asOf. Чтобы не ловить гонку полуночи, установить waitForResponse до реального Refresh и проверять UI по этому же response context, а не по отдельному прежнему GET. Прежнюю зону восстановить в finally: assert200 и GET подтверждение. 403 не успех. Не менять системные часы, production clock API или fixtures endpoints.
3. Pure fixed-instant cases: одинаковый день UTC/Moscow для 2026-01-15T12:00:00Z; разные дни для 2026-01-15T22:30:00Z (UTC 2026-01-15, Moscow/Tokyo 2026-01-16). Явные ожидаемые literals; существующие calendar assertions сохранить.

## Целевые gates

Проверить Node24 перед командами. Временный runtime: /private/tmp/orbit-r4-review-runtime/node-v24.21.0-darwin-arm64/bin (если исчез — отдельный официальный Node24, не менять системный Node).

- npm run lint: 0 warnings; npm run typecheck.
- npm test -- tests/calendar-view.test.ts.
- npm run test:auth -- tests/auth/tasks-planning.auth.test.ts -t 'timezone' (проверить, что нужный тест реально выбран).
- CI=1 E2E_PORT=<свободный порт> npm run test:e2e -- tests/e2e/planning.spec.ts --project=chromium --grep 'timezone|R6:' на свежем production build.

Auth/browser запускать последовательно: их ресурсы не должны конфликтовать. Полные suites пока не нужны, будут перед итоговой приёмкой. Допустимо переиспользовать один доказанно свежий build для targeted suite без изменения штатных guards.

Own synthetic per-run БД через существующий guarded runner, явный TEST_DATABASE_URL. Если PG17 недоступен — не запускать Colima/CRM; разрешён отдельный временный loopback PG18 с честной версией, эфемерным паролем и stop/cleanup собственного кластера. Не печатать credentials/URI/storageState. Проверить отсутствие собственных leftovers/соединений.

## Завершение

Подробный отчёт только в reports/TASK-008-executor.md, секция R6: команды/exits/counts, доказанная смена и восстановление зоны, cleanup, ограничения. В чат только 4–5 коротких строк: READY_FOR_REVIEW/BLOCKED, полный SHA, итог, targeted counts, путь отчёта. Обычный scoped новый commit и остановка до review. TASK-008 DONE не объявлять, R7/R8/TASK-009 не начинать. Без merge/push/amend/rebase/reset/stash/deploy, main/CRM/localhost3000/hooks изменений; секреты не коммитить.
