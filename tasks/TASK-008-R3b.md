# TASK-008-R3b — завершить latest-read guard

Статус: ACCEPTED на 54780f1, R3 закрыт; reports/TASK-008-R3b.md. Следующее задание только tasks/TASK-008-R4.md.

## Одна проблема, два оставшихся файла

R3a Upcoming product fix принят на 18f13bad91248f09f0dcca70c6ac8808f4ac97df, review reports/TASK-008-R3a.md. Исправить тот же latest-read дефект в Today и Inbox одним небольшим заданием, без двух отдельных handoff. Начать с нового coordinator assignment HEAD, проверить root/branch/status. Ветка task/TASK-008; worktree /Users/atlhnv/Codex/orbit-worktrees/TASK-008.

Пользователь попросил ускорить работу: один повторяющийся дефект в нескольких файлах — один небольшой TASK; только targeted checks, full gates перед итоговой приёмкой. Это не разрешение расширять scope на R4–R8.

## Scope и результат

Product: today-board.tsx и tasks-view.tsx. Tests: read-lifecycle.spec.ts (усилить существующую синхронизацию и коротко добавить остальные экраны); executor report. Upcoming product fix не переписывать; общий controller/hooks/helper architecture не вводить.

Today: перенести принятый stillLatest pattern на refetch — captured actor/seq + mounted, guard после fetch/JSON, перед HTTP/error/success state writes, catch/finally. Inbox: onConfirmed уже ждёт Promise.all двух fetchInboxList, включая JSON; existing guard после Promise.all защищает success. Добавить latest seq к catch/finally и единообразно защитить все state updates. Чистому fetchInboxList без state не нужна новая архитектура.

Stale network/JSON error, success и finally ничего не меняют в latest tasks/context/error/pending. Latest success/error/retry сохраняются. Параллельные чистые reads не запрещать; listPending disable-policy не перерабатывать. Confirmed create/rename/complete + failed refresh не должен становиться false failed mutation. R1/R2, actor/unmount/StrictMode и API/service/schema не трогать.

## Targeted regression — без большого нового suite

- Существующий Upcoming delayed-JSON тест: wrapper выставляет сигнал именно при входе в json(); expect.poll этого сигнала ДО запуска нового read. После release старого дождаться его завершения/обработки перед проверкой latest списка. Wrapper восстанавливать в finally. У abort/pending cases также явно дождаться старого исхода до negative/pending assertions; release всех gates в cleanup. Никаких произвольных sleeps и проглоченных timeout.
- Today: коротко проверить old abort после latest success и old finally при held latest read; добавить delayed JSON по той же небольшой тестовой схеме с jsonEntered signal. У Today существующие modes open/completed, не добавлять All. Собственные отличимые open/completed задачи на today, без активных форм/writes.
- Inbox: old manual Refresh (пара GET open/completed) удержан; реальный quick-add POST запускает новый onConfirmed read. Проверить старый отказ после успеха нового без ложной ошибки/failed create и снятие pending только latest (можно двумя короткими фазами/тестами). Не добавлять product endpoints или менять button disable policy для запуска гонки. Считать доставки запросов раздельно по status/поколению; очистить оба старых gates.

Допустима маленькая общая test-only обёртка/табличная схема, если сокращает повторение. Не делать framework. Различать отрицательную проверку сразу после release и проверку после фактического settle; tasks/context latest не должны перезаписываться.

## Проверки и завершение

Node24 lint/typecheck; один свежий production targeted запуск read-lifecycle.spec.ts и write-guard.spec.ts с labels/grep для R3 и соответствующих mode guards. Не повторять unit/DB/auth/full E2E для этого UI read patch; полные gates позже перед TASK-008 acceptance. CI=1/свободный loopback port/own guarded PG17 test DB/cleanup. Не печатать credentials, не трогать Colima/CRM/сторонние сервисы.

Подробный отчёт в reports/TASK-008-executor.md, секция R3b: commands/exits/counts/first failures/cleanup/ограничения. В чат только 4–5 коротких строк: статус, full SHA, итог, targeted checks, путь к отчёту. Новый scoped обычный commit; остановиться до review. R4–R8 не начинать, TASK-008 DONE не объявлять. Без merge/push/amend/rebase/reset/stash/деплоя, main/CRM/localhost3000/hooks changes; secrets не коммитить.
