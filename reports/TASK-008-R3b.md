# TASK-008-R3b — независимое review

**ACCEPTED; R3 закрыт целиком**, 2026-10-09. Executor HEAD `54780f15bbecc04668e71f3a0529905833d2cd87`, correction base `a8fefb92f10e49de36d0397bb260dc6aac5537ba`. Один scoped commit: today-board.tsx, tasks-view.tsx, read-lifecycle.spec.ts, executor report. Дерево до review чистое; correction diff --check чист. Main чистая на `9a81313bb498fd1e584b14a0bc2b87b506102c6b`.

Today uses stillLatest после fetch/JSON, в catch/finally; все read state updates защищены captured actor/latest seq/mounted. Inbox success уже ожидал Promise.all с JSON обоих списков и проверял seq; catch/finally теперь используют тот же guard. Параллельные чистые reads доступны; controller/API/service/schema и accepted R1/R2 не менялись.

Read tests теперь ждут явный jsonEntered до нового read, jsonSettled/route abort/settle перед проверкой старого исхода. Fetch tracker и нулевой macrotask flush отделяют доставку старого ответа от проверки UI; route.fallback сохраняет цепочку gate interceptors. Новые Today cases проверяют старый abort после latest success, старый finally при held latest, поздний JSON; Inbox case проверяет старую пару Refresh GET после настоящего quick-add и нового read, отсутствие ложного read/failed create error. Отдельного Inbox held-latest-pending теста нет; соответствующий seq guard проверен исходником, поведение stale finally покрыто также на Today/Upcoming. Не выдавать это за полный acceptance всех функций.

## Независимые проверки Codex

Node24.21.0; lint exit 0, 0 warnings; typecheck exit 0. Свежий штатный production build PASS. `CI=1 E2E_PORT=3457 npm run test:e2e -- tests/e2e/read-lifecycle.spec.ts tests/e2e/write-guard.spec.ts --project=chromium --grep 'R3a:|R3b|Upcoming:|Вкладки|режимы'`: **16/16**, exit 0 (3 auth setup + 7 read lifecycle + 6 mode/form guards). PG **17.11** подтверждён SHOW server_version; own guarded synthetic per-run база; после запуска test DB 0/test connections 0. Продуктовый код Codex не менял; main/Colima/CRM/localhost3000/hooks не трогались; без merge/push/deploy.

Unit/full auth/full E2E/no-env build/dev probe не повторялись согласно ограниченному scope. Зелёный targeted не закрывает R6/timezone и прежние EOF/debug замечания; реальные устройства/production не проверены.

R1/R2/R3 приняты. R4–R8 открыты, TASK-008 NEEDS_FIXES. Следующая выдача **только TASK-008-R4**: актуальный rename draft при новом открытии, один shared product file и targeted browser regression.
