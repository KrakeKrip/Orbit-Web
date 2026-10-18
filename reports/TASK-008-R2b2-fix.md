# TASK-008-R2b2-fix — независимое review

**ACCEPTED (R2b2 целиком)**, 2026-10-09. Executor HEAD `9d9566e5a2434f7272840e9b3db21f0aa5248310`, correction base `033e2103180d28a99a7d91be467a10bca80003d4`. Один scoped commit: upcoming-board.tsx и executor report. Перед review дерево чистое; correction diff --check чист. Main чистая на `9a81313bb498fd1e584b14a0bc2b87b506102c6b`.

Prev/next вызывают navigateByDays(±7), который проверяет listPending/anyInFlight/anyFormOpen перед addCivilDays. Guarded navigateTo выполняет URL/state/GET только после проверки; current передаёт уже существующий context.today. Eager вычисления календаря в onClick больше нет. Reactive disabled и status guard R2b2 сохранены; calendar bounds R5 не менялись.

## Независимые проверки Codex

Node24.21.0; lint exit 0, 0 warnings; typecheck exit 0. Свежий штатный production build PASS. `CI=1 E2E_PORT=3449 npm run test:e2e -- tests/e2e/write-guard.spec.ts --project=chromium --grep 'Upcoming:'`: **5/5**, exit 0 (3 auth setup + 2 Upcoming guard scenarios). Штатный PG **17.11** подтверждён SHOW server_version; own guarded per-run test DB, после запуска test DB 0/test connections 0. Продуктовый код Codex не менял; main/Colima/CRM/localhost3000/hooks не трогались; без merge/push/deploy.

Unit/full auth/full E2E/no-env build/dev probe в этом узком раунде не повторялись, как и требовало задание. В предыдущем review R2b2 на 556c9f7 независимо прошли 63 unit и 37 targeted browser tests; это историческое evidence, не повторный результат этого раунда. Реальные устройства/production не проверены.

R1/R2a/R2b1/R2b2 приняты. R2 ещё не закрыт для всех экранов: Inbox onClick напрямую setTab, Today switchMode не имеет синхронного guard открытой формы. Это исходный mode-policy остаток, намеренно исключённый из узкого Upcoming scope. Следующая выдача **только TASK-008-R2b3 (Inbox tabs)**, один product file. Today — отдельно после review. R3–R8 открыты; TASK-008 NEEDS_FIXES.
