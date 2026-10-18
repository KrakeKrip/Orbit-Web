# TASK-008-R2a-fix — независимое review

**ACCEPTED (R2a целиком)**, 2026-10-09. Executor HEAD `437e5a26a07ccec87dd4624354b13e39563a8edd`, correction base `b20c761f398a01ea4c89df7c9d8b2138d2ab70dd`. Один scoped commit, 3 product + browser spec + executor report. Дерево до review чистое; correction diff --check чист. Main чистая на `9a81313bb498fd1e584b14a0bc2b87b506102c6b`.

Открытые rename/delete формы используют общий state.busy; schedule editor получает blocked отдельно от собственной pending. Frozen opening snapshot и draft остаются прежними. Locked контролирует ввод/Save/Cancel/Escape; метки сохранения и aria-busy зависят от собственной операции. Close callbacks проверяют синхронный anyInFlight: программная отмена при чужом POST не закрывает editor. Общий pre-fetch write guard сохранён; owner/service/API/schema не менялись.

## Независимые проверки Codex

Node 24.21.0. lint exit 0, 0 warnings; typecheck exit 0; unit 63/63. Свежий штатный production build PASS. `CI=1 E2E_PORT=3443 npm run test:e2e -- tests/e2e/write-guard.spec.ts tests/e2e/inbox.spec.ts tests/e2e/planning.spec.ts --project=chromium`: **33/33**, exit 0 (3 auth setup + 5 write guard + 12 Inbox + 13 planning). Новая regression прямо проверяет прежний Codex repro: dirty editor открыт до held POST; поля/Save/Cancel disabled, bypass не шлёт PATCH/не закрывает форму, отказ освобождает controls, draft сохранён, настоящее Save успешно. Rename/delete аналогично покрыты.

Штатный PostgreSQL **17.11** доступен и подтверждён SHOW server_version. Только guarded synthetic per-run test-база; до и после прогонов orbit_test* баз 0, после тестовых соединений 0. Colima и CRM не запускались/не останавливались; localhost3000 не использован. Продуктовый код Codex не менял; без merge/push/deploy.

Full auth/full E2E/no-env build/dev probe в этом узком review не повторялись. Прежние EOF/debug замечания остаются для финальной уборки; R6 timezone test ещё открыт, зелёный targeted planning не закрывает R6. Ранее добавленный таблица-тест одновременно открывает rename/delete: после введения R2b1 его нужно перевести на последовательные варианты, сохранив все R2a assertions.

R1 и R2a приняты. R2b–R8 остаются открытыми, TASK-008 NEEDS_FIXES. Следующая выдача **только TASK-008-R2b1**: одна активная форма. Переключение mode/window будет отдельным R2b2. Подробный отчёт исполнителя сохранять в reports/TASK-008-executor.md; чат только короткий статус/SHA/путь к отчёту.
