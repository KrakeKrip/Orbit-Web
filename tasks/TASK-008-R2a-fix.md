# TASK-008-R2a-fix — блокировка уже открытой формы

Актуальный статус: R2a принят на 437e5a2, reports/TASK-008-R2a-fix.md. Ниже сохранено предыдущее задание/review.

## Единственная цель

Закрыть остаток R2a из reports/TASK-008-R2a.md на executor HEAD `9932004481c48dcd9429a102c7b5854987029f08`. Начать с нового coordinator assignment HEAD, проверить root/ветку/status. Ветка task/TASK-008, worktree /Users/atlhnv/Codex/orbit-worktrees/TASK-008. Не переходить к R2b–R8.

Repro: открыть dirty schedule editor своей Inbox task → удержать POST quick-add. Quick-add disabled, но дата/Save/Cancel editor enabled: TaskRow передаёт только schedulePending, игнорируя общий busy. Rename и delete confirmation используют аналогичные own-pending проверки. Submit guard уже запрещает второй fetch; его не переделывать.

## Scope

Точечно task-row.tsx и, если нужны синхронные cancel guards, use-task-writes.ts; минимальный дополнительный blocked prop в task-schedule-editor.tsx допустим, если нужен для сохранения различия собственной pending операции и чужой блокировки. Регрессии только tests/e2e/write-guard.spec.ts и executor report. TaskItemsList минимально допустим лишь для проброса общего busy. Не переписывать экраны, transport/service/schema, frozen snapshot R1 и read flow. Не исправлять выбор единственного editor, переключение mode/window, rename draft, R3–R8, старую отладку и общую EOF-уборку.

## Приёмка

- Открытые rename/schedule/delete формы при любой write pending блокируют конфликтующие input/submit/confirm/cancel controls и Escape. Handler guard защищает от программного вызова cancel/submit даже до нового render; существующий guard до fetch сохранён.
- Сохраняются editor draft, error и frozen snapshot. Отказ чужого POST снимает блокировку; editor остаётся открыт, draft прежний, Save/Cancel доступны. Собственная операция по-прежнему отображает свои pending labels; чужой write не создаёт ложного «сохраняется/удаляется».
- Focus success/error/cancel, actor/unmount guards и StrictMode не ломаются. Никакого выбора одного editor или status/window policy в этом запуске.

## Малые регрессии и проверки

В write-guard.spec.ts добавить удержанный POST при уже открытой dirty schedule форме: delivery через expect.poll; assert поля/Save/Cancel disabled; программный submit и cancel/Escape не отправляют PATCH и не закрывают editor. Release 500 → editor/draft сохранены, controls enabled, последующее настоящее Save успешно. Короткие варианты для rename/delete confirmation подтвердят ту же блокировку (можно таблицей в одном тесте). Не ослаблять старые tests и не заменять отказ test timeout на catch.

Node24 lint/typecheck/unit; свежий штатный production build и targeted write-guard/inbox/planning, CI=1/свободный порт/own unique DB. Full auth/full E2E не нужны сейчас. При выключенной Colima разрешён отдельный временный локальный PostgreSQL с явным TEST_DATABASE_URL и честным указанием версии; сторонние сервисы не запускать. Cleanup обязателен.

Новый обычный scoped commit + executor report, полный SHA и фактические checks; остановиться до Codex review. Без merge/push/amend/rebase/reset/stash/деплоя, изменения main/CRM/localhost3000/hooks, без секретов в Git. Не объявлять R2/TASK-008 DONE.
