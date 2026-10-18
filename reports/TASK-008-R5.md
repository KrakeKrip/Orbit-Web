# TASK-008-R5 — независимое review

**ACCEPTED**, 2026-10-12. Executor HEAD `a4e8a84f413c56c2a277690e8419671f8ef783f2`, correction base `0dbd55a0cc66fceb09d46d14e2ed7e076a8fd235`. Scope: calendar.ts, upcoming-board.tsx, calendar-view.test.ts, planning.spec.ts, executor report. Дерево и correction diff --check чистые.

civilDateRange валидирует start и не делает шаг после последнего элемента: последнее допустимое окно возвращается без исключения, настоящий выход за границы отвергается. Upcoming проверяет start..start+6 до navigation effects; render availability не бросает исключение, pending/form guards выполняются до расчёта нового окна. Disabled и синхронные handler guards сохраняют URL/state при bypass. Нижнее, последнее и промежуточное крайние окна покрыты browser-регрессиями. Принятые R1–R4 и service/API/schema не перерабатывались.

## Независимые проверки Codex

Node **24.21.0**, отдельный временный Homebrew PostgreSQL **18.6**, loopback/собственный кластер/эфемерный пароль/guarded TEST_DATABASE_URL. Целевой PG17 недоступен; Colima/CRM не запускались.

- npm run lint: exit 0, 0 warnings.
- npm run typecheck: exit 0.
- npm test -- tests/calendar-view.test.ts: **23/23**, exit 0.
- Свежий production build: PASS.
- CI=1 E2E_PORT=3463 npm run test:e2e -- tests/e2e/planning.spec.ts tests/e2e/write-guard.spec.ts --project=chromium --grep 'R5:|Upcoming:': **9/9**, exit 0 (3 auth setup, прежняя навигация, 3 R5, 2 Upcoming guards).

После прогона: 0 тестовых БД и 0 соединений; собственный PG остановлен, кластер и пароль удалены. Main чистая на `9a81313bb498fd1e584b14a0bc2b87b506102c6b`. Продуктовый код Codex не менял; merge/push/deploy отсутствуют.

Полные unit/auth/DB/E2E, no-env build и dev probe не повторялись; реальные устройства/production не проверены. Независимая проверка на PG17 в этом раунде не выполнена. R1–R5 закрыты, R6–R8 открыты; TASK-008 остаётся NEEDS_FIXES. Следующая выдача только tasks/TASK-008-R6.md, test-only timezone assertions.
