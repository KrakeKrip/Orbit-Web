# TASK-008-R7 — независимое review

**ACCEPTED**, 2026-10-12. Executor HEAD `3b1bd4035ad7bd98048bd2a75d84143d3e4aa23c`, correction base `9cc9938ee768d829ae74ee03e4aae2e09b3b6cac`. Scope: task-view.ts, service.ts, два test files, executor report. Correction diff --check и рабочее дерево чистые.

compareTodayOrder использует существующий todaySectionOf для ranks и прежние внутриранговые comparators; service и UI используют этот общий контракт. Service сохраняет SQL stable triple sort_order/created_at/id, затем стабильную JS sort; равные значения наследуют исходный порядок. Только Today пересортируется; Inbox/Upcoming, owner/status/working filters, DTO и transactional writes не менялись. Pure helper принимает минимальную форму schedule fields, поэтому TaskRecord/TaskDTO совместимы без преобразования дат в instant.

Новая raw API регрессия проверяет относительный порядок 13 собственных fixtures (все ranks/date/time NULLS LAST), foreign isolation, open/completed/all. Создание проверяет stable tie по исходному порядку, но отдельно контролируемые одинаковые created_at и разные sort_order/id в новую fixture не добавлены. Эти SQL tie-break выражения не менялись и подтверждены source review; это ограничение новой регрессии, не найденный дефект реализации. Прежние filters/merge/context tests сохранены.

## Независимые gates Codex

Node **24.21.0**, собственный временный PostgreSQL **18.6**, guarded TEST_DATABASE_URL/loopback/отдельный кластер/эфемерный пароль. PG17 на 55432 недоступен; Colima/CRM не запускались.

- npm run lint: exit 0, 0 warnings; npm run typecheck: exit 0.
- npm test -- tests/calendar-view.test.ts: **25/25**, exit 0.
- npm run test:auth -- tests/auth/tasks-planning.auth.test.ts: **23/23**, exit 0, свежий production build.

После запуска 0 тестовых БД/0 соединений; собственный PG остановлен, кластер/пароль удалены. Main проверена чистой; merge/push/deploy отсутствуют. Full auth/DB/E2E, no-env build/dev probe и реальные устройства не повторялись; независимый PG17 check не выполнен.

R1–R7 закрыты; R8 открыт, TASK-008 NEEDS_FIXES. Следующее задание tasks/TASK-008-R8.md — server-derived timezone label в общем schedule editor. После него — отдельный финальный cleanup/gates, до DONE ещё требуется итоговая приёмка.
