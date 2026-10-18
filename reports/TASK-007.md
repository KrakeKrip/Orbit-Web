# TASK-007 — независимое review Codex

2026-10-08. **NEEDS_FIXES**. Проверен `22ba2d312c1683b1d9f54365c249a795b557fb09`, ветка task/TASK-007, worktree `/Users/atlhnv/Codex/orbit-worktrees/TASK-007`.
Review база `3b716dc0bfd06fbf5a508a83382abc1fda77d852`; assignment/start `1c6684af70a770b9f2c0edbbfca7e5ed909424ae`. Реализация 17 файлов, 3289 insertions/27 deletions; от review-базы 24 файла, включая 7 assignment documents. HEAD/branch/root проверены, дерево перед review чистое, diff --check PASS.

## Проверенная реализация / scope
Owner-scoped Inbox/root/undated/non-deleted/active-project фильтр, item ownership, payload/Unicode validation и cookie transport guards проверены чтением кода и реальными integration checks. Completion+revision+journal в одной transaction с task row lock; повтор/конкурентные completes дают один log, reopen сохраняет history, fault INSERT откатывает task. Delete root+own direct children атомарен, уже deleted children/log/completed_at не меняются. Project row lock согласован с archive UPDATE; порядок task→project принят для текущего subset (будущие move/subtask операции требуют собственного анализа).
Минимальные projects/settings timestamp изменения new Date→SQL now() обоснованы сравнением часов host/PG VM и не меняют ownership/upsert/archive контракт; прежние HTTP regressions прошли. Предпочтительно одно серверное время из БД для created/updated/completed/journal. Добавленное theme test ожидание «Тема сохранена» усиливает существующий persistence assertion вместо гонки reload с PATCH. Эти изменения сами по себе не требуют отката. Schema/dependencies/coord docs исполнителем не менялись.
Три UI ошибки ниже воспроизведены независимо и блокируют приёмку. Product source координатором не изменялся; merge/push/deploy не выполнялись, TASK-008 не назначен.

## R1 [P2] Network failure чтения ошибочно считается отказом успешной mutation
`src/components/orbit/tasks-view.tsx:105–129, 154–168, 397–401`: refreshLists имеет finally без catch. Network/JSON rejection пробрасывается в catch внешнего mutation handler, а retry вызывает void refreshLists без обработки rejection.
Независимый real Chromium/API probe (собственный production server 3262/unique DB): POST create успешно записывает task; GET lists после него принудительно aborted. Backend task существует, draft уже пустой, UI показывает «Не удалось добавить задачу. Попробуйте ещё раз.», read retry отсутствует. Это ложный отказ уже подтверждённого создания и риск повторного создания пользователем.
Другой deterministic сценарий: GET после create возвращает 500, read-error/retry показан; при следующем «Повторить» GET aborted → pageerror **Failed to fetch** (unhandled rejection). Это нарушает явный network/read error критерий TASK.
Исправить обработку refreshLists: network/malformed response ошибки отображаются как read error с retry и возвращают контролируемый outcome, pending снимается, actor/lifecycle guard сохраняется. Подтверждённый POST/PATCH/DELETE нельзя переклассифицировать в failed mutation из-за последующего read failure. Retry только перечитывает данные, не повторяет уже успешную запись. Прежний действительно failed mutation сохраняет draft/error/retry.
Acceptance browser: POST201 + aborted lists → строка есть в DB, корректная ошибка чтения/кнопка retry без ложного create error; восстановление GET показывает ровно одну task без нового POST. HTTP500 read→retry→network abort: pageerror/unhandled rejection отсутствуют, pending снят, повтор GET затем успешен. Применить read handling ко всем task mutation/refetch callers; не переделывать projects/settings вне scope.

