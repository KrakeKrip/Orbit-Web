# TASK-008-R2b3 — безопасные вкладки Inbox

Статус: ACCEPTED на 0274215; reports/TASK-008-R2b3.md. Следующее задание только tasks/TASK-008-R2b4.md.

## Единственная цель

Только Inbox: «Открытые»/«Завершённые» не переключаются при pending task write либо открытой rename/schedule/delete форме. Сейчас tasks-view.tsx напрямую вызывает setTab; смена вкладки может скрыть активную форму и её draft, пока shared hook сохраняет выбор. R1/R2a/R2b1/R2b2 приняты; executor HEAD 9d9566e5a2434f7272840e9b3db21f0aa5248310. Начать с нового coordinator assignment HEAD, проверить root/branch/status. Ветка task/TASK-008; worktree /Users/atlhnv/Codex/orbit-worktrees/TASK-008.

## Scope и поведение

Только tasks-view.tsx + два коротких browser tests (write-guard.spec.ts) + executor report. Shared hook уже отдаёт anyPending/formOpen и синхронные anyInFlight()/anyFormOpen(): использовать их, не переделывать hook/rows/controller/service/API/schema.

- Оба tab controls disabled при anyPending или formOpen; handler до setTab проверяет синхронные anyInFlight/anyFormOpen. Заблокированная попытка, включая программный обход, не меняет aria-pressed/tab/visible list.
- Открытая форма и dirty/error сохраняются. Failed Save держит tab lock; после обычного Cancel или успешного Save tabs вновь доступны. Pending create тоже блокирует tabs; после отказа сохраняет create draft и освобождает tabs.
- Idle quick-add с открытой формой допустим по принятой R2a policy. Refresh/read retry и подтверждённая mutation + failed read не перерабатывать. Pure reads/listPending не получают новую tab policy; это не R3.
- R1 frozen snapshot, single-form guard, focus/actor/unmount/StrictMode и pre-fetch write guard сохранить. Today/Upcoming, R3–R8 и debug/EOF cleanup не трогать.

## Две короткие регрессии

1. Inbox held POST quick-add: после реального route delivery оба tab controls disabled; bypass не меняет выбранную вкладку. Release 500 → draft сохранён, tabs enabled, нормальный переход на «Завершённые» работает.
2. Dirty schedule editor в Inbox: tabs disabled; bypass не скрывает editor/draft. Save 500 оставляет editor/error/tab lock; Cancel освобождает выбор и tabs; обычный переход работает. Не исправлять rename cancel/reopen (это R4).

Node24 lint/typecheck; штатный свежий production build + targeted write-guard.spec.ts и inbox.spec.ts (auth setup dependencies штатные), CI=1/свободный loopback port/own guarded PG17 test DB/cleanup. Full auth/full E2E/unit повтор для этой небольшой UI policy не требуется, если contracts не изменены. Не трогать сторонние сервисы/Colima/CRM, не печатать credentials.

## Отчёт и завершение

Подробный отчёт только в reports/TASK-008-executor.md, секция R2b3 (files/commands/exits/counts/cleanup/ограничения). В чате 4–5 коротких строк: статус, full SHA, итог, targeted checks, путь к отчёту. Новый scoped обычный commit; остановиться до review. Не начинать Today/R3–R8, не объявлять R2/TASK-008 DONE. Без merge/push/amend/rebase/reset/stash/деплоя, изменений main/CRM/localhost3000/hooks; secrets не коммитить.
