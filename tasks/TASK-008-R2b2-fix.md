# TASK-008-R2b2-fix — guard до расчёта даты

Актуальный статус: R2b2 принят на 9d9566e; reports/TASK-008-R2b2-fix.md. Ниже историческое задание/review.

## Одна минимальная коррекция

Review reports/TASK-008-R2b2.md, executor HEAD 556c9f77c6357dc0eff02310d048c98031709592. Общая R2b2-блокировка работает, все 37 целевых browser checks независимо прошли. Остаток только в порядке вызова: `navigate(addCivilDays(...))` вычисляет аргумент ДО guard в navigate, вопреки заданию. Исправить только upcoming-board.tsx и executor report. Начать с нового coordinator assignment HEAD, проверить root/branch/status. Ветка task/TASK-008, worktree /Users/atlhnv/Codex/orbit-worktrees/TASK-008.

Передавать расчёт даты лениво и вызывать его после существующего guard либо добавить проверку до расчёта в handlers. Для prev/next/current порядок: guard (listPending/anyInFlight/anyFormOpen по принятой policy) → вычисление newStart → replaceState/setState/refetch. Заблокированный callback не рассчитывает дату и не делает effects. Status handling, reactive flags, frozen snapshot/single-form/write guards не менять.

Не чинить границы календаря (R5), чистое чтение/sequencing (R3), Inbox/Today, R4/R6–R8, debug/EOF cleanup. Не добавлять новый тест, зеркалящий реализацию; существующие две Upcoming guard-regressions уже проверяют UI policy. Здесь source review должен подтвердить отсутствие eager addCivilDays до guard. Не расширять scope и не переписывать контроллер.

## Достаточные проверки

Node24 lint/typecheck; штатный свежий production build + targeted Upcoming guard tests: `CI=1 E2E_PORT=<свободный> npm run test:e2e -- tests/e2e/write-guard.spec.ts --project=chromium --grep 'Upcoming:'` (auth setup dependencies выполняются штатно). Full auth/full E2E и повтор всех suites не нужны для этой правки порядка двух callbacks. Только собственная guarded synthetic PG17 test DB, cleanup; не печатать credentials и не трогать другие сервисы.

Подробный отчёт сохранить в reports/TASK-008-executor.md, секция R2b2-fix. В чате максимум 4–5 коротких строк: статус, full SHA, итог, targeted checks, путь к отчёту. Новый обычный scoped commit и остановка до review. Не объявлять R2/TASK-008 DONE, другие задания не начинать. Без merge/push/amend/rebase/reset/stash/деплоя, изменений main/CRM/localhost3000/hooks; secrets не коммитить.
