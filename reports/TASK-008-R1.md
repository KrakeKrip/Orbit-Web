# TASK-008-R1 — независимое review

**ACCEPTED (только R1)**, 2026-10-09. Executor HEAD `3b3688ad66845dc80216105bb20d85375293592e`; correction base `f56cecc0bf42441b6b2c39c4bd0f6b91df21c36b`. Ветка `task/TASK-008`, дерево до review чистое. Scope: один продуктовый файл task-schedule-editor.tsx, planning.spec.ts и executor report; diff correction чист. Main сохранилась на `9a81313bb498fd1e584b14a0bc2b87b506102c6b`.

Opening snapshot хранится отдельно от обновляемого prop и используется для dirty/PATCH comparisons. TaskScheduleEditor действительно размонтируется при Cancel и открывается заново с актуальным task snapshot. Owner/API/service не менялись. Независимые APIRequestContext регрессии проверяют реальные PATCH keys и persisted deadline/time, а не только отображение поля. Контракты no-op/clear-plan/failure/retry сохранены.

## Проверки Codex

- `npm run lint`: exit 0, один известный warning use-task-writes.ts:325 вне R1 scope.
- `npm run typecheck`: exit 0; `npm test`: exit 0, 63/63.
- Первая попытка targeted browser gate после свежего build: окружение не готово, ECONNREFUSED 127.0.0.1:55432, тесты не стартовали. Read-only диагностика: Colima выключена; это не регрессия R1.
- Независимый повтор: временный отдельный локальный PostgreSQL **18.6** из Homebrew, новый кластер в /private/tmp, случайный свободный loopback port, собственные synthetic per-run test DB и ephemeral credential; штатные guards не обходились. `CI=1 E2E_PORT=3431 npm run test:e2e -- tests/e2e/planning.spec.ts --project=chromium`: production build PASS, **16/16**, exit 0 (3 auth setup + 13 planning, включая 3 новые R1-регрессии).
- Штатная runner-finalization успешна, отдельный PostgreSQL остановлен; temporary password file удалён. Colima/Orbit dev DB/CRM/localhost:3000 не запускались и не менялись. Проверка на целевом PostgreSQL17 в этом раунде не повторена; executor сообщает её прохождение, независимый UI gate выполнен на PG18.

R1 закрыт. R2–R8 из reports/TASK-008.md остаются открытыми, TASK-008 сохраняет NEEDS_FIXES. Нет merge/push/deploy. Следующая выдача — только `tasks/TASK-008-R2a.md`: общий guard create/row writes; остальная часть R2 про выбор editor/mode будет отдельным R2b. Не считать targeted green итоговой приёмкой всего TASK-008.
