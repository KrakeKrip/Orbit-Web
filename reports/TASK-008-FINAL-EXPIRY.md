# TASK-008-FINAL-EXPIRY — независимое review и итоговая приёмка

**ACCEPTED**, 2026-10-12. Executor HEAD `237f711018efdb8d299428f5390a6e870096afe5`, correction base `8282e52302a4b656684b152d965d1a9ff31440a1`. Два scoped files: auth-flow.auth.test.ts и executor report. Дерево и cumulative diff --check от `394aef441a05d95969596bf088b37fb1f087432e` чистые.

Expiry fixture передаёт параметризованный JS UTC ISO timestamp с запасом60s вместо SQL local now. UPDATE ограничен synthetic userBId, rowCount>0; фактически возвращённые timestamp text values интерпретируются UTC и проверяются < Node now. До expiry me200, после me401. Продуктовая auth config/cache/refresh/schema/limiter не менялись. Уточнение ошибочного прошлого диагноза сохранено в executor report.

## Независимые финальные gates Codex на 237f711

Node **24.21.0**, собственный Homebrew PostgreSQL **18.6**, guarded namespace/unique per-run DB/loopback, без запуска Colima/CRM. Один собственный кластер: UTC targeted auth-flow, затем timezone Europe/Moscow и полные suites; менялась только конфигурация временного кластера.

- UTC: npm run test:auth -- tests/auth/auth-flow.auth.test.ts — **15/15**, exit0.
- Moscow: npm run test:auth — **124/124**, exit0, свежий production build.
- lint0 warnings/typecheck — exit0.
- npm test — **69/69**, exit0.
- npm run test:db — **47/47**, exit0.
- CI=1 E2E_PORT=3471 npm run test:e2e — **123/123**, exit0, свежий production build.
- No-env build — exit0: отдельная git-archive копия237f711, .env отсутствует, credential env сняты; node_modules скопирован отдельно из проверенного worktree (package/lock с принятых TASK не менялись). Пользовательский env не переименовывался.

Auth/E2E логи без idle client error/terminating connection/57P01/uncaughtException. После suites0testDB/0connections; свой PG остановлен, кластер/пароль удалены; no-env copy удалена. Независимый npm ci в этом раунде не повторялся, executor final install evidence сохранено. Dev StrictMode не повторялся после test-only cleanup; прежние live probes описаны в executor report, permanent dev suite отсутствует.

Ограничения: PG17 закрыт и в финальном проходе не проверен, реальные устройства/production proxy/deployment/offline/PWA не проверены. TASK-008 не реализует priority/notes/project assignment/subtasks/recurrence. Все findings TASK-008 закрыты; готов к локальной интеграции. Main до merge чистая на9a81313bb498fd1e584b14a0bc2b87b506102c6b. Push/deploy отсутствуют; TASK-009 не назначен.

## Локальная интеграция — DONE, 2026-10-12

Executor237f711018efdb8d299428f5390a6e870096afe5, review commit e87d3d6d5d717267023d669d00e962e1b4f45fdc; no-ff merge **8ec706867efb75f2b316d66a876622a1df38ed79** в чистую main, без конфликтов. `git diff --exit-code task/TASK-008 HEAD` после merge — exit0: дерево интеграции полностью идентично независимо проверенному task-tree. Затем на main Node24 lint/typecheck/69unit PASS. DB/auth/E2E/no-env gates не повторялись после merge: исходники/tests/config/package/lock идентичны, изменения после merge только coordinator docs. Независимые gates на237f711: 69unit/47DB/124auth/123browser/no-env build PASS, auth UTC/Moscow matrix PASS; ресурсы0/0 и временные кластеры/копия удалены.

TASK-008 DONE. PG17 не проверен финальным проходом; реальные устройства/proxy/deployment не проверены. Push/deploy отсутствуют, user env не изменялся; TASK-009 не назначен. Следующее задание должно быть небольшим самостоятельным результатом из исходного пакета TASK-009.