## R2 [P2] Текущая строка не блокирует конфликтующие действия при completion pending
`src/components/orbit/tasks-view.tsx:429, 542–568`: rowBusy = busy && !togglePending && !deletePending намеренно оставляет текущую toggle-строку доступной. Поэтому её rename/delete triggers enabled, хотя завершение ещё в полёте; handler guards также не предотвращают начало другой операции той же строки.
Repro: удержать настоящий PATCH complete P; кнопки «Переименовать» и «Удалить» у P **enabled**. Нажать «Удалить» — confirmation появляется; отпустить successful complete → refetch убирает P из открытых и confirmation исчезает. Ответ старого запроса прерывает новое действие. Требование блокировать переключение editor/destructive actions при pending не выполнено.
Исправить disabled policy и соответствующие in-flight handler guards: во время completion/reopen/rename/delete конфликтующие действия текущей строки и переключение редакторов не запускаются. Повтор toggle тоже визуально заблокировать. Не ломать подтверждение/cancel/error retry и снять guard после завершения/отказа.
Acceptance: held complete/reopen конкретной строки → её rename/delete/repeated toggle недоступны, force/programmatic попытка не открывает editor/confirmation и не отправляет вторую mutation; после response/ошибки допустимые actions доступны. Сохранить held rename P→Q regression.

## R3 [P2] Inline delete confirmation теряет keyboard focus и не обрабатывает Escape
`src/components/orbit/tasks-view.tsx:281–287, 492–521`: trigger удаляется из DOM, но focus в confirmation не переносится; cancel пересоздаёт trigger без focus restoration, Escape handler отсутствует.
Независимый browser probe: открыть подтверждение удаления Q → document.activeElement **BODY**; нажать Escape → confirmation остаётся; нажать «Отмена» → document.activeElement снова **BODY**. Keyboard-only пользователь теряет позицию в списке и начинает Tab-навигацию с начала страницы. TASK прямо требует keyboard Enter/Escape/focus и accessible confirmation.
Исправить focus lifecycle и Escape/cancel: можно сохранить inline confirmation или использовать accessible AlertDialog. При открытии фокус должен попадать в confirmation (предпочтительно безопасная «Отмена»), Escape до отправки DELETE отменяет и возвращает focus к delete trigger; явная отмена также возвращает focus. Во время pending не разрешать cancellation, которая нарушит state handling. После успешного удаления focus в логичный оставшийся control; при failure focus не теряется. Rename focus return сохранить.
Acceptance: keyboard-only open→focus внутри confirmation, Escape cancel→trigger focused/row сохранена, explicit cancel→trigger focused; keyboard confirm выполняет один DELETE и сохраняет ожидаемое место focus после removal. Browser regression, включая pending policy R2.

## Независимые gates / ограничения
Node 24.21.0: npm ci --offline; lint/typecheck без warnings; **44 unit**, **47 DB**, **101 auth**, CI=1 E2E_PORT=3261 — **79 browser**; isolated archive snapshot проверяемого commit без .env/DATABASE_URL/BETTER_AUTH_SECRET/BETTER_AUTH_URL, npm ci + build — все PASS/exit0. По одному auth/E2E прогону Codex; executor 2×/3× не выдаются за повтор Codex. Полные auth/E2E logs без idle client error/terminating connection/57P01/uncaughtException.
Дополнительный production browser/API probe 3262 завершился exit0 и подтвердил R1/R2/R3. Собственный server/pool/DB закрыты с проверкой completion-aware runner finalization. После прогонов orbit_test_* databases **0**, connections **0**. Main/старые worktree/localhost3000/CRM/защитные настройки при проверках не изменялись, реальные аккаунты/dev DB не мутировались.
Executor real dev StrictMode evidence прочитан; самостоятельный dev replay в этом раунде не выполнялся. Реальные устройства/production proxy/deployment не проверены, прежние audit/limiter ограничения остаются.

