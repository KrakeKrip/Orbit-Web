# TASK-008-R4 — rename draft на новое открытие

Статус: ACCEPTED на 6937135, 2026-10-12; reports/TASK-008-R4.md. Следующее задание только tasks/TASK-008-R5.md.

## Одна цель и база

R4 из reports/TASK-008.md: title=A → открыть rename → draft=B → Cancel → reopen; сейчас B возвращается, потому что renameDraft живёт в TaskRow со стабильным task.id key. При внешнем изменении title + refresh новое открытие тоже может показать старый draft. Новое открытие должно брать актуальный task.title; только текущее открытие сохраняет draft при ошибке.

R1/R2/R3 приняты на executor HEAD 54780f15bbecc04668e71f3a0529905833d2cd87. Прочитать reports/TASK-008-R3b.md. Начать с нового coordinator assignment HEAD, проверить root/branch/status. Ветка task/TASK-008; worktree /Users/atlhnv/Codex/orbit-worktrees/TASK-008.

## Scope и приёмка

Основной product file task-row.tsx, без изменений hook/screens/API/service/schema. Допустим небольшой локальный rename-editor child в том же файле, который монтируется только на время открытой формы и инициализирует draft из текущего task.title. Не менять key всей строки ради remount всех редакторов. Не сбрасывать draft из live prop при refresh во время текущего открытия. Исправить неверный комментарий о remount TaskRow.

- Cancel → новое открытие берёт актуальный подтверждённый title, отменённый draft не воскресает.
- Внешний rename через отдельный API client + закрытая форма/refresh → новое открытие показывает новый server title.
- HTTP/network отказ текущего Save сохраняет draft/error для retry; успешный Save отражает подтверждённый title. Ввод/Save/Cancel/Escape остаются заблокированы общим busy; own pending labels, focus on open/cancel/success/error, actor/unmount/StrictMode и single-form policy сохранены.
- Frozen schedule snapshot R1 не трогать. R5–R8/debug/EOF cleanup в этот запуск не включать.

## Две короткие browser regression

В write-guard.spec.ts добавить R4-label tests либо компактно в inbox.spec.ts:
1. Own title A → rename draft B → Cancel → reopen value A. Failed Save с B → draft/error сохраняются; retry через реальный API успешен, новое открытие видит B. Проверить focus/общую блокировку без новых login.
2. Закрытая форма, внешний реальный PATCH title=C через независимый authenticated API client с точным Origin → UI Refresh → rename показывает C. Собственные synthetic fixtures, утверждать response200 и persisted/read title, не только текст поля. Не менять реальные account credentials.

Node24 lint/typecheck; один свежий production targeted запуск new R4 tests + existing Inbox rename/guard flows (например inbox.spec.ts и write-guard.spec.ts с --grep 'R4:|rename|quick-add по Enter'). Full suites/unit/DB/auth повтор не нужны, contracts не меняются. CI=1/свободный port/own guarded PG17 test DB/cleanup. Не печатать credentials и не трогать сторонние сервисы/Colima/CRM.

## Отчёт и завершение

Подробный отчёт в reports/TASK-008-executor.md, секция R4: files/commands/exits/counts/first failures/cleanup/ограничения. В чат только 4–5 коротких строк: статус, full SHA, итог, targeted checks, путь к отчёту. Новый scoped обычный commit; остановиться до review. R5–R8 не начинать, TASK-008 DONE не объявлять. Без merge/push/amend/rebase/reset/stash/деплоя, main/CRM/localhost3000/hooks changes; secrets не коммитить.
