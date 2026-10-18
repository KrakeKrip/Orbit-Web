# TASK-008-R3a — независимое review

**ACCEPTED: продуктовая коррекция Upcoming**, 2026-10-09. Executor HEAD `18f13bad91248f09f0dcca70c6ac8808f4ac97df`, correction base `a325fb408affae115b9e88514820e759de70e17a`. Один scoped commit: upcoming-board.tsx, read-lifecycle.spec.ts, executor report. Перед review дерево чистое; correction diff --check чист. Main чистая на `9a81313bb498fd1e584b14a0bc2b87b506102c6b`.

stillLatest проверяет mounted+captured actor+latest seq после fetch, после response.json, в catch и finally. HTTP refusal и JSON/success state updates защищены; устаревший исход не пишет listError/tasks/context и не снимает pending нового read. Параллельные чистые reads доступны, mutation/controller/API/service/schema/R1/R2 не менялись.

## Независимые проверки Codex

Node24.21.0; lint exit 0, 0 warnings; typecheck exit 0. Свежий штатный production build PASS. `CI=1 E2E_PORT=3455 npm run test:e2e -- tests/e2e/read-lifecycle.spec.ts tests/e2e/write-guard.spec.ts --project=chromium --grep 'R3a:|Upcoming:'`: **8/8**, exit 0 (3 auth setup + 3 read lifecycle + 2 Upcoming write/form guards). PG **17.11** подтверждён SHOW server_version; own guarded synthetic per-run база; после запуска test DB 0/test connections 0. Main/Colima/CRM/localhost3000/hooks не трогались; продуктовый код Codex не менял. Без merge/push/deploy.

## Ограничение регрессий, включённое в следующий общий R3 шаг

JSON тест переключает новый mode сразу после click старого: он не ждёт явного сигнала фактического входа в json() старого ответа. При ином timing старый fetch может стать stale ещё до JSON, и тест пройдёт без проверки post-JSON guard. После release/abort старого первые negative assertions тоже не ждут полного завершения старого исхода. Это ограничение строгости тестов, не найденная ошибка текущего stillLatest кода. Нет независимого доказательства, что эти tests гарантированно падают при удалении каждого отдельного guard.

Чтобы не создавать отдельный цикл ради тестовой синхронизации, её усиление включено в следующий TASK-008-R3b вместе с тем же дефектом Today/Inbox. Продуктовая R3a принята; R3 целиком остаётся открытым до остальных экранов и завершения синхронизированных regression checks.

Unit/full auth/full E2E/no-env build/dev probe не повторялись по заданию. Результат targeted не закрывает R6/timezone и старые EOF/debug замечания, реальные устройства/production не проверены. R1/R2 приняты; R3b и R4–R8 открыты; TASK-008 NEEDS_FIXES.
