# TASK-008-R4 — независимое review

**ACCEPTED**, 2026-10-12. Executor HEAD `69371354f13057b1cc4d6de334523029e38860aa`, correction base `f098910a75c976ddff7a0d9c860f5f16c607111a`. Один scoped commit: task-row.tsx, write-guard.spec.ts, executor report. Перед review дерево чистое; correction diff --check чист.

Локальный TaskRenameEditor монтируется только при renameOpen; useState инициализирует draft актуальным task.title на каждое открытие. Key всей строки не менялся. Во время открытия обновление task prop не перезаписывает draft. Общий busy, own pending labels, Escape/cancel handlers и focus на открытии сохранены. Schedule snapshot R1 и guards R2/R3 не менялись. Новые browser regression проверяют cancel/reopen, failure/draft/focus/retry через настоящий API и внешнее изменение отдельным authenticated APIRequestContext (Origin/200/persisted GET) с Refresh/reopen.

## Независимые проверки Codex

Первая попытка использовала системный Node26: прежний временный Node24 исчез после изменения окружения. Build прошёл, E2E не стартовал — ECONNREFUSED 127.0.0.1:55432. Эти результаты не считаются целевым Node24 gate.

Повтор: официальный Node **24.21.0** восстановлен отдельно в /private/tmp/orbit-r4-review-runtime; отдельный временный Homebrew PostgreSQL **18.6**, свой кластер/случайный loopback port/ephemeral password, явный guarded TEST_DATABASE_URL. lint exit 0, 0 warnings; typecheck exit 0. Свежий production build PASS. `CI=1 E2E_PORT=3461 npm run test:e2e -- tests/e2e/inbox.spec.ts tests/e2e/write-guard.spec.ts --project=chromium --grep 'R4:|rename|quick-add по Enter'`: **17/17**, exit 0 (3 auth setup + 14 browser, включая 2 R4). После запуска test DB 0/test connections 0; свой PG остановлен, кластер/пароль удалены. Colima/PG17/CRM/localhost3000 не запускались. В текущем раунде независимая проверка на целевом PG17 не выполнена; executor сообщает её прохождение.

Unit/full auth/full E2E/no-env build/dev probe не повторялись по малому scope; реальные устройства/production не проверены. Продуктовый код Codex не менял; без merge/push/deploy. Main чистая на 9a81313bb498fd1e584b14a0bc2b87b506102c6b, проверено перед coordinator commit. Прежние EOF/debug замечания остаются для итоговой уборки.

R1–R4 закрыты. R5–R8 открыты, TASK-008 NEEDS_FIXES. Следующая выдача только tasks/TASK-008-R5.md: границы Upcoming и range helper.