## Передача GLM
Та же ветка/worktree; исправить R1/R2/R3 и browser regressions, обновить reports/TASK-007-executor.md. Service/schema/ownership/completion/locking не переделывать: найденные ошибки в UI, подтверждённые server write semantics сохраняются. Обычные новые commits; main/старые worktree/coord docs/protective hooks не менять; без merge/push/amend/rebase/reset/deploy. Выполнить gates TASK-007, вернуть full latest SHA и READY_FOR_REVIEW либо точную BLOCKED диагностику. TASK-008 не начинать.


## Повторное review 61a2add — 2026-10-08

**NEEDS_FIXES: R1/R2 закрыты, R3 open/cancel/Escape/success закрыт; осталось R3b [P2] — focus после DELETE failure.** Проверен `61a2addd8b24287cde4fa9bf55a2071da2edd402` относительно `fe95c5be5d799317ade3722398efcf03d8501ec8`: фактически **3 файла**, 329 insertions/16 deletions (tasks-view + inbox browser spec + executor report). Source изменений только один component; service/API/schema/transactions/completion/locking не менялись. Дерево перед review чистое, diff --check PASS.

### Закрытые замечания
R1: refreshLists ловит network/JSON read rejection и возвращает контролируемый outcome, list error/retry показан, подтверждённая mutation больше не становится failed write. Независимый production probe: POST успешен/запись есть, aborted GET → createError=false, draft пустой, read retry=1; HTTP500 reading→retry network abort → unhandledPageErrors=[]; последующее чтение восстанавливается без нового POST.
R2: current completion row rename/delete/toggle disabled и handler guards предотвращают вторую mutation/editor. Независимый held complete probe: renameEnabled=false, deleteEnabled=false; force-click не открывает confirmation до/после response. Сохранён held rename P→Q regression.
R3: open фокусирует безопасную Отмену; Escape и explicit cancel возвращают focus на delete trigger. Keyboard success→quick-add regression проходит.

### R3b [P2] После отказа удаления focus остаётся BODY
`src/components/orbit/tasks-view.tsx`, handleDelete error/catch/finally (строки 396–407): при DELETE кнопки confirmation disabled, сфокусированный confirm button теряет focus. Error path показывает ошибку и включает кнопки обратно, но не задаёт deleteFocus, поэтому эффект восстановления focus не вызывается. Это оставшаяся часть первоначального R3: «при failure фокус не теряется», а не новый scope.

Независимый Chromium probe на собственном production server **3269**/unique test DB: open confirmation → focus Отмена → Shift+Tab/Enter → held DELETE; подтвердить pending disabled controls; отпустить HTTP500 → alert видим, Отмена enabled, **document.activeElement={tag:BODY,id:''}**. Keyboard пользователь снова теряет своё место; Escape на BODY не всплывает к confirmation.
Исправить только failure focus lifecycle: после HTTP refusal или network rejection и снятия pending вернуть focus в доступный безопасный control текущего живого confirmation. Не переносить focus после unmount/смены actor/неактуального request и не разрешать Escape/cancel во время DELETE pending. Сохранить success→quick-add, cancel/Escape→trigger, R1/R2 guards и read error semantics.
Acceptance: детерминированный keyboard held DELETE→500 (и network rejection, если отдельная ветка) → task/confirmation остаются, error видима, pending снят, focus внутри confirmation на enabled control; Escape после отказа отменяет и возвращает focus к trigger; retry-delete работает. Добавить это в browser regression без weakening прежних assertions.

### Независимые gates и ресурсы
Node24.21.0: npm ci --offline; lint/typecheck без warnings; **44 unit**, **47 DB**, **101 auth**, CI=1 E2E_PORT=3268 — **82 browser**, isolated archive no-env snapshot + npm ci/build — все PASS/exit0. По одному auth/E2E прогону Codex, executor 2× отмечены отдельно. Auth/E2E logs без lifecycle error patterns. Дополнительный controlled browser/API probe 3269 завершился exit0; server/pool/test DB закрыты completion-aware finalization. Leftover orbit_test_* DB/connections: 0.
Independent dev replay в этом раунде не выполнялся; реальные устройства/proxy/deployment не проверены. Merge/push/deploy не выполнялись; main product source/localhost3000/CRM/protective hooks не менялись. TASK-008 не назначен.

