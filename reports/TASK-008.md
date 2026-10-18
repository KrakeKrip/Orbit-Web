# TASK-008 — независимый review Codex

## Итоговая приёмка — ACCEPTED, 2026-10-12

Принят executor HEAD `237f711018efdb8d299428f5390a6e870096afe5`. R1–R8, final cleanup и auth expiry fixture закрыты. Независимо на этом точном дереве Node24.21.0/собственный PostgreSQL18.6: lint0 warnings/typecheck, **69 unit**, **47 DB**, **124 auth**, **123 E2E**, no-env build — все PASS. Auth matrix: UTC auth-flow15/15, Europe/Moscow полный auth124/124. Логи без lifecycle error patterns, test DB/connections0/0; временные кластеры/пароли/копия no-env убраны. PG17 недоступен, в финальном проходе не проверен; реальные устройства/proxy/deployment не проверены. Source tree и cumulative diff чистые. Подробный финальный review — reports/TASK-008-FINAL-EXPIRY.md. Следующий шаг координатора: local no-ff integration в чистую main; push/deploy не разрешены. Ниже сохранён исторический первоначальный review.

## Первоначальный вердикт (исторический)

**NEEDS_FIXES**, 2026-10-09. Проверен executor HEAD `6388a088a13d657e236d4120ff094586c8317186`, база `394aef441a05d95969596bf088b37fb1f087432e`, assignment `9a81313bb498fd1e584b14a0bc2b87b506102c6b`. Ветка `task/TASK-008`, worktree `/Users/atlhnv/Codex/orbit-worktrees/TASK-008`; перед review дерево чистое. Main осталась на assignment SHA, merge/push не выполнялись. Продуктовый код Codex не менял.

Три предварительных замечания по DOM id/boolean/проглатыванию таймаута исправлены. Pure calendar, owner guards и атомарный merge planning в service выглядят обоснованно. Это не подтверждает корректность нового UI: независимые browser-пробы воспроизвели потерю чужого дедлайна и ещё пять нарушений контрактов.

## Независимые проверки

Runtime Node 24.21.0 из `/tmp/orbit-node24/node-v24.21.0-darwin-arm64/bin`, telemetry off. DB/auth/browser запускались последовательно, только через существующие guards и собственные per-run test-базы; CRM, dev DB и localhost:3000 не использовались.

| Проверка | Фактический результат Codex |
| --- | --- |
| `npm run lint` | exit 0, **2 warnings**, а не заявленное «без warnings»: missing requestFocus dependency (`use-task-writes.ts:325`), unused today (`planning.spec.ts:169`) |
| `npm run typecheck` | exit 0 |
| `npm test` | exit 0, 63/63 |
| `npm run test:db` | exit 0, 47/47 |
| `npm run test:auth` | **exit 1**, 122/123; timezone comparison `tasks-planning.auth.test.ts:376` |
| `CI=1 E2E_PORT=3357 npm run test:e2e` | exit 0, 94/94, production build PASS |
| Дополнительные browser-пробы, порт 3358 | 3 auth setup + 5 диагностик, 8/8; проверки намеренно подтверждают наличие дефектов, это не acceptance gate |
| Проба порядка Today API, порт 3359 | 3 auth setup + 1 диагностика, 4/4; подтверждён неверный порядок raw API |
| `civilDateRange('2199-12-25', 7)` | бросает RangeError, хотя все 7 возвращаемых дней допустимы |
| Diff executor относительно базы | `git diff --check <base>..6388a08` обнаружил новые пустые строки EOF в task-row.tsx и tasks-planning.auth.test.ts; чистый unstaged diff этого не проверяет |
| Ресурсы после всех запусков | read-only PG check: 0 orbit_test_* баз, 0 соединений |

No-env build, npm ci и live dev probe в этом review не повторялись; по ним пока только evidence исполнителя. Полный E2E прошёл один раз; повторение зелёного набора не заменило бы отсутствующие регрессии. Стандартный E2E оставил в выводе `R3 DEBUG`, а в inbox.spec сохранились два PROBE console listener — заявление о полном удалении отладки неточное. Реальные устройства/deployment не проверены.

## Замечания

Обновление 2026-10-09: R1 закрыт на executor SHA `3b3688ad66845dc80216105bb20d85375293592e`, независимый review reports/TASK-008-R1.md. Ниже сохранены исходные findings. Общий статус TASK-008 — NEEDS_FIXES; R2a принят на 437e5a2, reports/TASK-008-R2a-fix.md. R2b1 принят на c68d3a8, reports/TASK-008-R2b1.md. R2b2 принят на 9d9566e, reports/TASK-008-R2b2-fix.md. R2b3 принят на 0274215, reports/TASK-008-R2b3.md. R2b4 принят на 15c5487, reports/TASK-008-R2b4.md; R2 закрыт целиком. R3a product fix принят на 18f13ba, reports/TASK-008-R3a.md; синхронизация регрессий усилена в R3b. R3b принят на 54780f1, reports/TASK-008-R3b.md; R3 закрыт целиком. R4 принят на 6937135, reports/TASK-008-R4.md (2026-10-12). R5 принят на a4e8a84, reports/TASK-008-R5.md (2026-10-12). R6 принят на ed07ce2, reports/TASK-008-R6.md (2026-10-12). R7 принят на 3b1bd40, reports/TASK-008-R7.md (2026-10-12). R8 product fix принят на 01ac0ce, reports/TASK-008-R8.md; test finally cleanup назначен в FINAL. Следующая выдача **только** tasks/TASK-008-FINAL-EXPIRY.md: test-only auth expiry fixture.

