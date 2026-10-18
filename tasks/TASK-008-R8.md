# TASK-008-R8 — зона аккаунта в редакторе планирования

**PRODUCT FIX ACCEPTED**, 2026-10-12: 01ac0cea9dd44de1bd33b5f69daf737ce30c83ca, reports/TASK-008-R8.md. Test finally cleanup и full gates назначены отдельно в tasks/TASK-008-FINAL.md.

## Одна цель

Закрыть R8 из reports/TASK-008.md: общий schedule editor показывает актуальную server-derived account timezone в Inbox/Today/Upcoming. R1–R7 приняты, последний executor HEAD 3b1bd4035ad7bd98048bd2a75d84143d3e4aa23c, review reports/TASK-008-R7.md. Начать с нового coordinator assignment HEAD; записать полный SHA, проверить root/branch/status. Ветка task/TASK-008, worktree /Users/atlhnv/Codex/orbit-worktrees/TASK-008.

## Ограниченный scope — только metadata props и подпись

Разрешены src/app/(workspace)/inbox/page.tsx, components/orbit/tasks-view.tsx, task-items-list.tsx, task-row.tsx, task-schedule-editor.tsx, today-board.tsx, upcoming-board.tsx; при необходимости только строка подписи в src/lib/i18n/ru.ts. Эти файлы — одна цепочка передачи timezone, не разрешение переписывать экраны. Browser additions только tests/e2e/planning.spec.ts; executor report.

- Inbox server page передаёт timezone из существующего getTasksReadContext вместе с today. После Refresh Inbox обновляет metadata из того же актуального GET context; read latest/mounted/actor guards R3 сохраняются. Не брать зону из браузера, localStorage или hardcoded UTC, не добавлять отдельный settings fetch/новый API.
- Today/Upcoming используют свои существующие context.timezone; передать через TaskItemsList/TaskRow в TaskScheduleEditor. Одна понятная подпись рядом с TIME control, например «Время в зоне Asia/Tokyo». Подпись видима и доступна клавиатурному/screen-reader пользователю (при необходимости aria-describedby). Не дублировать весь контекст и не расширять TaskDTO.
- Refresh после смены настроек меняет подпись, в том числе в уже открытом editor; frozen schedule snapshot/dirty draft при этом не сбрасывать. DATЕ/TIME остаются civil date и wall-clock label: никаких UTC/instant-конверсий или переписывания task fields.
- R1 snapshot/dirty PATCH, R2 write/form/mode guards, R3 latest-read/actor guards, R4 rename и R5–R7 не переделывать. Не менять schema/service/API/settings persistence/writes/controller.

## Browser доказательство

Явный browser timezoneId UTC, synthetic account Asia/Tokyo через accepted API с Origin/assert200/GET confirmation. Проверить подпись editor в Inbox, Today, Upcoming — один компактный таблица-сценарий на своих fixtures достаточен. Проверить в Inbox открытую dirty schedule форму: изменить account zone через API на Europe/Moscow, реальный Refresh -> подпись обновилась, draft сохранён, no unsolicited PATCH; Save отправляет только dirty fields и значения без преобразования, GET item подтверждает их. Прежнюю account timezone восстановить в finally точным 200 и GET confirmation. Отдельные actor/login сценарии не добавлять без необходимости, бюджет auth limiter не менять.

Синхронизация по настоящим response/expect.poll; не clock override/sleep. Не ослаблять существующие регрессии R1/R2.

## Целевые gates

Node24 проверить перед запуском; runtime /private/tmp/orbit-r4-review-runtime/node-v24.21.0-darwin-arm64/bin. npm run lint (0 warnings), npm run typecheck. Свежий production E2E: новые R8 и существующие planning R1 snapshot + write-guard schedule cases; выбрать проверенный grep по фактическим названиям и записать реальные counts. Полные auth/DB/unit/E2E пока не нужны — отдельный финальный проход после review R8.

Own guarded per-run test DB. Если PG17 недоступен, разрешён отдельный временный PG18 loopback с честной версией/эфемерным паролем, stop/cleanup собственного кластера. Colima/CRM не запускать. Credentials/URI/storageState не выводить, проверить leftovers/соединения. Прогоны последовательные.

## Завершение

Подробный отчёт только reports/TASK-008-executor.md, секция R8 (commands/exits/counts, refresh/draft/zone evidence, cleanup/ограничения). В чат 4–5 коротких строк: статус, full SHA, итог, counts, путь отчёта. Обычный scoped commit; остановиться до review. Финальный cleanup/gates и TASK-009 не начинать, TASK-008 DONE не объявлять. Без merge/push/amend/rebase/reset/stash/deploy; main/CRM/localhost3000/hooks не трогать, secrets не коммитить.
