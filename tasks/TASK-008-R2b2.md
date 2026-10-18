# TASK-008-R2b2 — безопасная смена режима в Upcoming

Актуальный статус: R2b2 принят на 9d9566e; reports/TASK-008-R2b2-fix.md. Ниже историческое задание/review.

Статус review 556c9f7: NEEDS_FIXES только порядок guard/расчёт; reports/TASK-008-R2b2.md, назначена tasks/TASK-008-R2b2-fix.md.

## Единственная цель и база

Только экран Upcoming: не менять status или 7-дневный диапазон во время task write либо при открытой rename/schedule/delete форме. Иначе старый write callback читает старый режим, либо активная форма скрывается с сохранённым выбором. R1/R2a/R2b1 приняты; executor HEAD c68d3a88a884ea6f3d3eda90a03a86cfc1d31429, review reports/TASK-008-R2b1.md. Начать с нового coordinator assignment HEAD, проверить root/branch/status. Ветка task/TASK-008; worktree /Users/atlhnv/Codex/orbit-worktrees/TASK-008.

## Малый scope

Основной файл upcoming-board.tsx; минимально use-task-writes.ts для reactive/synchronous признака активной формы, если нужно. Один небольшой browser spec либо additions write-guard.spec.ts, executor report. Не переписывать контроллер, не менять Inbox/Today в этом запуске. Не менять service/API/schema, pre-fetch write guard, single-editor policy и frozen snapshot.

## Поведение

- Кнопки status open/completed/all и prev/next/current disabled при любой pending записи или открытой форме. Синхронный handler guard до setState/refetch/history.replaceState/вычисления нового диапазона запрещает программный обход и попытку до render. Для active-form проверки использовать синхронный ref, не только state.
- Заблокированная попытка не меняет URL/start/status и не запускает GET. Dirty/error остаются в текущей форме. Нельзя автоматически закрывать/сбрасывать форму ради смены режима; пользователь сначала Cancel или Save.
- Pending guard удерживается через mutation+read flow. Failed Save оставляет форму и её mode lock; после Cancel или успешного Save mode/window снова доступны. После toggle без формы guard освобождается обычным finally. R2a/R2b1/actor/unmount/StrictMode сохраняются.
- Existing listPending policy prev/next/current сохранить. Не вводить новую блокировку параллельных чтений/переписывать request sequencing — это R3. Refresh/retry не перерабатывать. Границы 1900/2199 отдельно R5: здесь только guard до прежнего расчёта даты, без решения calendar bounds.

## Две короткие regression

1. Upcoming, собственная scheduled task, open mode. Удержать настоящий completion PATCH; delivery через expect.poll. Status и диапазон disabled, programmatic bypass не меняет status/URL и не шлёт GET нового mode/range. Release response → штатный read текущего mode, controls вновь доступны, обычная смена status работает.
2. Dirty schedule editor в Upcoming → status/range disabled; bypass не закрывает форму, draft прежний, GET/URL не меняются. Save с 500 оставляет editor/error/mode lock; Cancel освобождает выбор и controls; обычная следующая неделя затем работает. Использовать обычные даты, не calendar bounds.

Node24 lint/typecheck/unit; свежий штатный production build + targeted new spec/write-guard/inbox/planning, CI=1/свободный порт/guarded own unique PG17 test DB. Проверить leftovers, не печатать credentials. Full auth/full E2E здесь не нужны; сторонние сервисы/Colima/CRM не запускать и не останавливать.

## Отчёт и остановка

Подробный отчёт только в reports/TASK-008-executor.md (секция R2b2: files/commands/exits/counts/cleanup/ограничения). В чат максимум 4–5 коротких строк: статус, full SHA, короткий итог, checks, путь к отчёту. Новый scoped обычный commit; остановиться до review. Не начинать другие экраны/R3–R8, не объявлять R2/TASK-008 DONE. Без merge/push/amend/rebase/reset/stash/деплоя, main/CRM/localhost3000/hooks changes; secrets не коммитить.
