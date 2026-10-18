# TASK-008-R2b1 — одна активная форма задачи

Статус: ACCEPTED на c68d3a8; reports/TASK-008-R2b1.md. Следующее задание только tasks/TASK-008-R2b2.md.

## Единственная цель

Первая маленькая часть оставшегося R2b: одновременно открыта только одна rename/schedule/delete форма на экране. R1 и R2a приняты на executor HEAD `437e5a26a07ccec87dd4624354b13e39563a8edd`, review reports/TASK-008-R2a-fix.md. Начать с нового coordinator assignment HEAD; проверить root/branch/status. Ветка task/TASK-008, worktree /Users/atlhnv/Codex/orbit-worktrees/TASK-008.

Сейчас hook хранит независимые editor ids: открытие schedule Q при rename P оставляет оба состояния; переключение формы той же строки может скрыть dirty draft прежней. Это отдельный дефект выбора формы; общий guard сетевых записей уже принят и не переделывается.

## Policy и scope

Пока любая форма открыта, отказать в открытии другой (другой тип или task). Не закрывать старую автоматически, не переносить фокус и не терять draft/error. Для перехода пользователь сначала сохраняет или отменяет текущую. Повторное открытие той же активной формы — no-op, не сбрасывает ошибки/draft. Quick-add с открытой idle формой по-прежнему допустим; accepted R2a locks during writes сохранены.

Scope: точечно use-task-writes.ts + task-items-list.tsx + task-row.tsx для синхронного open guard и disabled конфликтующих triggers; один небольшой browser spec/добавления write-guard.spec.ts, executor report. Не переписывать hook целиком/экраны, не менять service/API/schema и frozen snapshot. Локальный механизм синхронного выбора формы допустим; guard должен работать до render, а не только после setState. Его освобождение при Cancel/успешной записи не должно залипать, отказ сохранения оставляет текущую форму.

**Не делать** mode/status/window policy (будет R2b2), read request sequencing R3, rename reinitialization R4, calendar bounds R5, timezone tests R6, API sorting R7, timezone labels R8, EOF/debug cleanup. Не исправлять всё R2 одним запуском.

## Приёмка и короткие browser-регрессии

- Dirty schedule P → попытки открыть rename/delete/schedule Q через UI и программный bypass → только P открыт, draft прежний, запросов нет. После Cancel P можно открыть Q. Аналогично другой тип/та же строка не подменяет активную форму.
- Failed Save P оставляет P/draft/error; успешный Save или обычный Cancel освобождает выбор, новую форму можно открыть. Focus accepted R2a/Inbox сохраняется; один write в полёте, actor/unmount/StrictMode guards не ломаются.
- Обновить R2a таблица-тест, который открывает rename и delete одновременно: выполнять его варианты последовательно, сохранив все disabled/bypass/no-request/draft/re-enable assertions. Это изменение нового policy, не ослабление проверок.
- Existing R1 frozen-snapshot regressions и R2a held-create/held-schedule/open-form checks зелёные.

Node24 lint/typecheck/unit; штатный свежий production build + targeted write-guard/inbox/planning и новый spec (если отдельный), CI=1/свободный loopback порт/guarded own unique DB. Штатный PG17 сейчас доступен; проверить target без вывода credentials и leftovers до/после. Не запускать/останавливать Colima/CRM/сторонние сервисы. Full auth/full E2E сейчас не требуются.

## Отчёт и завершение

**Подробный отчёт сохранять в файл `reports/TASK-008-executor.md`, не выводить в чат.** В файл: изменение, команды/exit/counts, первый failed run если был, cleanup, ограничения. В чате максимум 4–5 коротких строк: READY_FOR_REVIEW/BLOCKED, full SHA, краткий итог, результат целевых checks и путь к отчёту. Не копировать подробный отчёт в сообщение.

Новый обычный scoped commit; остановиться до Codex review. Не начинать R2b2–R8, не объявлять R2/TASK-008 DONE. Без merge/push/amend/rebase/reset/stash/деплоя, изменений main/CRM/localhost3000/hooks; secrets не коммитить.