### R1 [P1] — dirty editor стирает независимый дедлайн после refresh

`src/components/orbit/task-schedule-editor.tsx:39–58, 76–85`; snapshot передаётся из текущего task в `task-row.tsx:179`. Draft инициализирован при открытии, но dirty/PATCH сравниваются с **обновляемым prop snapshot**, а не исходным snapshot открытия.

Browser repro: открыть задачу с deadline=NULL → изменить только plannedDate → второй клиент через API сохраняет deadline=D → нажать «Обновить» при открытом editor → Save. В отправленном PATCH появляются `plannedDate` **и `deadlineDate:null`**, хотя пользователь дедлайн не менял; GET item подтверждает, что D стёрт. Это реальная потеря независимой записи. Server atomic field merge корректен, лишнее поле добавляет UI.

Требование: dirty fields вычислять относительно неизменного snapshot конкретного открытия editor; refresh не превращает чужие изменения в пользовательские. После отмены/нового открытия snapshot заново берётся с сервера. Ошибка сохраняет draft, очистка plan/time остаётся явным контрактом. Регрессия должна проверить PATCH keys и сохранённый в БД чужой deadline. Первой выдана **только эта коррекция**: `tasks/TASK-008-R1.md`.

### R2 [P2] — общего write/editor guard нет

`tasks-view.tsx:130–155`, `today-board.tsx:132–173`, `task-items-list.tsx:45–49`, `use-task-writes.ts:64, 156–160, 330–363`; Upcoming mode controls `upcoming-board.tsx:149–158`.

Create имеет отдельный createInFlight, невидимый shared hook. Browser repro: удержанный POST quick-add → existing row «Завершить» остаётся enabled → отправляется PATCH; одновременно в полёте две записи. В обратном направлении create handler знает про writes, но контролы не отражают общий busy. Уже открытые rename/schedule/delete формы тоже блокируют только свой pending, а editor ids независимы. Upcoming status controls допускают смену mode во время mutation, после чего её старый onConfirmed читает старый mode.

Требование: один общий write guard включает create; UI disabled и handler guards симметричны, существующие открытые формы и смена mode/window учитываются. Один активный editor/confirmation: новая форма не уничтожает dirty draft прежней. Добавить held-create + попытки row actions и held-schedule + другая форма/mode regression. Сохранить GET-only retry и actor/unmount suppression. Эта коррекция будет выдана отдельно после R1.

### R3 [P2] — latest request защищает не все исходы чтения

`upcoming-board.tsx:78–109`, `today-board.tsx:91–122`, `tasks-view.tsx:95–125`.

requestSeq проверяется для части success path, но catch/finally обходятся только mounted/actor; Today/Upcoming не повторяют guard после `await response.json()`. Browser repro: удержать GET completed → запустить успешный GET all → abort старый completed. На выбранном all появляется list error + «Повторить» от старого запроса. Старый finally также может снять pending нового read.

Требование: seq/actor/lifecycle проверять после всех await и перед каждым success/error/finally state update. Поздний отказ не меняет latest error/pending; late body не перетирает latest tasks/context. Детерминированные held GET regressions, включая отказ старого и успех нового. Отдельная небольшая коррекция.

### R4 [P2] — rename заново открывает отменённый draft

`task-row.tsx:72–83`, стабильный `key={task.id}` в `task-items-list.tsx`. Комментарий о remount при каждом открытии неверен: useState живёт в TaskRow, который при cancel остаётся смонтирован.

Browser repro: title=A → rename draft=B → Cancel → reopen rename. Поле содержит B, а не серверное A. То же состояние может устареть после чужого rename + refresh.

Требование: новое открытие инициализирует draft из актуального task.title; отказ сохранения сохраняет draft только в текущем editor. Browser regression cancel/reopen и внешнее изменение/reopen. Отдельная коррекция без переработки service.

### R5 [P2] — допустимые границы Upcoming приводят к исключению

`upcoming-board.tsx:136, 240–250`, `calendar.ts:109–118`.

Browser repro `/upcoming?start=2199-12-25` → enabled «Следующие 7 дней» → uncaught RangeError для 2200-01-01. Аналогичная нижняя граница. Более ранний start=2199-12-20 даёт допустимый next start=2199-12-27, но уже недопустимый end; render вычисляет его без guard. Pure `civilDateRange('2199-12-25',7)` тоже бросает: cursor сдвигается после последнего элемента за пределы, хотя [25..31] допустим.

Требование: проверять весь destination window до navigation; невозможные prev/next disabled + handler guard, без смены URL/state/uncaught errors. Range helper не шагает после последнего элемента. Регрессии обеих границ и последнего допустимого окна. Отдельная небольшая коррекция.

