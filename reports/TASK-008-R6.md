# TASK-008-R6 — независимое review

**ACCEPTED**, 2026-10-12. Executor HEAD `ed07ce2fc1c42a276ec993734536ba4ab4542b35`, correction base `37f23251c3c4da6cfe7bc066ea29f0cbc404307a`. Один scoped commit: три test files и executor report; продуктовый код не менялся. Рабочее дерево и correction diff --check чистые.

Auth проверяет local date собственного response.asOf в собственной зоне, точные 200 и GET-подтверждения смены/восстановления; finally возвращает прежнюю зону. Неизменность task проверяется независимым GET item, без зависимости от членства в Today. Browser явно UTC, account Asia/Tokyo установлен с Origin/200; UI сравнивается с context реального Refresh, прежняя зона восстановлена и подтверждена. Fixed-instant unit проверяет одинаковый и разный день. Nested describe наследует Today group, но локальные timezone/storageState overrides корректны; это не блокирует приёмку.

## Независимые gates Codex

Node **24.21.0**, свой временный PostgreSQL **18.6** (guarded TEST_DATABASE_URL, loopback, отдельный кластер и эфемерный пароль). PG17 на 55432 недоступен; Colima/CRM не запускались.

- npm run lint: exit 0, 0 warnings; npm run typecheck: exit 0.
- npm test -- tests/calendar-view.test.ts: **24/24**, exit 0.
- npm run test:auth -- tests/auth/tasks-planning.auth.test.ts -t timezone: **3/3**, 19 skipped, exit 0, свежий production build.
- CI=1 E2E_PORT=3465 npm run test:e2e -- tests/e2e/planning.spec.ts --project=chromium --grep 'timezone|R6:': **4/4**, exit 0 (3 auth setup + 1 R6), свежий production build.

Auth/browser logs без idle client error/terminating connection/57P01/uncaughtException. После запусков 0 тестовых БД и 0 соединений; собственный PG остановлен, кластер/пароль удалены. Main чистая на `9a81313bb498fd1e584b14a0bc2b87b506102c6b`. Merge/push/deploy отсутствуют.

Full gates не повторялись по test-only scope; PG17/реальные устройства/production в этом раунде не проверены. R1–R6 закрыты; R7/R8 открыты, TASK-008 NEEDS_FIXES. Следующая выдача только tasks/TASK-008-R7.md: Today raw API ordering.