### Следующая передача GLM
Та же ветка/worktree, только R3b focus после failed DELETE и browser regression, обновить executor report. Не переделывать service/schema/API/transactions/R1/R2. Обычные новые commits, gates TASK-007, вернуть latest full SHA/READY_FOR_REVIEW; без merge/push/amend/rebase/reset/deploy. TASK-008 не начинать.


## Финальное review e7fded5 — 2026-10-08

**APPROVED для локальной интеграции. R1/R2/R3/R3b закрыты.** Проверен `e7fded5766735a993ebf8be7c2cf0ae786379600` относительно `b28b80b5dacca602d6db0431cf1c15989f717f08`: фактически 3 файла (один component + inbox browser spec + executor report), 131 insertions/1 deletion. Service/API/schema/transactions/locking не менялись; timestamp correction прошлого раунда ранее проверена, rollback не требуется.

R3b: HTTP refusal и network rejection DELETE создают новый focus target cancel; post-commit effect работает после снятия pending и фокусирует enabled безопасную Отмену. Unmount guard сохранён, cancel/Escape при pending запрещены, success→quick-add/обычная отмена→trigger/rename focus-return сохранены. Новая browser regression проверяет held500, network abort, Escape после failure и успешный retry-delete.

Независимые Node24.21.0 gates: npm ci --offline; lint/typecheck без warnings; **44 unit**, **47 DB**, **101 auth**; CI=1 E2E_PORT=3273 — **83 browser**; отдельный archive snapshot проверяемого SHA без .env/DATABASE_URL/BETTER_AUTH_SECRET/BETTER_AUTH_URL, npm ci+build — все PASS/exit0. По одному auth/E2E прогону Codex, executor 2×/3× evidence отдельно заявлены. Logs без lifecycle error patterns.
Исходный controlled production Chromium/API probe повторён независимо на собственном server **3274**/unique test DB: после held DELETE500 activeElement — **BUTTON task-delete-cancel-<id>**, control enabled; Escape/open/cancel корректны. R1: подтверждённая task есть в БД, aborted read даёт createError=false/read retry=1; retry network abort без pageerrors. R2: current toggle row rename/delete disabled, force-click не открывает confirmation. Probe exit0, server/pool/DB закрыты через completion-aware finalization.

Самостоятельный dev replay в этом раунде не выполнялся; executor исходный real Next dev evidence сохранён, permanent dev suite отсутствует. Реальные устройства/production proxy/deployment не проверены, прежние deployment/limiter/audit ограничения сохраняются. Следующий шаг — local no-ff merge в чистую main, integration gates и DONE. TASK-008 не назначен; push/deploy не разрешены.


## Локальная интеграция — DONE, 2026-10-08

Принята реализация `e7fded5766735a993ebf8be7c2cf0ae786379600`, review commit `1322b75b822dd0169a8c49586c59ee0c15ec4af6`, local no-ff merge **`23934fcc8e97f18a3e9f69e56b4b4252a84502ea`**. Main перед merge чистая, конфликтов нет, история сохранена.
На интегрированной main независимо: npm ci --offline; lint/typecheck; **44 unit**, **47 DB**, **101 auth**; CI=1 E2E_PORT=3275 — **83 browser**; build без .env/DATABASE_URL/BETTER_AUTH_SECRET/BETTER_AUTH_URL — все PASS/exit0. Auth/E2E logs без lifecycle error patterns. TEST_DATABASE_URL передан из ignored task-worktree .env без печати секретов/записи .env в main; тесты использовали только own unique DB. После всех прогонов orbit_test_* DB/connections — 0. Пользовательские accounts/dev DB не создавались/не мутировались.
TASK-007 DONE; координационные статусы актуализированы. TASK-008 не назначен, push/deploy/protective hooks changes не выполнялись. Реальные устройства/production proxy не проверены.