### R6 [P2] — timezone gates зависят от времени и принимают отказ вместо смены зоны

`tests/auth/tasks-planning.auth.test.ts:376`; `tests/e2e/planning.spec.ts:246–274`.

Независимый auth прогон после 00:00 UTC упал: UTC today и Moscow today одинаковы. Они не обязаны отличаться; тест проходит лишь в части суток. Требование сравнивать today с правильным local date из **собственного response.asOf** и response.timezone. Нужны как same-day, так и cross-day fixed-instant pure cases; реальный context/ownership/no task rewrite остаются API assertions.

Browser timezone-тест PATCH-ит Asia/Tokyo без Origin, проверяет только defined status (403 допускается), потом ожидает старый UTC today. Playwright timezoneId явно не задан. Восстановление тоже допускает 403. Так тест не доказывает account zone != browser zone.

Требование: явный browser timezoneId, валидный Origin и assert200, проверка новой зоны/context date/экранной метки, успешное восстановление в finally. Не менять системные часы и production clock API. Отдельная test-only коррекция.

### R7 [P2] — Today raw API не соблюдает контракт сортировки

`src/server/tasks/service.ts:138` возвращает только sort_order/created_at/id. Четыре section ranks и даты/time применяются только client helper.

Независимая API-проба: создать planned=today, затем planned=yesterday; GET view=today возвращает первую раньше второй. По контракту rank1 overdue должен идти перед rank2 today. Остальные date/time ordering условия в raw API также не применяются; сторонний клиент получит другое расписание.

Требование: единый контракт полного Today ordering service/API/UI (rank, planned date/time NULLS LAST, deadline date, stable triple), regression raw API order с перемешанными fixtures. Отдельная service/read-only коррекция; transactional writes не переделывать.

### R8 [P2] — редактор Inbox не показывает account timezone

`src/app/(workspace)/inbox/page.tsx:35–41`, `tasks-view.tsx:60`, `task-row.tsx:179–189`, `task-schedule-editor.tsx:106–159`. Inbox передаёт только today; timezone нет ни в TasksView props, ни в editor/подписи. Today/Upcoming показывают timezone экрана, но общий редактор Inbox её не знает. При зоне аккаунта, отличной от устройства, пользователь не видит, в какой зоне задаёт TIME label.

Требование: показывать актуальную server-derived account timezone у планировочного редактора во всех трёх views; refresh обновляет metadata, даты/time не переводятся в instant. Передавать metadata минимально, server settings persistence не менять. Отдельная небольшая UI-коррекция.

## Порядок коррекций и следующий handoff

Пользователь запретил огромные задания для GLM Flash. Этот report содержит полный результат review, **не разрешение исправлять всё одним запуском**. R1 snapshot/dirty-field data loss принят, reports/TASK-008-R1.md. R2 закрыт. R3 закрыт. R4 закрыт. R5 закрыт. R6 закрыт. R7 закрыт. R8 product fix закрыт; test finally cleanup закрыт на 34998ae; остаётся auth expiry fixture (reports/TASK-008-FINAL.md). Cleanup FINAL принят на 34998ae; full auth красный из-за SQL timezone fixture. Сейчас назначен только `TASK-008-FINAL-EXPIRY`: test-only correction. Усиление синхронизации R3 regression выполнено на 54780f1. После FINAL — независимая итоговая приёмка; TASK-009 пока не назначен. Полные auth/E2E gates требуются перед финальной приёмкой всего TASK-008, а не после каждой отдельной правки.

Продуктовые R1–R8 закрыты; Cleanup закрыт на 34998ae; auth expiry fixture/full auth gate и итоговая приёмка остаются. Обновить executor evidence после исправлений: lint warnings, cumulative diff check, реально проверенная timezone, debug traces. Ни TASK-008 DONE, ни TASK-009 не разрешены. Merge/push/deploy отсутствуют.

## Локальная интеграция — DONE, 2026-10-12

Executor237f711018efdb8d299428f5390a6e870096afe5, review commit e87d3d6d5d717267023d669d00e962e1b4f45fdc; no-ff merge **8ec706867efb75f2b316d66a876622a1df38ed79** в чистую main, без конфликтов. `git diff --exit-code task/TASK-008 HEAD` после merge — exit0: дерево интеграции полностью идентично независимо проверенному task-tree. Затем на main Node24 lint/typecheck/69unit PASS. DB/auth/E2E/no-env gates не повторялись после merge: исходники/tests/config/package/lock идентичны, изменения после merge только coordinator docs. Независимые gates на237f711: 69unit/47DB/124auth/123browser/no-env build PASS, auth UTC/Moscow matrix PASS; ресурсы0/0 и временные кластеры/копия удалены.

TASK-008 DONE. PG17 не проверен финальным проходом; реальные устройства/proxy/deployment не проверены. Push/deploy отсутствуют, user env не изменялся; TASK-009 не назначен. Следующее задание должно быть небольшим самостоятельным результатом из исходного пакета TASK-009.
