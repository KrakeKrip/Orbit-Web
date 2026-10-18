# TASK-008-R2b1 — независимое review

**ACCEPTED (только R2b1)**, 2026-10-09. Executor HEAD `c68d3a88a884ea6f3d3eda90a03a86cfc1d31429`, correction base `a8b64194ac10f87e47c6dcf82d66fe28b76bff44`. Один scoped commit, 3 product files + write-guard.spec + executor report. Дерево до review чистое; correction diff --check чист. Main чистая на `9a81313bb498fd1e584b14a0bc2b87b506102c6b`.

activeFormRef регистрирует выбор синхронно до render; повторное или чужое открытие — no-op, старые draft/error не сбрасываются. Реактивное зеркало блокирует form triggers строк. Cancel освобождает ref вместе со state; успешные rename/schedule закрываются существующими close callbacks после завершения write flow. Успешный DELETE очищает activeFormRef там же, где закрывает confirmation. Отказ оставляет форму активной. Общий pre-fetch write guard, R2a controls lock и frozen snapshot R1 сохранены. Service/API/schema не менялись.

R2a таблица-тест переведён на последовательные rename/delete варианты: disabled controls, bypass/no extra requests, re-enable и draft assertions сохранены. Новые browser tests подтверждают запрет другой формы, Cancel → открытие другой, failed Save → сохранение выбора/draft/error, successful Save → освобождение выбора. Это не доказательство всего TASK-008: mode/window policy ещё отдельно открыта.

## Независимые проверки Codex

Node 24.21.0. lint exit 0, 0 warnings; typecheck exit 0; unit **63/63**, exit 0. Свежий production build PASS. `CI=1 E2E_PORT=3445 npm run test:e2e -- tests/e2e/write-guard.spec.ts tests/e2e/inbox.spec.ts tests/e2e/planning.spec.ts --project=chromium`: **35/35**, exit 0 (3 auth setup + 7 write guard + 12 Inbox + 13 planning). Штатный PostgreSQL **17.11** подтверждён SHOW server_version; guarded own synthetic per-run база, после запуска test DB 0, test connections 0. Main не менялась; Colima/CRM/localhost3000/hooks не трогались. Продуктовый код Codex не менял. Без merge/push/deploy.

Full auth/full E2E/no-env build/dev StrictMode в этом узком review не повторялись. R6 timezone regression и прежние EOF/debug замечания не закрываются targeted green. Смена mode/window специально исключена из R2b1: её нужно защитить и от pending write, и от скрытия активной формы, иначе mode switch может оставить скрытый editor selection. Следующая выдача только tasks/TASK-008-R2b2.md для Upcoming; другие экраны проверяются отдельным малым шагом, если нужна такая же коррекция.

R1/R2a/R2b1 приняты. R2 в целом ещё открыт; R3–R8 открыты, TASK-008 NEEDS_FIXES.
