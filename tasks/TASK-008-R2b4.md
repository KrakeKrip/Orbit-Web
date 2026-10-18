# TASK-008-R2b4 — безопасные режимы Today

Статус: ACCEPTED на 15c5487, R2 закрыт; reports/TASK-008-R2b4.md. Следующее задание только tasks/TASK-008-R3a.md.

## Единственная цель

Только «Сегодня»: open/completed/all не переключаются при pending task write либо открытой rename/schedule/delete форме. Сейчас switchMode в today-board.tsx вызывает setStatusMode/refetch без синхронного guard; UI учитывает pending ref, но не открытый editor. Смена режима скрывает форму либо позволяет старому write callback читать старый mode. R1/R2a/R2b1/R2b2/R2b3 приняты; executor HEAD 027421537215017e72a456b0cbb9afc085ac4519. Начать с нового coordinator assignment HEAD, проверить root/branch/status. Ветка task/TASK-008, worktree /Users/atlhnv/Codex/orbit-worktrees/TASK-008.

## Scope и policy

Только today-board.tsx + два небольших browser tests в write-guard.spec.ts + executor report. Shared hook уже отдаёт reactive anyPending/formOpen и synchronous anyInFlight()/anyFormOpen(): использовать, не переделывать hook, rows или контроллер целиком. Service/API/schema/Inbox/Upcoming не менять.

- Три mode controls disabled при anyPending или formOpen. switchMode проверяет синхронные guards до setStatusMode/refetch: blocked попытка не меняет aria-pressed/mode и не запускает GET нового режима.
- Idle dirty editor остаётся открыт, draft/error не теряются. Failed Save держит mode lock; Cancel или успешный Save освобождают. Pending create тоже блокирует mode; HTTP отказ сохраняет create draft и освобождает controls, если нет открытой формы.
- Не закрывать форму автоматически ради смены mode. Quick-add с idle открытой формой допустим, принятая R2a policy сохранена. Pure read/listPending не получает новой mode блокировки: read sequencing — R3.
- Frozen snapshot R1, single-form guard, focus и actor/unmount/StrictMode, confirmed write + failed read distinction сохранить. R3–R8, calendar bounds и debug/EOF cleanup не трогать.

## Две короткие regression и проверки

1. Today held POST: delivery через expect.poll, все mode controls disabled, bypass не меняет selected mode/не запускает GET другого mode. Release 500 → create draft сохранён, controls enabled, обычный переход работает.
2. Dirty schedule editor своей Today task: mode disabled, bypass сохраняет editor/draft. Save 500 оставляет error/editor/mode lock; Cancel освобождает выбор, обычная смена mode работает. Использовать обычные даты и собственные fixtures, точный Origin при API seeding.

Node24 lint/typecheck; штатный свежий production build + targeted write-guard.spec.ts и planning.spec.ts, CI=1/свободный loopback port/own guarded PG17 test DB/cleanup. Full auth/full E2E/unit повтор для этой небольшой UI policy не нужен, если contracts не менялись. Не трогать сторонние сервисы/Colima/CRM и не печатать credentials.

## Отчёт и завершение

Подробный отчёт только в reports/TASK-008-executor.md, секция R2b4 (files/commands/exits/counts/cleanup/ограничения). В чате 4–5 коротких строк: статус, full SHA, итог, targeted checks, путь к отчёту. Новый scoped обычный commit; остановиться до review. Не начинать R3–R8, не объявлять R2/TASK-008 DONE. Без merge/push/amend/rebase/reset/stash/деплоя, изменений main/CRM/localhost3000/hooks; secrets не коммитить.
