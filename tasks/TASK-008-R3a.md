# TASK-008-R3a — latest read в Upcoming

Статус: product fix ACCEPTED на 18f13ba; reports/TASK-008-R3a.md. Усиление синхронизации тестов включено в следующий общий TASK-008-R3b, R3 целиком ещё открыт.

## Одна цель и база

Только Upcoming: устаревший read не меняет tasks/context/error/pending нового read. R1/R2 приняты на executor HEAD 15c54871638296a9c1820127edf3308b7fe995e0, review reports/TASK-008-R2b4.md. Начать с нового coordinator assignment HEAD, проверить root/branch/status. Ветка task/TASK-008; worktree /Users/atlhnv/Codex/orbit-worktrees/TASK-008.

R3 из reports/TASK-008.md: requestSeq проверяется после fetch, но после await response.json() guard отсутствует; catch/finally проверяют только actor/mounted. Старый abort после успешного нового read показывает ложную ошибку, old finally снимает pending ещё выполняющегося нового read, old JSON может перезаписать новый список/context.

## Scope и приёмка

Один product file upcoming-board.tsx; небольшой tests/e2e/read-lifecycle.spec.ts (либо узкие additions отдельного existing spec) + executor report. Не вводить общий read controller, не перерабатывать экраны/hook. Today/Inbox/R4–R8 не трогать.

Для каждого read фиксировать actor и seq. Перед всеми state updates после await (включая JSON parsing, HTTP error, catch и finally) одновременно проверять mounted + actor + latest seq. Stale исход ничего не записывает и не снимает pending latest запроса. Старый success/body/error не перетирает tasks/context/listError. Latest success/error/finally по-прежнему корректно применяются, ручной GET-only retry работает.

Не решать гонку запретом параллельных чистых чтений: mode switch во время GET остаётся доступным по принятой R2 policy. Не менять mutation → refetch outcomes, guards write/form/mode, URL navigation, API/service/schema, dates/timezone. Abort старого запроса допустим как дополнительная оптимизация, но не замена защите всех исходов.

## Три короткие browser regression

Собственные fixtures, без активных форм/writes; обычные даты, чистые Upcoming mode reads.

1. Удержать старый GET completed → новый GET all успешно завершён → abort старого. All/list/context остаются latest, read error/retry не появляется.
2. Удержать старый completed и новый all; завершить/abort старый, пока новый всё ещё удержан. Refresh/pending остаётся pending нового, старый исход его не снимает; release нового приводит к штатному success и снимает pending. Синхронизация по delivery/events/expect.poll, без sleeps.
3. Старый fetch уже получен и прошёл initial seq guard, но его response.json() задержан; новый all успешно применён; отпустить старый JSON → tasks/context остаются latest. Разрешён небольшой test-only wrapper window.fetch/response.json с управляемой promise для точного воспроизведения этой await-границы, без product test endpoints/env/hooks. Отличимые own open/completed fixtures позволяют проверить late-body overwrite. Временный wrapper восстанавливать; no pageErrors/unhandled rejection.

Не ослаблять assert и не скрывать timeout через catch. Guards относятся и к сетевому reject, и к JSON reject. Последний failed read по-прежнему показывает ошибку/retry: при необходимости короткая дополнительная фаза в existing тесте, не новый большой suite.

Node24 lint/typecheck; свежий production targeted новый read spec и существующие Upcoming write/form guard сценарии (например --grep 'R3a:|Upcoming:' с соответствующими labels), CI=1/свободный port/own guarded PG17 test DB/cleanup. Full auth/full E2E/unit здесь не требуются, если contracts не изменены. Не трогать сторонние сервисы/Colima/CRM, не печатать credentials.

## Отчёт и остановка

Подробный отчёт только reports/TASK-008-executor.md, секция R3a: files/commands/exits/counts/cleanup/ограничения. В чате 4–5 коротких строк: статус, full SHA, итог, targeted checks, путь к отчёту. Новый scoped обычный commit; остановиться до review. Не начинать Today/Inbox R3 или R4–R8, не объявлять R3/TASK-008 DONE. Без merge/push/amend/rebase/reset/stash/деплоя, изменений main/CRM/localhost3000/hooks; secrets не коммитить.
