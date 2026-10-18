# TASK-008 — отчёт исполнителя (GLM)

## Статус

READY_FOR_REVIEW.

## Исходное состояние (проверено до изменений)

- Worktree `/Users/atlhnv/Codex/orbit-worktrees/TASK-008`; ветка `task/TASK-008`; дерево чистое.
- База review `394aef441a05d95969596bf088b37fb1f087432e` (принятый TASK-007); **starting SHA: `9a81313bb498fd1e584b14a0bc2b87b506102c6b`** (assignment, единственный над базой).
- Runtime: **Node v24.21.0 / npm 11.19.0 из `/tmp/orbit-node24/node-v24.21.0-darwin-arm64/bin`** (системный Node 26 не использовался для gates). npm ci exit 0, lockfile неизменен; новых зависимостей нет (Intl + чистая арифметика).
- PostgreSQL Orbit loopback 55432; localhost:3000/CRM/main не затрагивались; `.env` untracked (значения не выводились).

## Этап A — pure calendar contracts

- `src/lib/calendar.ts` (новый): `parseCivilDate` — строгая `YYYY-MM-DD`, существующий Gregorian день, диапазон 1900-01-01..2199-12-31 (1900/2100 не leap, 2000 leap; whitespace/coercion/ISO timestamp/offset/пустая строка/не-строка → invalid); `parseCivilTime` (`HH:mm` 00:00..23:59, без seconds/offset/Z); `normalizeCivilTime` (PG `HH:mm:ss` → API `HH:mm`); `addCivilDays`/`civilDateRange` — **civil**-дни (не 86400000 к instant), RangeError за границами; `instantToLocalDate` — explicit IANA zone через Intl (gregory/latn, кэш форматтеров, fail-closed RangeError на невалидной зоне/не-цифрах), независимость от `process.env.TZ` доказана тестом; `formatCivilDateDisplay` (DD.MM.YYYY перестановкой строк — без Date, без сдвига дня).
- `src/lib/task-view.ts` (новый): `todaySectionOf`/`groupTodayTasks` — 4 взаимоисключающие секции (plan<today → plan=today → deadline<today → deadline=today), каждая task максимум одна секция; сортировки: секция1 plannedDate+time NULLS LAST, секция2 time NULLS LAST, секция3 deadlineDate, секция4 — стабильный вход; `groupUpcomingTasks` — инклюзивный [start..end], 7 групп включая пустые, time NULLS LAST внутри группы.
- `src/lib/tasks.ts` расширены: `TASKS_MAX_JSON_BODY_BYTES=4096` (task-specific константа; Settings/Projects/DELETE — прежние 2 KiB), `parseTaskCreate` ({title} + опциональные planning; time без date → field=plannedTime), `parseTaskPatch` (subset title/completed/plannedDate/plannedTime/deadlineDate; null только schedule), `parseTaskCollectionViewQuery` (view/status/start; дубликаты/чужие keys → invalid; start только upcoming; start+6 вне диапазона → invalid), `TaskDTO` расширен additive (plannedDate/plannedTime/deadlineDate), `toTaskDTO`.

Тесты: `tests/calendar-view.test.ts` (новый, 25) + расширение `tasks-validation`/`workspace-pages`. Unit suite: **63** (прежде 44; все прежние сохранены).

## Этап B — service/API/context

- `src/server/tasks/service.ts`: `listTasksView(actorId, view, status, today, startDate?)` — рабочие view-фильтры (root one-off non-deleted, project NULL/свой активный — прежний invariant), Inbox `planned_date IS NULL`, Today union `(planned<=today OR deadline<=today) AND (planned NOT NULL OR deadline NOT NULL)`, Upcoming `planned_date BETWEEN start AND start+6` + сортировка planned_date/time NULLS LAST/stable; `createTask` принимает planning; `mutateTask` — merge под task→project row locks: результирующие значения вычисляются под блокировкой, **очистка плана автоматически очищает time** (явное время при `plannedDate:null` → validation field=plannedTime; time при отсутствии даты → 400), deadline независим, **только реально изменённые поля** в UPDATE, revision+1 на effective mutation, no-op без записи (HH:mm vs HH:mm:00 нормализуется), journal/completion/soft-delete/409/404 семантика TASK-007 сохранена.
- `src/server/tasks/context.ts` (новый, server-only): `getTasksReadContext` — timezone из `getAccountSettings` (default UTC, без INSERT), **один** `SELECT current_timestamp` на read → `asOf` ISO + `today` civil date этого instant в зоне actor.
- Routes: GET коллекции — единый ответ `{tasks, context:{timezone,today,asOf,view,startDate?,endDate?}}`; POST/PUT PATCH — `readJsonBodyWithLimit(request, TASKS_MAX_JSON_BODY_BYTES)`; item PATCH маппит `validation` outcome в 400 field.

Тесты: `tests/auth/tasks-planning.auth.test.ts` (новый, 22): defaults/точность DTO+DB (PG TIME с секундами), границы дат/времени, 500-emoji+schedule в 4 KiB / >4KiB 413, неизвестные поля, context UTC без settings INSERT, timezone смена (Europe/Moscow) переписывает today без изменения сохранённых дат, query-матрица 400, full planned×deadline матрица Today (один ID, секции по контракту), Upcoming инклюзивность/диапазон, merge-кейсы (set/clear/no-op/combined/конкурентные title-vs-schedule и complete-vs-schedule — оба сохранены), невалидный merge без изменений task/journal. Прежние tasks.auth адаптированы (context в ответе, 4KiB threshold, поля DTO).

## Этап C — UI

- Общие компоненты: `task-row.tsx` (строка: title текст, бейджи plan/deadline с overdue/today, completion toggle, rename editor, schedule editor, delete confirmation; **id `task-row-<id>`** на li), `task-schedule-editor.tsx` (дата/время/дедлайн; disabled time без даты; очистка даты чистит draft time; **dirty-only Save** — no-op Save disabled; Escape/cancel; pending блокирует ввод), `task-items-list.tsx` (global busy), `use-task-writes.ts` (единый хук мутаций: in-flight guards, R1 read-handling — onConfirmed false → listError, не failed write; R2 — открытие editor/confirmation заблокировано при любом in-flight; фокус: success → `task-<kind>-trigger-<id>` если строка в DOM, иначе createFocusElementId; failure → editor input/«Отмена»/toggle; lifecycle/actor guards + программный фокус с повторами, отменяемый по nonce/unmount/смене actor).
- Экраны: Inbox (+«Планирование», «Обновить», read-error/retry); Today (`today-board.tsx` — секции из pure-хелпера, quick-add с `plannedDate=context.today`, completed-режим с нейтральными заголовками, Обновить); Upcoming (`upcoming-board.tsx` — prev/next/current с диапазоном в URL через replaceState, группы 7 дней, invalid start — явная ошибка на SSR). TasksView переработан на shared-компоненты (не дублирует 700 строк).

## Исправления по review Codex WIP `2861969`

1. **DOM id в focusAfterSuccess**: проверка `task-row-<id>` не находила элемент (li имел только `data-task-id`) → фокус всегда уходил на create-input; шаблон `${kind}-trigger-` не совпадал с реальными `task-<kind>-trigger-`. Исправлено: `id={task-row-<id>}` на li + `task-${kind}-trigger-${taskId}`.
2. **renameError boolean-проверка**: `state.renameError !== null` всегда true (boolean ≠ null) → параграф ошибки рендерился в каждой строке безусловно. Исправлено на truthiness.
3. **Проглатывание таймаута**: `.catch(() => null)` на `waitForResponse` в planning-тесте удалял диагностику «PATCH не отправлен». Убрано; падение теперь громкое.
Дополнительно: удалены все отладочные PROBE/DBG-логи; освобождение gate в «failed schedule» перенесено до ожидания ответа (тестовый дедлок снят).

## Проверки (Node v24.21.0 / npm 11.19.0 — /tmp/orbit-node24)

| Команда | Результат |
| --- | --- |
| `npm ci` | exit 0, lockfile неизменен |
| `npm run lint` / `npm run typecheck` | exit 0 / exit 0 (strict), без warnings |
| `npm test` | exit 0 — **63 passed** (44 прежних + 25 календарных − адаптации) |
| `npm run test:db` | exit 0 — **47 passed** |
| `npm run test:auth` №1 / №2 (последовательно, после всех фиксов) | exit 0 — **123/123** оба; 0 lifecycle-паттернов |
| Падающие сценарии вместе (`inbox.spec` + `planning.spec`) ×2 | exit 0 — **25/25** оба |
| `CI=1 E2E_PORT=3327` / `3328` (последовательно) | exit 0 — **94/94** оба (83 + 11 planning); 0 lifecycle-паттернов |
| `npm run build` без `.env` | exit 0; /api/v1/tasks, /today, /upcoming, /inbox ƒ Dynamic |
| Real `next dev` StrictMode probe (порт 3330, unique DB) | `DEV-SCHEDULE-SUCCESS` (PATCH ok, задача уходит из Inbox) → `DEV-SCHEDULE-FAILURE` (500, draft/error видимы) → `DEV-SCHEDULE-RETRY` (PATCH ok) → **DEV CHECK PASS**; side effects возвращены, leftover 0 |
| Leftovers после всех прогонов | orbit_test\*-баз: **0**; `git diff --check` чист |

Флейк-расследование (по требованию Codex, trace/DOM-доказательства): корневые причины — перечисленные id/boolean-дефекты; версия о «задержке React-коммита» **не подтвердилась** — после исправления id все фокус-сценарии стабильны без увеличения циклов ожидания (retry-механизм фокуса сохранён как страховка, но не является причиной зелёного).

## Известные ограничения / не проверено

- Реальные устройства/production proxy/deployment не проверялись; DST-gap время (02:30) — допустимый wall-clock label без будильников (по контракту).
- Midnight-таймер/realtime sync отсутствует: today обновляется на read/reload/«Обновить» (по контракту).
- Постоянного dev-mode suite нет; live dev процедура описана и выполнена (evidence выше).
- npm audit не пересчитывался (новых зависимостей нет); limiter single-process; прежние tooling-ограничения действуют.
- Upcoming timezone-метки: `today`-маркер группы по server context; месяц/год/DST-переходы покрыты pure-тестами addCivilDays/instantToLocalDate, browser-проверка навигации через диапазон в URL.

## Git

- Ветка `task/TASK-008`, worktree `/Users/atlhnv/Codex/orbit-worktrees/TASK-008`.
- Starting SHA `9a81313bb498fd1e584b14a0bc2b87b506102c6b`; коммиты: WIP `28619690ee11150e6321388ccd628a177d15e885` (реализация трёх фаз) + финальный фикс-коммит (три замечания Codex + README + этот отчёт); latest full SHA сообщён после commit.
- Merge/push/amend/rebase/reset/stash не выполнялись; main/старые worktree/localhost:3000/CRM/VPN/coord docs не менялись; secrets только в untracked `.env`.

## Итог

TASK-008 реализован по phases A/B/C (civil calendar, atomic planning merge + context API, shared editor/rows + Today/Upcoming). Все gates зелёные на Node 24. Остановка до независимого review Codex; TASK-009 не начинался.

---

# Коррекция TASK-008-R1 — snapshot планировочного редактора

## Статус

READY_FOR_REVIEW (только R1 [P1] из `reports/TASK-008.md`; R2–R8 не затронуты). Assignment `tasks/TASK-008-R1.md`; старт correction — coordinator review commit `f56cecc0bf42441b6b2c39c4bd0f6b91df21c36b` (HEAD проверен перед изменениями, дерево чистое).

## Дефект и исправление

`TaskScheduleEditor` сравнивал draft с «живым» prop snapshot (обновляемым refetch'ем при открытом редакторе): после чужого PATCH + «Обновить» Save отправлял `deadlineDate:null` и стирал чужую запись. Исправление (`src/components/orbit/task-schedule-editor.tsx`): snapshot фиксируется в `useState` на момент конкретного открытия (редактор монтируется только пока открыт); dirty-вычисление и PATCH-ключи считаются **только** от этого frozen snapshot. Сохранены контракты: очистка даты чистит time (draft+PATCH), no-op Save disabled, failed save сохраняет draft, Cancel/reopen берёт свежий snapshot из актуального task, публичные API не менялись. `task-row.tsx` правки не потребовал.

## Browser-регрессии (tests/e2e/planning.spec.ts, новый describe «Planning editor snapshot (R1)»)

1. **refresh+Save**: задача plan/time/deadline NULL → editor, меняется только plannedDate → второй клиент (тот же аккаунт C, независимый APIRequestContext, правильный Origin) пишет deadline=D → «Обновить» с ожиданием фактического GET; editor открыт, draft жив, поле дедлайна показывает snapshot открытия → Save: тело настоящего PATCH (200) содержит ровно `["plannedDate"]` → GET item: plannedDate=future, plannedTime=null, **deadline=D сохранён**; editor закрыт, задача ушла из Inbox.
2. **Cancel/reopen**: тот же сценарий до Save → «Отмена» → новое «Планирование»: deadline подставлен из актуального task, отменённый draft даты не воскресает, Save disabled (no-op PATCH невозможен).
3. **Симметричный time**: правка только deadline в Upcoming, второй клиент ставит plannedTime=10:00 → refresh → Save: PATCH ровно `["deadlineDate"]`, GET item: время 10:00 сохранено, дедлайн записан.

## Проверки (Node v24.21.0 — /tmp/orbit-node24)

| Команда | Результат |
| --- | --- |
| `npm run lint` | exit 0, **1 warning** — оставшийся известный `use-task-writes.ts:325` (файл вне R1 scope, не правил); warning `planning.spec.ts:169` (unused today) устранён в рамках правки этого файла |
| `npm run typecheck` | exit 0 |
| `npm test` | exit 0 — 63/63 |
| `CI=1 E2E_PORT=3421 npm run test:e2e -- tests/e2e/planning.spec.ts --project=chromium` (штатный `next build` + server) | exit 0 — **16/16** (13 прежних планировочных + 3 новых R1; auth-setup project включён) |
| Leftovers | orbit_test\*-баз: 0, соединений: 0 (read-only проверка) |
| `git diff --check` (unstaged R1-изменения) | чисто |

Процедурная находка: первый прогон R1-тестов падал на **устаревшем** production-билде (`npx playwright test` без `next build` отдал предыдущий `.next`); оба падения в точности воспроизводили старое поведение и после штатного `npm run test:e2e` (build включён) не воспроизводятся. В отчёт включено как свидетельство, что регрессия ловит дефект.

## Ограничения / не входило

- R2–R8 не исправлялись; full auth/E2E прогон не выполнялся (по заданию — перед итоговой приёмкой TASK-008). Известный R6 auth timezone failure остаётся открытым.
- Debug-остатки в тестовых файлах (inbox.spec PROBE-листенеры, «R3 DEBUG», navigation OVERFLOW) и EOF-пустые строки в task-row.tsx / tasks-planning.auth.test.ts из review — чужие для R1 файлы, не тронуты (отдельная финальная уборка).
- Trace `'on'` в playwright.config оставлен как был; main/старые worktree/localhost:3000/CRM/coord docs/protective hooks не менялись; merge/push/amend/rebase/reset/stash не выполнялись.

---

# Коррекция TASK-008-R2a — один task write в полёте

## Статус

READY_FOR_REVIEW (только R2a: общий guard create/row writes; R2b editor/mode переходы, R3–R8 не затронуты). Assignment `tasks/TASK-008-R2a.md`; R1 принят на `3b3688ad66845dc80216105bb20d85375293592e`; старт — coordinator commit `73c65492b9405707572a8ec39fb482490d37318e` (root/HEAD/status проверены, дерево чистое, чужих изменений нет).

## Дефект и исправление

Create имел собственный `createInFlight`, невидимый shared writes-hook: удержанный POST quick-add не блокировал row controls — уходил второй (PATCH) write. Исправление — общий guard, без переписывания экранов:

- `src/components/orbit/use-task-writes.ts`: `TaskWriteKind` расширен `create`; новые `beginCreate()` (синхронная проверка общего in-flight set + регистрация ДО fetch, возвращает false при любом pending write) и `endCreate()` (снятие в finally экрана; ref чистится всегда); реактивный `anyPending` (create|rename|toggle|schedule|delete) для disabled; `create.pending/begin/end` в возвращаемом объекте. Попутно точечно устранён известный lint warning: неиспользуемый `focusElement` удалён, в deps `submitDelete` возвращён реально используемый `requestFocus` (поведение фокуса не менялось).
- `src/components/orbit/task-items-list.tsx`: `globalBusy` включает `writes.create.pending` → row controls disabled во всех строках при удержанном create.
- `src/components/orbit/tasks-view.tsx` и `today-board.tsx`: `handleCreate` регистрирует create через `writes.create.begin()` синхронно до `fetch` (после parse — невалидный черновик guard не занимает), снимает в `finally` через `end()`; create input/submit `disabled={writes.anyPending}` — заблокированы и при своей, и при чужой pending записи.

Синхронные handler guards row writes уже стояли первыми строками каждого submit*/open* (`anyInFlight()`), теперь они видят create; программный обход disabled невозможен. Контракты сохранены: idle editor держит draft (чужая pending его не стирает), write-response/read-error distinction (confirmed write + failed read = read error/retry), focus policy, actor/unmount/StrictMode suppression, GET-only retry. Upcoming row writes идут через тот же shared hook/list без изменений файла (create UI там нет); status/window переключения не трогались (R2b).

## Browser-регрессии (tests/e2e/write-guard.spec.ts, новый, 3 теста, user C)

1. **Inbox, held POST**: удержанный route'ом POST quick-add → create input/submit и все row controls disabled; force-click «Завершить»/«Планирование» и программный `form.requestSubmit()` не отправляют PATCH/DELETE/второй POST (счётчики route-наблюдателей = 0; editor не открыт). Release 500 → create error виден, черновик сохранён, контролы вновь enabled → retry успешно создаёт задачу.
2. **Inbox, held schedule PATCH**: валидный create-черновик заранее → удержанный PATCH editor'а → create input/submit disabled; программный `requestSubmit()` (мимо disabled кнопки) и force-click не отправляют POST (postCount=0). Release 500 → schedule error, guard снят, create доступен → повторный «Сохранить» проходит (PATCH 200), editor закрыт, задача ушла из Inbox.
3. **Today, held POST**: короткий вариант №1 — row controls disabled, force-toggle без PATCH, отказ снимает guard, черновик сохранён, retry работает.

Минимальная адаптация существующего теста `tests/e2e/inbox.spec.ts` (R3b, последняя фаза): мгновенное чтение `document.activeElement` после `toHaveCount(0)` заменено на авто-ретраящий `await expect(page.locator("#task-title-input")).toBeFocused()` — по требованиям R2a create input законно disabled до конца write flow, поэтому фокус landится через кадр после снятия pending (тот же ассерт, та же цель, корректная синхронизация вместо гонки).

## Проверки (Node v24.21.0 — /tmp/orbit-node24; окружение: Colima OFF, 55432 недоступен)

| Команда | Результат |
| --- | --- |
| Состояние test DB | Colima not running, `nc 127.0.0.1 55432` closed; dev DB не использовалась и не менялась |
| Временный test PostgreSQL | **PostgreSQL 18.6 (Homebrew)**, отдельный кластер `/private/tmp/orbit-pg-r2a-*`, `initdb -U orbit_tmp -A scram-sha-256`, эфемерный пароль (0600-файл), listen 127.0.0.1 на свободном порту 37100; TEST_DATABASE_URL только через env (перекрывает .env), namespace `orbit_test` |
| `npm run lint` | exit 0, **0 warnings** (известный warning hook'а устранён точечно в рамках R2a) |
| `npm run typecheck` | exit 0 |
| `npm test` | exit 0 — 63/63 |
| `CI=1 E2E_PORT=3521 npm run test:e2e -- write-guard+inbox+planning --project=chromium` (штатный `next build`) | 30 passed + 1 failed: R3b inbox — гонка мгновенного чтения фокуса (см. адаптацию выше); product-дефект не подтверждён (фокус landится, кадром позже) |
| `CI=1 E2E_PORT=3522 npx playwright test` (тот же билд, после адаптации теста) | exit 0 — **31/31**: 3 auth-setup + **3 write-guard** + **12 inbox** (включая pending-complete/R3b) + **13 planning** (включая 3 R1-регрессии) |
| Leftovers после прогонов | read-only check на временном инстансе: **0** orbit_test\*-баз; `git diff --check` чист |
| Очистка окружения | `pg_ctl stop` — server stopped; кластер, парольный и env-файлы удалены; порт закрыт; сторонние сервисы не поднимались, dev DB не тронута |

## Ограничения / не входило

- R2b (единственный активный editor, mode/window переключения при pending), R3–R8 — не тронуты; full auth/E2E не гонялись (R6 открыт отдельно). Frozen snapshot R1, service/API/schema/auth/read context не менялись.
- Проверка на целевом PostgreSQL 17 (55432/Colima) в этом запуске невозможна — сервис выключен не мной; целевой E2E выполнен на временном PG 18.6 (как и независимый review R1).
- Debug-остатки в inbox.spec (PROBE-листенеры, «R3 DEBUG») и EOF-пустые строки task-row.tsx/tasks-planning.auth.test.ts — не R2a, не тронуты.
- main/другие worktree/localhost:3000/CRM/coord docs/hooks не менялись; merge/push/amend/rebase/reset/stash/деплой не выполнялись. R2/TASK-008 целиком НЕ приняты — только эта коррекция на review.

---

# Коррекция TASK-008-R2a-fix — блокировка уже открытой формы

## Статус

READY_FOR_REVIEW (только остаток R2a [P2] из `reports/TASK-008-R2a.md`; R2b–R8 не начаты). Assignment `tasks/TASK-008-R2a-fix.md`; R2a executor HEAD `9932004481c48dcd9429a102c7b5854987029f08`; старт — coordinator commit `b20c761f398a01ea4c89df7c9d8b2138d2ab70dd` (root/ветка/status проверены, дерево чистое).

## Дефект и исправление

Открытые формы блокировались только собственной pending: TaskScheduleEditor получал `pending=schedulePending` (при чужом create — false), rename и delete confirmation использовали own-pending в disabled/Escape, а close handlers проверяли только свой pending. Исправление:

- `src/components/orbit/task-row.tsx`: rename form (input/Save/Cancel/Escape) и delete confirmation (confirm/«Отмена»/Escape) переведены на `state.busy` (общий busy экрана; собственный pending входит в него), собственные pending labels («Сохранение…», «Удаление…») сохранены без изменений; schedule editor получает новый `blocked={state.busy}`.
- `src/components/orbit/task-schedule-editor.tsx`: минимальный `blocked` prop — `locked = pending || blocked` для controls/Save/Cancel/Escape и синхронного handler-блока в `handleSubmit`; `aria-busy` и label «Сохранение…» остаются только на собственной `pending` (чужая write не изображает свою операцию). Draft, error и frozen snapshot R1 не тронуты.
- `src/components/orbit/use-task-writes.ts`: `closeRename/closeSchedule/closeDelete` — синхронный общий guard `anyInFlight()` вместо проверки только своего pending (ref покрывает и собственный полёт; снимается в finally). Программный вызов cancel при чужой записи не закрывает форму даже до нового render; существующие pre-fetch submit guards сохранены. Заодно ушли eslint-disable от старых deps.

Выбор единственного editor, mode/window переключения, read flow, transport/service/schema — не менялись.

## Регрессии (tests/e2e/write-guard.spec.ts, +2 теста)

1. **Открытый dirty schedule editor при чужом held POST** (delivery через `expect.poll`): дата/Save/Cancel/create disabled; «Сохранение…» отсутствует; программный `requestSubmit()` формы и `dispatchEvent('click')` по «Отмене» не отправляют PATCH и не закрывают editor; release 500 → блокировка снята, editor открыт, draft прежний → настоящее Save успешно (PATCH 200, задача ушла из Inbox).
2. **Таблица rename + delete confirmation при чужом held POST**: обе формы заблокированы (input/Save/Отмена, confirm/«Отмена» disabled, собственные labels отсутствуют); программные submit/cancel (evaluate requestSubmit + dispatchEvent) — 0 PATCH/DELETE, формы не закрыты; release 500 → controls enabled, rename draft сохранён; обычная отмена после отказа работает.

## Проверки (Node v24.21.0 — /tmp/orbit-node24)

| Команда | Результат |
| --- | --- |
| Состояние test DB | В начале запуска Colima была выключена (55432 closed) — по заданию поднят временный PostgreSQL **18.6** (Homebrew, /private/tmp, ephemeral password); при проверке обнаружено, что Colima вернулась в running, 55432 доступен: временный инстанс остановлен до тестов и удалён, тесты выполнены на штатном guarded target — **PostgreSQL 17.11**, leftover orbit_test\* до прогона: 0 |
| `npm run lint` | exit 0, 0 warnings |
| `npm run typecheck` | exit 0 |
| `npm test` | exit 0 — **63/63** |
| `CI=1 E2E_PORT=37200 npm run test:e2e -- write-guard+inbox+planning --project=chromium` (штатный `next build`) | 32 passed + 1 failed: мой новый таблица-тест — тестовый дефект локатора (открытый rename editor заменяет title-параграф формой, `hasText`-локатор строки перестаёт матчиться); product-дефекта нет. Исправлено на id/`data-task-id`-локаторы |
| `CI=1 E2E_PORT=37221 npx playwright test write-guard --project=chromium` | exit 0 — 8/8 (3 auth-setup + 5) |
| `CI=1 E2E_PORT=37222 npx playwright test write-guard+inbox+planning --project=chromium` (тот же свежий билд) | exit 0 — **33/33**: 3 auth-setup + **5 write-guard** (3 прежних + 2 новых) + 12 inbox (pending-complete/R3b) + 13 planning (R1-регрессии) |
| Leftovers | read-only check на 55432 после прогонов: **0** orbit_test\*-баз; `git diff --check` (unstaged) чист |

## Ограничения / не входило

- R2b (единственный активный editor, mode/window), R3–R8, старая отладка в inbox.spec, EOF-уборка (task-row.tsx:311, tasks-planning.auth.test.ts:746 остаются от прежних коммитов) — не тронуты. Full auth/E2E сейчас не требовались (R6 открыт).
- Frozen snapshot R1, общий guard R2a, transport/service/schema/read context — сохранены без переработки.
- Временный PG18.6: поднят и остановлен без тестовых прогонов на нём (Colima вернулась); пароль/кластер удалены, порт закрыт. main/другие worktree/localhost:3000/CRM/hooks не менялись; merge/push/amend/rebase/reset/stash/деплой не выполнялись. R2/TASK-008 целиком не объявляются принятыми — только эта коррекция на review.

---

# Коррекция TASK-008-R2b1 — одна активная форма задачи

## Статус

READY_FOR_REVIEW (первая малая часть R2b: единственная открытая rename/schedule/delete форма; mode/window политика — будущий R2b2, R3–R8 не начаты). Assignment `tasks/TASK-008-R2b1.md`; R1 и R2a (с R2a-fix) приняты на executor HEAD `437e5a26a07ccec87dd4624354b13e39563a8edd`; старт — coordinator commit `a8b64194ac10f87e47c6dcf82d66fe28b76bff44` (root/ветка/status проверены, дерево чистое).

## Дефект и исправление

Hook хранил независимые editor ids: открытие schedule Q при открытом rename P оставляло оба состояния, переключение типа формы одной строки могло скрыть dirty draft прежней. Исправление — локальный механизм синхронного выбора формы:

- `src/components/orbit/use-task-writes.ts`: новый `activeFormRef` ({kind, taskId} | null) — НЕ state: guards синхронны и работают до render. `openRename/openSchedule/openDelete` — отказ при любой активной форме (другой тип/задача) и no-op при повторном открытии той же (ошибка/draft не сбрасываются: ранний return до setRenameError/setScheduleErrorTaskId); старая форма не закрывается, фокус не переносится. `closeRename/closeSchedule/closeDelete` и success-ветка `submitDelete` (confirmation закрывается сам, без closeDelete) освобождают ref синхронно — без залипания; отказ сохранения ref не трогает (форма остаётся активной). Общий сетевой guard R2a, focus policy, actor/unmount/StrictMode suppression не менялись.
- `src/components/orbit/task-items-list.tsx`: `anyFormOpen` (любой из rename/schedule/delete taskId) → новый `formOpen` в TaskRowState.
- `src/components/orbit/task-row.tsx`: form-триггеры (Переименовать/Планирование/Удалить) `disabled={state.busy || state.formOpen}`; «Завершить» (write, не форма) — по-прежнему только `busy`. Открытые формы блокируются только write-busy (R2a-fix), открытие формы само по себе их не блокирует.

Quick-add при открытой idle форме допустим (как и прежде); frozen snapshot R1, service/API/schema, read flow — не тронуты.

## Регрессии (tests/e2e/write-guard.spec.ts, 5 → 7 chromium-тестов)

1. **Новый: одна активная форма** — dirty schedule P: form-триггеры строки Q disabled («Завершить» доступен); программные dispatchEvent-открытия rename/schedule/delete на Q отказаны на handler-уровне (формы не открыты, draft P цел); Cancel P → rename Q открывается обычным кликом → Cancel Q → schedule P снова открывается (переключение только через Cancel/Save).
2. **Новый: failed Save сохраняет активный выбор** — удержанный PATCH 500: P/error/draft сохранены; попытки открыть rename Q отказаны и во время полёта, и после отказа (триггер disabled + handler guard); успешный Save P освобождает выбор — rename Q открывается.
3. **Рабочий R2a таблица-тест переведён на последовательные фазы** (rename-фаза, закрытие, delete-фаза) с сохранением всех assertions: disabled controls, отсутствие собственных labels («Сохранение…»/«Удаление…»), программные requestSubmit/dispatchEvent bypass без PATCH/DELETE и без закрытия форм, сохранность draft, re-enable после отказа POST, обычная отмена. Это адаптация к новой policy, не ослабление. Gate POST-маршрута перезаряжаемый (две фазы), delivery через `expect.poll`.

## Проверки (Node v24.21.0 — /tmp/orbit-node24)

| Команда | Результат |
| --- | --- |
| Состояние test DB | Штатный PG17 доступен всю сессию: `nc 127.0.0.1 55432` open; read-only check: **PostgreSQL 17.11**, leftover orbit_test\* до: 0; Colima/CRM/сторонние сервисы не запускались и не останавливались, credentials не выводились |
| `npm run lint` | exit 0, 0 warnings |
| `npm run typecheck` | exit 0 |
| `npm test` | exit 0 — **63/63** |
| `CI=1 E2E_PORT=37240 npm run test:e2e -- write-guard+inbox+planning --project=chromium` (штатный свежий `next build`) | exit 0 — **35/35** с первого прогона: 3 auth-setup + **7 write-guard** (3 R2a held-write + 2 R2a-fix open-form + 2 новых R2b1) + 12 inbox (pending-complete/R3b) + 13 planning (R1-регрессии) |
| Leftovers | read-only check после прогонов: **0** orbit_test\*-баз; `git diff --check` (unstaged) чист |

## Ограничения / не входило

- Mode/status/window переключения при открытой форме (R2b2), R3 (read sequencing), R4 (rename draft reinit), R5–R8, старая отладка и EOF-уборка (task-row.tsx:317, tasks-planning.auth.test.ts:746) — не тронуты. Full auth/E2E сейчас не требовались.
- Общий сетевой guard R2a/R2a-fix и frozen snapshot R1 сохранены без переработки; service/API/schema не менялись.
- main/другие worktree/localhost:3000/CRM/hooks не менялись; merge/push/amend/rebase/reset/stash/деплой не выполнялись; secrets не коммитились. R2/TASK-008 целиком не объявляются принятыми — только эта коррекция на review.

---

# Коррекция TASK-008-R2b2 — безопасная смена режима в Upcoming

## Статус

READY_FOR_REVIEW (только Upcoming: status/диапазон не меняются при pending записи или открытой форме; Inbox/Today не менялись, R3–R8 не начаты). Assignment `tasks/TASK-008-R2b2.md`; R1/R2a/R2b1 приняты на executor HEAD `c68d3a88a884ea6f3d3eda90a03a86cfc1d31429` (review `reports/TASK-008-R2b1.md`); старт — coordinator commit `4d81b7a651018d938ca3115c152bb63c94f27204` (root/ветка/status проверены, дерево чистое).

## Дефект и исправление

Кнопки status open/completed/all в Upcoming не имели ни disabled, ни handler guard: смена режима при pending write оставляла старый write callback читающим старый режим, а при открытой форме скрывала её с сохранённым выбором. prev/next/current имели только `listPending || anyInFlight()`. Исправление:

- `src/components/orbit/use-task-writes.ts` (минимально): наружу выставлены реактивный `formOpen` (любой rename/schedule/delete taskId — для disabled) и синхронный `anyFormOpen()` (чтение `activeFormRef` — для handler guard до render/state). Существующие guard'ы/policy не менялись.
- `src/components/orbit/upcoming-board.tsx`: новый `switchMode(mode)` — синхронный guard `writes.anyInFlight() || writes.anyFormOpen()` ДО `setStatusMode/refetch`; кнопки status `disabled={writes.anyPending || writes.formOpen}`. `navigate()` — в guard добавлен `anyFormOpen()` (ref) поверх прежнего `listPending || anyInFlight()`; prev/next/current `disabled={listPending || writes.anyPending || writes.formOpen}` (прежняя listPending-политика сохранена). Заблокированная попытка не меняет URL/start/status и не стартует GET; форма не закрывается, draft/error целы. Refresh/retry не перерабатывались; sequencing чтений (R3) и calendar bounds (R5) не тронуты — guard стоит до вычисления нового диапазона.

Pending guard держится весь mutation+read flow (anyInFlight/finally — как принят в R2a); failed Save оставляет форму и mode lock, Cancel/успешный Save освобождают; toggle без формы освобождается обычным finally.

## Регрессии (tests/e2e/write-guard.spec.ts, 7 → 9 chromium-тестов)

1. **Upcoming, удержанный completion PATCH** (delivery `expect.poll`): status open/completed/all и prev/next/current disabled; программные dispatchEvent «Все»/«Следующие 7 дней» не меняют mode (aria-pressed), URL и не стартуют GET (счётчик GET=0); release 200 → штатный read текущего open-режима (GET>0), controls вновь enabled, обычная смена на «Все» работает (pressed, задача видна). Примечание: PATCH fulfill'ится синтетически — сервер его не получает, поэтому ассерт «задача ушла из open» некорректен и не делается (в отчёте ниже — первый failed run).
2. **Upcoming, dirty schedule editor**: status/диапазон disabled при открытой форме; bypass не закрывает editor, draft цел, URL/GET не меняются; Save с удержанным 500 оставляет editor/error/mode lock; Cancel освобождает выбор и controls, «Следующие 7 дней» затем работает (range/URL изменились). Обычные даты, calendar bounds не затрагивались.

## Проверки (Node v24.21.0 — /tmp/orbit-node24)

| Команда | Результат |
| --- | --- |
| Состояние test DB | `nc 127.0.0.1 55432` open; read-only: **PostgreSQL 17.11**, leftover orbit_test\* до: 0; Colima/CRM/сторонние сервисы не запускались и не останавливались; credentials не выводились |
| `npm run lint` | exit 0, 0 warnings |
| `npm run typecheck` | exit 0 |
| `npm test` | exit 0 — **63/63** |
| `CI=1 E2E_PORT=37270 npm run test:e2e -- write-guard+inbox+planning --project=chromium` (свежий `next build`) | 36 passed + 1 failed: мой новый тест №1 — дефект шаблона маршрута `**/api/v1/tasks*` (не матчит item-URL `/tasks/<uuid>` из-за слэша за `*`), PATCH уходил мимо hold прямо на сервер, `expect.poll(patchCount)` не дождался. Тестовый дефект, не продукта; исправлено разделением на GET-наблюдателя `**/api/v1/tasks*` + hold `**/api/v1/tasks/*` |
| `CI=1 E2E_PORT=37292 npx playwright test write-guard --project=chromium` | 11 passed + 1 failed: после фикса маршрута — мой неверный ассерт `toHaveCount(0)` после release (задача остаётся в open-виде, т.к. fulfill синтетический); ассерт удалён с пояснением |
| `CI=1 E2E_PORT=37293 npm run test:e2e -- ... --project=chromium` (свежий `next build`, финальный) | exit 0 — **37/37**: 3 auth-setup + **9 write-guard** (7 прежних + 2 новых R2b2) + 12 inbox (pending-complete/R3b) + 13 planning (R1-регрессии) |
| Leftovers | read-only check после прогонов: **0** orbit_test\*-баз; `git diff --check` (unstaged) чист |

## Ограничения / не входило

- Inbox/Today не менялись; аналогичная mode-защита для них — отдельный малый шаг, если потребуется review. R3 (read sequencing), R4, R5–R8, старая отладка и EOF-уборка (task-row.tsx:317, tasks-planning.auth.test.ts:746) — не тронуты. Full auth/E2E сейчас не требовались.
- Pre-fetch write guard (R2a), single-editor policy (R2b1), frozen snapshot (R1), service/API/schema — сохранены без переработки.
- main/другие worktree/localhost:3000/CRM/hooks не менялись; merge/push/amend/rebase/reset/stash/деплой не выполнялись; secrets не коммитились. R2/TASK-008 целиком не объявляются принятыми — только эта коррекция на review.

---

# Коррекция TASK-008-R2b2-fix — guard до расчёта даты

## Статус

READY_FOR_REVIEW (единственная минимальная правка порядка вызовов [P3] из `reports/TASK-008-R2b2.md`; остальная R2b2 policy, R1/R2a/R2b1 сохранены; R5 и остальные задания не начаты). Assignment `tasks/TASK-008-R2b2-fix.md`; старт — coordinator commit `033e2103180d28a99a7d91be467a10bca80003d4` (root/ветка/status проверены, дерево чистое).

## Дефект и исправление

`onClick={() => navigate(addCivilDays(startDate, ±7))}` вычислял аргумент `addCivilDays` ДО входа в navigate с guard — при заблокированной попытке расчёт даты выполнялся (и мог бросить исключение, которое guard не перехватывает), вопреки заданию R2b2. Исправление только в `src/components/orbit/upcoming-board.tsx`:

- `navigateTo(newStart: string)` — прежний guard (listPending/anyInFlight/anyFormOpen) + replaceState/setState/refetch; для кнопки «Ближайшие 7 дней» (`navigateTo(context.today)` — абсолютная дата, расчёта нет).
- Новый `navigateByDays(deltaDays: number)` — guard **до** `addCivilDays(startDate, deltaDays)`, затем `navigateTo(...)`; кнопки prev/next вызывают `navigateByDays(-7)` / `navigateByDays(7)` — ленивый расчёт внутри guarded handler.

Заблокированный callback не рассчитывает дату и не делает effects. Status handling, reactive flags, single-form/write guards/frozen snapshot не менялись; calendar bounds (R5) не чинились. Новые тесты не добавлялись (по заданию существующие две Upcoming guard-регрессии уже покрывают UI policy; порядок вычислений подтверждается source review).

## Проверки (Node v24.21.0 — /tmp/orbit-node24)

| Команда | Результат |
| --- | --- |
| `npm run lint` | exit 0, 0 warnings |
| `npm run typecheck` | exit 0 |
| `CI=1 E2E_PORT=37300 npm run test:e2e -- tests/e2e/write-guard.spec.ts --project=chromium --grep "Upcoming:"` (штатный свежий `next build`, auth-setup dependencies штатно) | exit 0 — **5/5** (3 auth-setup + 2 Upcoming guard-регрессии R2b2) |
| Leftovers | read-only check после прогона: **0** orbit_test\*-баз (штатный PG 17.11, 55432); `git diff --check` чист |

## Ограничения / не входило

- Изменён единственный продуктовый файл upcoming-board.tsx + executor report; R5 (calendar bounds), R3, R4, R6–R8, debug/EOF cleanup — не тронуты. Full auth/E2E не требовались (правка порядка двух callbacks).
- main/другие worktree/localhost:3000/CRM/hooks не менялись; merge/push/amend/rebase/reset/stash/деплой не выполнялись; secrets не коммитились. R2/TASK-008 целиком не объявляются принятыми — только эта коррекция на review.

---

# Коррекция TASK-008-R2b3 — безопасные вкладки Inbox

## Статус

READY_FOR_REVIEW (только Inbox tabs; R2b2-fix принят, R1/R2a/R2b1/R2b2 сохранены; Today/Upcoming/R3–R8 не менялись). Assignment `tasks/TASK-008-R2b3.md`; старт — coordinator commit `51e1bd5c0662c3befe0d33f76845cc7cc4a735a2` (root/ветка/status проверены, дерево чистое).

## Дефект и исправление

«Открытые»/«Завершённые» в Inbox вызывали `setTab` напрямую без disabled и guard: смена вкладки при pending записи или открытой rename/schedule/delete форме скрывала активную форму и её draft при живом выборе в hook. Исправление только в `src/components/orbit/tasks-view.tsx` (hook/rows/controller не переделывались):

- Новый `switchTab(value: TaskTab)` — синхронный guard `writes.anyInFlight() || writes.anyFormOpen()` ДО `setTab` (ref-проверка до render, как принятый pattern R2b2); tab controls `disabled={writes.anyPending || writes.formOpen}`.
- `listPending` (чистое чтение) вкладки намеренно не блокирует — это R3, не эта коррекция. Refresh/retry, R1 frozen snapshot, single-form guard, focus/actor/unmount/StrictMode, pre-fetch write guard — без изменений. Failed Save держит tab lock (форма открыта), Cancel/успешный Save освобождают; pending create блокирует вкладки, после отказа create draft сохранён и вкладки доступны.

## Регрессии (tests/e2e/write-guard.spec.ts, 9 → 11 chromium-тестов)

1. **Inbox, удержанный POST** (delivery `expect.poll`): оба tab controls disabled; bypass (dispatchEvent «Завершённые») не меняет aria-pressed/вкладку/видимый список; release 500 → create error, draft сохранён, tabs enabled → обычный переход на «Завершённые» работает (pressed, open-строки скрыты).
2. **Inbox, dirty schedule editor**: вкладки disabled; bypass не скрывает editor и не меняет вкладку (draft цел); Save с удержанным 500 оставляет editor/error/tab lock; Cancel освобождает выбор и вкладки → обычный переход работает.

## Проверки (Node v24.21.0 — /tmp/orbit-node24)

| Команда | Результат |
| --- | --- |
| Состояние test DB | Штатный PG 17.11 (55432) доступен; Colima/CRM/сторонние сервисы не трогались; credentials не выводились |
| `npm run lint` | exit 0, 0 warnings |
| `npm run typecheck` | exit 0 |
| `CI=1 E2E_PORT=37320 npm run test:e2e -- write-guard.spec.ts inbox.spec.ts --project=chromium` (штатный свежий `next build`, auth-setup штатно) | exit 0 — **26/26** с первого прогона: 3 auth-setup + **11 write-guard** (9 прежних + 2 новых R2b3) + 12 inbox (pending-complete/R3b). Повтор unit suite не требовался (контракты hook не менялись) |
| Leftovers | read-only check после прогона: **0** orbit_test\*-баз; `git diff --check` чист |

## Ограничения / не входило

- Today/Upcoming не менялись; R3 (read sequencing), R4 (rename draft reinit), R5–R8, debug/EOF cleanup — не тронуты. Full auth/E2E и повтор unit не требовались для этой UI policy (контракты hook не изменялись).
- main/другие worktree/localhost:3000/CRM/hooks не менялись; merge/push/amend/rebase/reset/stash/деплой не выполнялись; secrets не коммитились. R2/TASK-008 целиком не объявляются принятыми — только эта коррекция на review.

---

# Коррекция TASK-008-R2b4 — безопасные режимы Today

## Статус

READY_FOR_REVIEW (только Today mode controls; R2b3 принят, R1/R2a/R2b1/R2b2/R2b3 сохранены; Inbox/Upcoming/R3–R8 не менялись). Assignment `tasks/TASK-008-R2b4.md`; старт — coordinator commit `b79219f644d780c18ba979e7d183ce215de6d213` (root/ветка/status проверены, дерево чистое).

## Дефект и исправление

Mode-кнопки «Открытые»/«Завершённые» в Today вызывали `switchMode` → `setStatusMode/refetch` без синхронного guard: UI учитывал только pending через нерекактивный `disabled={writes.anyInFlight()}`, но не открытую форму — смена режима скрывала активную форму с draft либо позволяла старому write callback читать старый mode. Исправление только в `src/components/orbit/today-board.tsx` (hook/rows/controller не переделывались):

- `switchMode(mode)` теперь синхронный: guard `writes.anyInFlight() || writes.anyFormOpen()` ДО `setStatusMode/refetch`; кнопки `disabled={writes.anyPending || writes.formOpen}` (реактивные флаги hook вместо нерекактивного ref-вызова).
- `listPending` (чистое чтение) режим не блокирует — R3, не эта коррекция. Failed Save держит mode lock, Cancel/успешный Save освобождают; pending create блокирует режимы, после HTTP отказа create draft сохранён и controls доступны. Frozen snapshot R1, single-form guard, focus/actor/unmount/StrictMode, pre-fetch write guard — без изменений. Refresh/retry не перерабатывались.

## Регрессии (tests/e2e/write-guard.spec.ts, 11 → 13 chromium-тестов)

1. **Today, удержанный POST** (delivery `expect.poll`): оба mode controls disabled; bypass (dispatchEvent «Завершённые») не меняет aria-pressed/режим/видимый список; release 500 → create error виден, draft сохранён, controls enabled → обычный переход на «Завершённые» работает (pressed, open-строки скрыты).
2. **Today, dirty schedule editor** (draft дедлайна): режимы disabled; bypass не скрывает editor и не меняет режим; Save с удержанным 500 оставляет editor/error/mode lock; Cancel освобождает выбор → обычный переход работает.

## Проверки (Node v24.21.0 — /tmp/orbit-node24)

| Команда | Результат |
| --- | --- |
| Состояние test DB | Штатный PG 17.11 (55432) доступен; Colima/CRM/сторонние сервисы не трогались; credentials не выводились |
| `npm run lint` | exit 0, 0 warnings |
| `npm run typecheck` | exit 0 |
| `CI=1 E2E_PORT=37350 npm run test:e2e -- write-guard.spec.ts planning.spec.ts --project=chromium` (свежий `next build`) | 28 passed + 1 failed: мой новый тест №1 использовал Inbox-селектор `#task-create-status` — на Today у create-статуса нет id; тестовый дефект селектора, не продукта. Исправлено на точный i18n-текст ошибки |
| `CI=1 E2E_PORT=37351 npx playwright test write-guard --project=chromium` | exit 0 — 16/16 (3 auth-setup + 13) |
| `CI=1 E2E_PORT=37352 npm run test:e2e -- ... --project=chromium` (финальный, свежий `next build`) | exit 0 — **29/29**: 3 auth-setup + **13 write-guard** (11 прежних + 2 новых R2b4) + 13 planning (R1-регрессии). Повтор unit suite не требовался (контракты hook не менялись) |
| Leftovers | read-only check после прогонов: **0** orbit_test\*-баз; `git diff --check` чист |

## Ограничения / не входило

- Inbox/Upcoming не менялись; R3 (read sequencing), R4 (rename draft reinit), R5–R8, debug/EOF cleanup — не тронуты. Full auth/E2E и повтор unit не требовались для этой UI policy (контракты hook не изменялись).
- main/другие worktree/localhost:3000/CRM/hooks не менялись; merge/push/amend/rebase/reset/stash/деплой не выполнялись; secrets не коммитились. R2/TASK-008 целиком не объявляются принятыми — только эта коррекция на review.

---

# Коррекция TASK-008-R3a — latest read в Upcoming

## Статус

READY_FOR_REVIEW (только Upcoming read lifecycle; R1/R2 приняты на executor HEAD `15c54871638296a9c1820127edf3308b7fe995e0`; Today/Inbox read sequencing и R4–R8 не начаты). Assignment `tasks/TASK-008-R3a.md`; старт — coordinator commit `a325fb408affae115b9e88514820e759de70e17a` (root/ветка/status проверены, дерево чистое).

## Дефект и исправление

В `refetch` (upcoming-board.tsx) requestSeq проверялся только после fetch; после `await response.json()` guard отсутствовал, а catch/finally проверяли лишь actor/mounted: старый abort после успешного нового read показывал ложную list error, старый finally снимал pending нового read, старый JSON перезаписывал tasks/context. Исправление — один продукт-файл, без общего read controller:

- `src/components/orbit/upcoming-board.tsx`: локальный `stillLatest()` (mounted + actor + latest seq) проверяется после КАЖДОГО await — после fetch (как раньше), после `response.json()` (новый), в catch (добавлен seq) и в finally (добавлен seq). Stale исход (success/body/HTTP error/network reject) ничего не записывает и не снимает pending нового запроса; latest success/error/finally применяются как раньше, GET-only retry работает. Параллельные чистые reads не запрещены (mode switch во время GET доступен по R2 policy); mutation → refetch outcomes, guards write/form/mode, URL navigation, API/service/schema, dates/timezone не менялись.

## Регрессии (tests/e2e/read-lifecycle.spec.ts, новый, 3 теста, user C, чистые mode reads)

1. **Abort старого после успеха нового**: GET completed удержан (delivery `expect.poll`), GET all применён → старый прерван route.abort() → без list error/retry, mode/список latest; затем короткая фаза последнего failed read (следующий GET aborted) → error/«Повторить» видны → GET-only retry восстанавливает open-список.
2. **Abort старого при ещё удержанном новом**: оба GET удержаны, «Обновление…» видно; abort старого НЕ снимает pending нового и не даёт ошибки; release нового → штатный success применён, pending снят («Обновить» вернулся).
3. **Задержанный response.json()**: test-only wrapper `window.fetch` (восстанавливается `restore()`, без product endpoints/env/hooks) возвращает для GET completed Response с управляемым `json()` — старый read проходит initial seq guard и висит на JSON await; новый all применён; release старого JSON → tasks/context остаются latest (обе отличимые строки видны), без ошибки; `pageerror`/unhandled rejection — ноль.

Первый прогон spec упал на дефекте самих fixtures: titles трёх тестов были одинаковыми (общий `run`) и строки накапливались в аккаунте C → strict mode violation; исправлено уникальными per-test labels — product-дефекта не было.

## Проверки (Node v24.21.0 — /tmp/orbit-node24)

| Команда | Результат |
| --- | --- |
| Состояние test DB | Штатный PG 17.11 (55432) доступен; Colima/CRM/сторонние сервисы не трогались; credentials не выводились |
| `npm run lint` | exit 0, 0 warnings |
| `npm run typecheck` | exit 0 |
| `CI=1 E2E_PORT=37380 npm run test:e2e -- read-lifecycle.spec.ts --project=chromium` (свежий `next build`) | 5 passed + 1 failed — fixtures-дефект выше, исправлен |
| `CI=1 E2E_PORT=37381 npx playwright test read-lifecycle --project=chromium` | exit 0 — 6/6 (3 auth-setup + 3 R3a) |
| `CI=1 E2E_PORT=37382 npm run test:e2e -- read-lifecycle.spec.ts write-guard.spec.ts --project=chromium --grep "R3a:\|Upcoming:"` (финальный, свежий `next build`) | exit 0 — **8/8**: 3 auth-setup + 3 R3a + 2 Upcoming write/form guard (R2b2). Повтор unit не требовался (контракты hook не менялись) |
| Leftovers | read-only check после прогонов: **0** orbit_test\*-баз; `git diff --check` чист |

## Ограничения / не входило

- Today/Inbox read lifecycle не менялись (их seq-обработка — отдельные малые шаги, если потребуются); R4–R8, debug/EOF cleanup — не тронуты. Full auth/E2E/unit повтор не требовались (контракты hook не изменялись).
- Общий read controller не вводился; параллельные чистые reads остались разрешены; Abort старого запроса как оптимизацию не добавлял (защита всех исходов сделана guards, как требовало задание).
- main/другие worktree/localhost:3000/CRM/hooks не менялись; merge/push/amend/rebase/reset/stash/деплой не выполнялись; secrets не коммитились. R3/TASK-008 целиком не объявляются принятыми — только эта коррекция на review.

---

# Коррекция TASK-008-R3b — завершение latest-read guard (Today + Inbox)

## Статус

READY_FOR_REVIEW (один общий небольшой TASK: тот же latest-read guard для Today/Inbox + детерминированная синхронизация read-lifecycle; R3a Upcoming product fix принят и не переписывался; R1/R2 сохранены; R4–R8 не начаты). Assignment `tasks/TASK-008-R3b.md`; R3a принят на `18f13bad91248f09f0dcca70c6ac8808f4ac97df` (review `reports/TASK-008-R3a.md`); старт — coordinator commit `a8fefb92f10e49de36d0397bb260dc6aac5537ba` (root/ветка/status проверены, дерево чистое).

## Дефект и исправление

- `src/components/orbit/today-board.tsx`: `refetch` — принятый pattern `stillLatest()` (mounted + actor + latest seq) после КАЖДОГО await (fetch, JSON parsing), в catch и finally; stale исходы ничего не пишут и не снимают pending нового read.
- `src/components/orbit/tasks-view.tsx`: `onConfirmed` — success (после Promise.all, включая JSON) уже был защищён; добавлен `stillLatest()` и seq в catch/finally — stale отказ не создаёт ложную list error / false failed create, stale finally не снимает pending нового read. Confirmed write + failed refresh остаётся read error/retry.
- Чистые `fetchInboxList` (без state) архитектурно не менялись; общий controller/helper не вводился; параллельные чистые reads не запрещены; listPending disable-policy не тронута; R1 frozen snapshot, write/form/mode guards (R2a–R2b4), actor/unmount/StrictMode, API/service/schema — сохранены.

## Test-синхронизация (tests/e2e/read-lifecycle.spec.ts, 3 → 7 chromium-тестов)

- Детерминированные примитивы: one-shot `StatusGate` (удержание первой доставки статуса, счётчик delivery, `abortedDelivered` сигнал фактической отправки abort); page-side read tracker (`addInitScript`, восстанавливается `restore()`): settle-счётчики fetch resolve/reject по статусу и управляемая задержка `json()` с сигналами `jsonEntered`/`jsonSettled`; `flush()` — один macrotask (не sleep) для обработки catch/finally после settle-сигнала. Правка Playwright-семантики: второй маршрут t1 пробрасывает через `route.fallback()` (не `continue`, который ушёл бы в сеть минуя гейт-маршрут).
- Upcoming (R3a, усилены): jsonEntered поллится ДО запуска нового read; после release старого — jsonSettled/abortedDelivered + flush до negative/pending assertions; все гейты освобождаются в finally, wrapper восстанавливается.
- **Today (новые, open/completed без All)**: old abort после latest success; old abort при удержанном новом (pending нового не снимается, затем release → success); delayed json() по той же схеме с jsonEntered. Собственные отличимые open/completed задачи на Today (quick-add planned=today + реальный toggle), без форм/writes.
- **Inbox (новый)**: старый manual Refresh (пара GET open/completed) удержан раздельными гейтами; реальный quick-add POST → новый onConfirmed read применён (строка видна, черновик очищен); старая пара abort после успеха нового → без list error, без ложного failed create, pending снят только новым. Доставки считаются раздельно по статусу; оба гейта очищаются.

## Проверки (Node v24.21.0 — /tmp/orbit-node24)

| Команда | Результат |
| --- | --- |
| Состояние test DB | Штатный PG 17.11 (55432) доступен всю сессию; Colima/CRM/сторонние сервисы не трогались; credentials не выводились |
| `npm run lint` | exit 0, 0 warnings |
| `npm run typecheck` | exit 0 |
| Промежуточные прогоны read-lifecycle | 1-й: 5 failed — мои дефекты теста (tracker установлен после goto; в t1 второй маршрут с `continue` обходил гейт-маршрут; в t4b потерян вызов installReadTracker); 2-й: 4 failed; 3-й: 3 failed; после исправлений — см. финал. Product-дефектов не было: guards отрабатывали во всех гонках |
| `CI=1 E2E_PORT=37446 npx playwright test read-lifecycle --project=chromium` | exit 0 — **10/10** (3 auth-setup + 7) |
| `CI=1 E2E_PORT=37447 npm run test:e2e -- read-lifecycle.spec.ts write-guard.spec.ts --project=chromium --grep "R3a:\|R3b\|Upcoming:\|Вкладки\|режимы"` (финальный, свежий `next build`) | exit 0 — **16/16**: 3 auth-setup + 3 R3a Upcoming + 3 R3b Today + 1 R3b Inbox + 2 Upcoming mode guard (R2b2) + 2 Inbox tabs (R2b3) + 2 Today modes (R2b4) |
| Leftovers | read-only check после прогонов: **0** orbit_test\*-баз; `git diff --check` чист. Повтор unit/DB/auth/full E2E не выполнялся (по заданию; полные gates — перед итоговой приёмкой TASK-008) |

## Ограничения / не входило

- Upcoming product fix (R3a) не переписывался; общий read controller не вводился; параллельные чистые reads разрешены; listPending disable-policy не перерабатывалась. Confirmed write + failed read остаётся read error/retry (не false failed mutation) — покрыто Inbox-тестом.
- R4–R8, debug/EOF cleanup — не тронуты; TASK-008 DONE не объявляется.
- main/другие worktree/localhost:3000/CRM/hooks не менялись; merge/push/amend/rebase/reset/stash/деплой не выполнялись; secrets не коммитились.

---

# Коррекция TASK-008-R4 — rename draft на новое открытие

## Статус

READY_FOR_REVIEW (только rename editor lifecycle; R1/R2/R3 приняты на executor HEAD `54780f15bbecc04668e71f3a0529905833d2cd87` (review `reports/TASK-008-R3b.md`); R5–R8 не начаты). Assignment `tasks/TASK-008-R4.md`; старт — coordinator commit `f098910a75c976ddff7a0d9c860f5f16c607111a` (root/ветка/status проверены, дерево чистое).

## Дефект и исправление

`renameDraft` жил в TaskRow (стабильный key по task.id): после Cancel черновик B возвращался при повторном открытии, а внешнее изменение title + refresh не попадало в новое открытие. Комментарий о «remount по key родителя» был неверен. Исправление только в `src/components/orbit/task-row.tsx`:

- Новый локальный child `TaskRenameEditor` (в том же файле) — монтируется ТОЛЬКО пока форма открыта, `useState(task.title)` инициализирует draft из актуального title на каждом открытии; Cancel → reopen даёт подтверждённый server title, отменённый draft не воскресает. Во время ТЕКУЩЕГО открытия draft не сбрасывается из live prop — failed save сохраняет draft/error для retry.
- Key всей строки НЕ менялся; hook/screens/API/service/schema не тронуты. Frozen schedule snapshot R1 не затронут. Общий busy блокирует input/Save/Cancel/Escape (R2a-fix), own pending labels («Сохранение…»), focus on open/cancel/success/error, single-form policy, actor/unmount/StrictMode — сохранены. Неверный комментарий о remount удалён/заменён точным.

## Регрессии (tests/e2e/write-guard.spec.ts, 13 → 15 chromium-тестов, R4-label)

1. **R4: Cancel→reopen + failed Save retry** — первое открытие: draft=titleA, фокус в поле; fill B → Cancel → reopen = A (draft не воскресает, фокус снова в поле); fill B → удержанный PATCH 500 (delivery `expect.poll`): input/Save(«Сохранение…»)/Отмена disabled; release → error + draft B сохранены, input enabled и в фокусе; unrouted retry → PATCH 200, editor закрыт, строка показывает B; reopen видит B.
2. **R4: внешний rename + Refresh** — форма закрыта; независимый authenticated API client (тот же аккаунт, точный Origin) делает реальный PATCH title=C: response 200 + `task.title===C` + повторный GET item подтверждает persist; UI «Обновить» → строка содержит C → rename показывает C.

## Проверки (Node v24.21.0 — /tmp/orbit-node24)

| Команда | Результат |
| --- | --- |
| Состояние test DB | Штатный PG 17.11 (55432) доступен; Colima/CRM/сторонние сервисы не трогались; credentials не выводились |
| `npm run lint` | exit 0, 0 warnings |
| `npm run typecheck` | exit 0 |
| `CI=1 E2E_PORT=37460 npm run test:e2e -- write-guard.spec.ts inbox.spec.ts --project=chromium --grep "R4:\|rename\|quick-add по Enter"` (свежий `next build`) | 16 passed + 1 failed: мой ассерт искал кнопку «Сохранить» в момент собственной pending, когда label уже «Сохранение…» — тестовый дефект локатора, не продукта; исправлен на точный pending-label |
| `CI=1 E2E_PORT=37461 npx playwright test write-guard -g "R4:"` | exit 0 — 5/5 (3 auth-setup + 2 R4) |
| `CI=1 E2E_PORT=37462 npm run test:e2e -- write-guard.spec.ts inbox.spec.ts --project=chromium --grep "R4:\|rename\|quick-add по Enter"` (финальный, свежий `next build`) | exit 0 — **17/17**: 3 auth-setup + 2 R4 + все Inbox rename/guard flows (quick-add по Enter, failed create, R1/R2/R3/R3b, rename pending guard) |
| Leftovers | read-only check после прогонов: **0** orbit_test\*-баз; `git diff --check` чист. Full suites/unit/DB/auth не повторялись (контракты не менялись) |

## Ограничения / не входило

- Key строки, hook/screens/API/service/schema, frozen snapshot R1 — не менялись. R5–R8, debug/EOF cleanup (в т.ч. видный в логах «R3 DEBUG» из inbox.spec) — не тронуты; TASK-008 DONE не объявляется.
- main/другие worktree/localhost:3000/CRM/hooks не менялись; merge/push/amend/rebase/reset/stash/деплой не выполнялись; secrets не коммитились.

---

# Коррекция TASK-008-R5 — границы семидневного окна

## Статус

READY_FOR_REVIEW (только границы календаря Upcoming; R1–R4 приняты на executor HEAD `69371354f13057b1cc4d6de334523029e38860aa` (review `reports/TASK-008-R4.md`); R6–R8 не начаты). Assignment `tasks/TASK-008-R5.md`; старт — coordinator commit `0dbd55a0cc66fceb09d46d14e2ed7e076a8fd235` (root/ветка/status проверены, дерево чистое).

## Дефект и исправление

1. **`src/lib/calendar.ts` — `civilDateRange`**: шаг `addCivilDays` выполнялся и после последнего элемента, поэтому диапазон до границы (`civilDateRange('2199-12-25',7)` → последний день 2199-12-31) бросал RangeError на лишнем шаге. Теперь шаг выполняется только МЕЖДУ элементами (`if (index > 0)`); старт явно валидируется (невалидный формат/вне 1900..2199 → RangeError — раньше это делал первый шаг, который больше не выполняется). Диапазон с последним днём за границей по-прежнему отвергается. Civil semantics 1900..2199 не менялись.
2. **`src/components/orbit/upcoming-board.tsx`**: раньше проверялся только новый `start`; недопустимый `end` (start+6 за границей) давал невалидный переход/RangeError. Теперь `isWindowReachable(newStart)` проверяет ВЕСЬ окно (`addCivilDays(newStart, 6)` в try/catch, никогда не бросает); prev/next `disabled` по render-безопасным `canNavigatePrev/Next`; `navigateByDays` — guard политики (write/form/listPending по принятой R2b2-fix policy) → addCivilDays в try/catch → проверка всего окна → только потом `navigateTo` (effects/URL/state/GET); `navigateTo` (current) тоже валидирует окно. Недопустимая попытка (включая bypass disabled) не меняет URL/state и не стартует GET.

## Тесты

- **Unit (tests/calendar-view.test.ts, +4 R5)**: ровно 2199-12-25..31 без исключения; одноэлементный диапазон на max (2199-12-31); нижняя граница 1900-01-01..07; реально выходящие за границы диапазоны отвергаются (2199-12-26+7, 2199-12-31+2, старт 1899-12-31). Прежние leap/month/year/DST тесты сохранены.
- **Browser (tests/e2e/planning.spec.ts, новый describe «Upcoming границы окна (R5)», 3 теста)**: нижняя граница (7 групп 01..07.01.1900, prev disabled, dispatchEvent bypass — URL не изменён, next работает); последнее допустимое окно (7 групп 25..31.12.2199, next disabled, bypass безопасен, prev→18→next→25, reload сохраняет); промежуточный край start=2199-12-20 (окно 20..26 валидно, но +7 дало бы 27..недопустимый end → next disabled, bypass безопасен, prev→13→next→20). В каждом тесте `pageerror`-коллектор: ноль uncaught. Синхронизация по URL/range assertions, без sleeps.

## Проверки

| Команда | Результат |
| --- | --- |
| Node24 ДО gates | `/tmp/orbit-node24` исчез; использован проверенный временный **/private/tmp/orbit-r4-review-runtime/node-v24.21.0-darwin-arm64** — `node --version` = v24.21.0; системный Node не менялся |
| Состояние test DB | `nc 127.0.0.1 55432` closed (PG17 недоступен, Colima/CRM не запускались); поднят временный локальный guarded **PostgreSQL 18.6 (Homebrew)** — отдельный кластер /private/tmp, scram-sha-256, эфемерный пароль (0600), loopback-порт 37490, `TEST_DATABASE_URL` только через env (namespace orbit_test) |
| `npm run lint` | exit 0, 0 warnings |
| `npm run typecheck` | exit 0 |
| `npm test -- tests/calendar-view.test.ts` | exit 0 — **23/23** (19 прежних + 4 R5) |
| `npm test` (полный unit) | exit 0 — **67/67** |
| `CI=1 E2E_PORT=37520 npm run test:e2e -- planning.spec.ts write-guard.spec.ts --project=chromium --grep "R5:\|Upcoming:"` (свежий `next build`) | exit 0 — **9/9 с первого прогона**: 3 auth-setup + существующая Upcoming навигация + 3 новых R5 + 2 Upcoming write guard (R2b2) |
| Cleanup | read-only check на временном инстансе: **0** orbit_test\*-баз; `pg_ctl stop` — server stopped; кластер/пароль/env-файлы удалены, порт закрыт; `git diff --check` чист |

## Ограничения / не входило

- Service/API/schema, read/write guards (R2/R3), frozen snapshot R1, другие экраны — не менялись; общего controller нет. R6–R8 и EOF/debug cleanup — не тронуты; TASK-008 DONE не объявляется.
- Целевой PG17 недоступен (выключен не мной) — целевой E2E выполнен на временном PG 18.6 (как независимые review R1/R2a); полные gates — перед итоговой приёмкой TASK-008.
- main/другие worktree/localhost:3000/CRM/hooks не менялись; merge/push/amend/rebase/reset/stash/деплой не выполнялись; secrets не коммитились.

---

# Коррекция TASK-008-R6 — достоверные timezone-тесты

## Статус

READY_FOR_REVIEW (test-only: три тестовых файла; R1–R5 приняты на executor HEAD `a4e8a84f413c56c2a277690e8419671f8ef783f2` (review `reports/TASK-008-R5.md`); R7/R8/TASK-009 не начаты). Assignment `tasks/TASK-008-R6.md`; старт — coordinator commit `37f23251c3c4da6cfe7bc066ea29f0cbc404307a` (root/ветка/status проверены, дерево чистое).

## Изменения (без src/API/schema/settings persistence)

1. **tests/auth/tasks-planning.auth.test.ts** («timezone от saved account settings…» переписан): удалено предположение `today(UTC) ≠ today(Moscow)`; каждое `context.today` (до и после смены) сравнивается с local date **собственного** `response.asOf` в **собственной** `response.timezone` (Intl en-CA). Прежняя зона фиксируется GET settings и восстанавливается в `finally` с точным 200 + GET-подтверждением; смена зоны — правильный Origin, точный 200 + GET-подтверждение Europe/Moscow. Неизменность задачи проверяется GET item до/после (title/plannedDate/plannedTime/deadlineDate), не попаданием в Today. Context/ownership проверки не ослаблены.
2. **tests/e2e/planning.spec.ts** — старый тест заменён новым describe «Timezone labels (R6)» с явным `timezoneId: "UTC"` (только этот describe) + проверка фактической `Intl…timeZone === "UTC"`; account Asia/Tokyo через валидный Origin, **точный 200** (403 не успех), GET settings подтверждает; `waitForResponse` ставится ДО реального «Обновить», UI проверяется по context ЭТОГО ответа (timezone Asia/Tokyo, today == local date его asOf, заголовок «today · Asia/Tokyo» виден при браузере в UTC) — без гонки полуночи; прежняя зона восстановлена в finally (200 + GET). `pageerror` — ноль.
3. **tests/calendar-view.test.ts** (+1 R6 pure-тест): fixed-instant 2026-01-15T12:00:00Z → одинаковый день 2026-01-15 в UTC и Europe/Moscow; 2026-01-15T22:30:00Z → UTC 2026-01-15, Moscow/Tokyo 2026-01-16; явные literals. Существующие calendar assertions сохранены.

## Проверки

| Команда | Результат |
| --- | --- |
| Node24 ДО команд | /private/tmp/orbit-r4-review-runtime — `node --version` = v24.21.0; системный Node не менялся |
| Состояние test DB | PG17/55432 закрыт (не запускал Colima/CRM); поднят временный локальный guarded **PostgreSQL 18.6 (Homebrew)**: отдельный кластер /private/tmp, scram-sha-256, эфемерный пароль (0600), loopback-порт 37550, TEST_DATABASE_URL только через env |
| `npm run lint` | exit 0, 0 warnings |
| `npm run typecheck` | exit 0 |
| `npm test -- tests/calendar-view.test.ts` | exit 0 — **24/24** (23 + 1 R6) |
| `npm run test:auth -- tests/auth/tasks-planning.auth.test.ts -t 'timezone'` | exit 0 — **3 passed / 19 skipped**: нужный тест реально выбран (включая переписанный «timezone от saved account settings»); доказана смена на Europe/Moscow (200 + GET) и восстановление прежней зоны (200 + GET) |
| `CI=1 E2E_PORT=37580 npm run test:e2e -- tests/e2e/planning.spec.ts --project=chromium --grep "timezone\|R6:"` (свежий `next build`) | exit 0 — **4/4**: 3 auth-setup + R6 browser (Asia/Tokyo применена и видна в UI при browser UTC; зона восстановлена) |
| Cleanup | Auth/E2E запускались последовательно; read-only check на временном инстансе: **0** orbit_test\*-баз; `pg_ctl stop` — server stopped; кластер/пароль/env-файлы удалены, порт закрыт; `git diff --check` чист |

## Ограничения / не входило

- Только test-only файлы; src/API/schema/settings persistence/limiter/runner/pool/controller не менялись; R1–R5 не переписывались; R7/R8 и EOF/debug cleanup не тронуты; TASK-008 DONE не объявляется.
- Полные suites не повторялись (по заданию; будут перед итоговой приёмкой). Целевой PG17 недоступен (выключен не мной) — targeted прогоны на временном PG 18.6 с честной версией.
- main/другие worktree/localhost:3000/CRM/hooks не менялись; merge/push/amend/rebase/reset/stash/деплой не выполнялись; secrets/storageState/credentials не печатались и не коммитились.

---

# Коррекция TASK-008-R7 — единый порядок Today в raw API

## Статус

READY_FOR_REVIEW (read-only ordering; R1–R6 приняты на executor HEAD `ed07ce2fc1c42a276ec993734536ba4ab4542b35` (review `reports/TASK-008-R6.md`); R8/TASK-009 не начаты). Assignment `tasks/TASK-008-R7.md`; старт — coordinator commit `9cc9938ee768d829ae74ee03e4aae2e09b3b6cac` (root/ветка/status проверены, дерево чистое).

## Дефект и исправление

`listTasksView` для view=today отдавал rows только в stable-triple порядке (sort_order/created_at/id) — четыре Today-ранга и внутриранговый порядок применял только client helper. Исправление:

- **src/lib/task-view.ts**: новый экспорт `compareTodayOrder(a, b, today)` — ЕДИНЫЙ компаратор контракта (ранг 1 plan<today → 2 plan=today → 3 deadline<today → 4 deadline=today; внутри ранга: rank1 plannedDate+time NULLS LAST, rank2 time NULLS LAST, rank3 deadlineDate, rank4/tie — stable). `TodayOrderable` (Pick plannedDate/plannedTime/deadlineDate) + `todaySectionOf` ослаблены до этой формы; `groupTodayTasks` теперь сортирует секции тем же `compareTodayOrder` — второго расходящегося компаратора нет. Stable tie: JS-сортировка стабильна, вход упорядочен sort_order/created_at/id — DTO не расширяется.
- **src/server/tasks/service.ts** (только read ordering): `listTasksView` для view=today сортирует результат тем же `compareTodayOrder` (Inbox/Upcoming SQL ordering не менялись). Writes/transactions/locks/completion, timezone persistence/context, DTO/API shape, UI/controllers — не тронуты.

## Регрессия raw API (tests/auth/tasks-planning.auth.test.ts, новый describe «R7: Today raw API ordering»)

Собственные синтетические fixtures пользователя U, даты от server context.today, перемешанный порядок создания (контролируемый базовый sort_order): 4 ранга, 13 задач без дублей — rank1 (5: даты T-3/T-2/T-1, time 09:00 прежде 10:00 и NULL last), rank2 (3: time NULL last), rank3 (3: deadline ASC, включая plan-future+deadline-past, стабильный tie d3 раньше d1 по созданию), rank4 (2: stable e2 раньше e1), включая task с plan+deadline (p4, deadline будущий не влияет на ранг). Assertions: `subset(ids реального response.tasks)` == expectedOrder для **status=open**, затем все fixtures завершаются реальным PATCH и **completed/all дают тот же порядок** (общая проверка). Чужая задача пользователя V не проникает; assertions скоупнуты на свои fixture ids (extra rows других тестов файла не влияют на относительный порядок). Существующие фильтр-тесты не ослаблены.

## Проверки

| Команда | Результат |
| --- | --- |
| Node24 ДО gates | /private/tmp/orbit-r4-review-runtime — v24.21.0; системный Node не менялся |
| Состояние test DB | PG17/55432 закрыт (Colima/CRM не запускались); поднят временный локальный guarded **PostgreSQL 18.6 (Homebrew)**: кластер /private/tmp, scram-sha-256, эфемерный пароль (0600), loopback-порт 37610, TEST_DATABASE_URL только через env |
| `npm run lint` | exit 0, 0 warnings |
| `npm run typecheck` | exit 0 |
| `npm test -- tests/calendar-view.test.ts` | exit 0 — **25/25** (24 + 1 R7 компаратор: ранги, time NULLS LAST, rank3 deadline без влияния plan future, tie=0) |
| `npm run test:auth -- tests/auth/tasks-planning.auth.test.ts` (весь planning file, свежий production build) | exit 0 — **23/23** (22 + новый R7 ordering test); raw API order evidence — см. секцию регрессии выше |
| Cleanup | read-only check на временном инстансе: **0** orbit_test\*-баз; `pg_ctl stop` — server stopped; кластер/пароль/env-файлы удалены, порт закрыт; `git diff --check` чист |

## Ограничения / не входило

- DTO/API shape, UI/controllers, schema, writes/transactions/locks/completion, timezone persistence/context, Inbox/Upcoming ordering — не менялись; второй компаратор/большая SQL переработка не вводились. R8 и EOF/debug cleanup не тронуты; TASK-008 DONE не объявляется.
- Browser прогон не требовался (UI не менялся, groupTodayTasks использует тот же компаратор). Полные gates — перед итоговой приёмкой TASK-008. Целевой PG17 недоступен (выключен не мной) — прогон на временном PG 18.6.
- main/другие worktree/localhost:3000/CRM/hooks не менялись; merge/push/amend/rebase/reset/stash/деплой не выполнялись; secrets/URI не печатались и не коммитились.

---

# Коррекция TASK-008-R8 — зона аккаунта в редакторе планирования

## Статус

READY_FOR_REVIEW (metadata props + подпись времени; R1–R7 приняты на executor HEAD `3b1bd4035ad7bd98048bd2a75d84143d3e4aa23c` (review `reports/TASK-008-R7.md`); финальный cleanup/gates и TASK-009 не начаты). Assignment `tasks/TASK-008-R8.md`; старт — coordinator commit `beab5af8904748b00e21016ca003af60232eddca` (root/ветка/status проверены, дерево чистое).

## Изменения — одна цепочка передачи timezone

- **inbox/page.tsx**: `timezone={context.timezone}` из существующего `getTasksReadContext` рядом с today.
- **tasks-view.tsx**: props + `contextTimezone` state; `fetchInboxList` возвращает также `context.timezone`; Refresh (`onConfirmed`) обновляет zone из того же актуального GET context (R3 latest/mounted/actor guards сохранены). Никакого browser/localStorage/hardcoded UTC и отдельного settings fetch.
- **task-items-list.tsx → task-row.tsx → task-schedule-editor.tsx**: проброс `timezone`; в editor — видимая подпись под TIME control `ru.tasks.schedule.timeInZone(zone)` («Время в зоне Asia/Tokyo») с `aria-describedby` на time input. Подпись обновляется при Refresh даже в открытом editor (только prop — frozen snapshot R1/dirty draft не сбрасываются). DATE/TIME остаются civil/wall-clock, без UTC/instant-конверсий.
- **today-board.tsx / upcoming-board.tsx**: `timezone={context.timezone}` из существующего refetch context.
- **src/lib/i18n/ru.ts**: только строка подписи `timeInZone`.
- **tests/workspace-pages.test.tsx**: механическое `timezone="UTC"` в двух существующих renderToStaticMarkup-рендерах TasksView (новый required prop;behavior тестов не менялся).

## Browser доказательство (planning.spec.ts, describe «Timezone editor label (R8)», timezoneId UTC)

Fixtures: Inbox-задача без плана, Today-задача (план сегодня), Upcoming (план +2). Account Asia/Tokyo через accepted API (Origin, точный 200, GET-подтверждение); Inbox metadata — штатным Refresh (waitForResponse до клика, context зоны Asia/Tokyo из ответа). Таблица: подпись «Время в зоне Asia/Tokyo» видима в открытом editor на всех трёх экранах. Затем Inbox dirty draft (plannedDate=+4), смена зоны Europe/Moscow через API, реальный Refresh: подпись → «Время в зоне Europe/Moscow», draft сохранён, PATCH-счётчик не изменился (без unsolicited PATCH). Save: тело настоящего PATCH содержит ровно `["plannedDate"]` со значением draft (без преобразований), GET item подтверждает plannedDate/plannedTime/deadlineDate. Прежняя зона восстановлена (200 + GET). `pageerror` — ноль.

## Проверки

| Команда | Результат |
| --- | --- |
| Node24 ДО gates | /private/tmp/orbit-r4-review-runtime — v24.21.0; системный Node не менялся |
| Состояние test DB | PG17/55432 закрыт (Colima/CRM не запускались); временный локальный guarded **PostgreSQL 18.6 (Homebrew)**: кластер /private/tmp, scram-sha-256, эфемерный пароль (0600), loopback-порт 37640, TEST_DATABASE_URL только через env |
| `npm run lint` | exit 0, 0 warnings |
| `npm run typecheck` | exit 0 |
| `npm test` (полный unit) | exit 0 — **69/69** (включая адаптированные workspace-pages рендеры) |
| Промежуточный R8 прогон | 1 failed: тест ждал смену подписи без Refresh — на Inbox metadata обновляется штатным Refresh (принятая R6-модель), product-дефекта не было; добавлен Refresh-шаг |
| `CI=1 E2E_PORT=37446 npx playwright test read-lifecycle --project=chromium` | exit 0 — **10/10** (3 auth-setup + 7) |
| `CI=1 E2E_PORT=37672 npm run test:e2e -- planning.spec.ts write-guard.spec.ts --project=chromium --grep "R8:\|snapshot\|schedule"` (финальный, свежий `next build`) | exit 0 — **14/14**: 3 auth-setup + R8 + 3 R1 snapshot + failed schedule save + 7 schedule guard cases (R2a/R2b1/R2b2/R2b3/R2b4) |
| Cleanup | read-only check на временном инстансе: **0** orbit_test\*-баз; `pg_ctl stop` — server stopped; кластер/пароль/env-файлы удалены, порт закрыт; `git diff --check` чист |

## Ограничения / не входило

- schema/service/API/settings persistence/writes/controllers не менялись; TaskDTO не расширялся; guards R1–R7 не переделывались; весь контекст в editor не дублировался. Финальный cleanup/gates и TASK-009 не начаты; TASK-008 DONE не объявляется.
- Полные auth/DB/unit/E2E — отдельный проход после review R8. Целевой PG17 недоступен (выключен не мной) — прогон на временном PG 18.6.
- main/другие worktree/localhost:3000/CRM/hooks не менялись; merge/push/amend/rebase/reset/stash/деплой не выполнялись; secrets/URI/storageState не печатались и не коммитились.

---

# Финальная уборка TASK-008-FINAL и полный проход gates

## Статус

**NEEDS_FIXES (один детерминированный auth-flow expiry-тест вне scope FINAL; вся уборка и остальные gates зелёные).** Cleanup-часть готова к review. R1–R8 приняты на executor HEAD `01ac0cea9dd44de1bd33b5f69daf737ce30c83ca`; старт — coordinator commit `645c2161aa3034de8dd044fbfc6f00e2b5789ae1` (root/ветка/status проверены, дерево чистое).

## Cleanup (без продуктовых изменений)

- **tests/e2e/planning.spec.ts** (только R8 test): настоящий `try/finally` — try открывается ДО первой settings mutation, в finally восстановление захваченной `initialZone` (Origin, точный 200, GET-подтверждение), работает при упавшем assertion; ложный комментарий «finally-семантика» удалён. Проверки подписи/draft/PATCH/GET сохранены без изменений.
- **tests/e2e/inbox.spec.ts**: удалены два PROBE console listener и «R3 DEBUG» console.log; assertions/response synchronization не тронуты.
- **playwright.config.ts**: временные `trace: 'on'` overrides (3 места, включая кривое форматирование) заменены на `trace: 'retain-on-failure'`; CI/reuse/globalTeardown/storageState/workers/guards не менялись.
- **src/components/orbit/task-row.tsx, tests/auth/tasks-planning.auth.test.ts**: только trim лишних EOF blank lines (накопленные замечания cumulative diff --check).
- **README.md**: убраны устаревшие утверждения, противоречащие принятым R1–R8 («Данных задач ещё нет» / «Данных задач и серверной бизнес-логики пока нет») — заменены на фактическое состояние (one-off задачи, планирование, Today/Upcoming); список реально отсутствующих фич (notes/priority/project move/subtasks/recurrence/search и пр.) сохранён без изменений.

## Вне scope — новая проблема: детерминированный auth-flow expiry-тест (NEEDS_FIXES)

`tests/auth/auth-flow.auth.test.ts > «просроченный expiresAt в БД: me 401 (cookie cache отключён)»` — **детерминированно падает** (2 прогона: полный suite и одиночный файл): тест экспирирует сессию прямым `UPDATE session SET expires_at = now() - interval '1 second'`, но `me`/`GET /api/auth/get-session` возвращают 200 с **обновлённой сессией (+7 дней, updatedAt = момент запроса)** — better-auth 1.7.7 refresh-семантика перезаписывает сессию вместо отказа. Строка в БД экспериментально подтверждена просроченной (expires_at < db_now), cookieCache выключен (instance.ts:52). Продукт с R1–R8 не менялся; исходные 123/123 прогоны проходили на PG17 (Colima), сейчас среда — временный PG18.6; PG17 этим проходом не проверен (недоступен, Colima не запускалась). Точный repro: `npm run test:auth -- tests/auth/auth-flow.auth.test.ts` на временном PG18; лог сохранён (/tmp, удалён после записи evidence в отчёт). Исправление — отдельная коррекция (test: expiry через обновление собственно сессии/более глубокий сдвиг, либо проверка better-auth refresh-семантики), в scope FINAL не входила.

## Полный последовательный проход gates (после cleanup)

| Gate | Результат |
| --- | --- |
| Node24 ДО gates | /private/tmp/orbit-r4-review-runtime — v24.21.0; системный Node не менялся |
| `npm ci` (Node24) | exit 0 (npm warn install-scripts — известно), lockfile без изменений |
| `npm run lint` | exit 0, **0 warnings** |
| `npm run typecheck` | exit 0 |
| `npm test` | exit 0 — **69/69** |
| `npm run test:db` (temp PG) | exit 0 — **47/47** |
| `npm run test:auth` (полный, свежий production build) | **123/124** — 1 failed: auth-flow expiry (см. выше; вне scope FINAL, детерминирован, repro приложен) |
| `CI=1 E2E_PORT=37730 npm run test:e2e` (полный, свежий `next build`) | exit 0 — **123/123** (3 auth-setup + 120 chromium), включая все R1–R8 regressions |
| Скан полных auth/E2E логов | `idle client error` / `terminating connection` / `57P05` / `uncaughtException` / `unhandled rejection` — **0 вхождений** |
| No-env production build | exit 0 в отдельной временной копии tracked дерева (git archive, без .env/credential env, `npm ci` + `npm run build`; env-переменные БД/auth сняты перед сборкой); temp-копия удалена |
| DB | PG17/55432 закрыт — не проверен этим проходом (Colima/CRM не запускались); временный guarded **PostgreSQL 18.6** (Homebrew, loopback 37700, scram, эфемерный пароль 0600, TEST_DATABASE_URL только через env): после всех прогонов **0 orbit_test\*-баз / 0 соединений**; `pg_ctl stop`, кластер/пароль/env удалены, порт закрыт |
| Diff | `git diff --check` (uncommitted cleanup) чист; cumulative `git diff --check 394aef441a..HEAD` — чист после EOF-trim коммита (до коммита показывал 2 известных EOF blank line, устраняемых этим коммитом) |
| Dev StrictMode | не повторялся: product effects с R8 не менялись (перманентного dev suite нет — известное ограничение) |

## Ограничения / не входило

- Никаких новых продуктовых изменений; R1–R8 не переписывались. R7/R8-файлы не тронуты (кроме EOF trim task-row.tsx). Корневые coordination docs и review reports не менялись.
- PG17 не проверен этим проходом (недоступен); auth-flow expiry failure детерминирован на temp PG18 — причина в better-auth refresh-семантике при прямом UPDATE expires_at, исправление вне FINAL scope.
- main/другие worktree/localhost:3000/CRM/VPN/hooks не менялись; merge/push/amend/rebase/reset/stash/деплой не выполнялись; secrets/URI/storageState не печатались и не коммитились; DONE не объявляется — остановка до независимой финальной приёмки Codex.

---

# Коррекция TASK-008-FINAL-EXPIRY — auth expiry fixture без зависимости от SQL timezone

## Статус

READY_FOR_REVIEW (test-only: один файл auth-flow + отчёт; cleanup FINAL принят на `34998aea9cef6970e52c73d434d1e816db764360`, review `reports/TASK-008-FINAL.md`). Старт — coordinator commit `8282e52302a4b656684b152d965d1a9ff31440a1` (root/ветка/status проверены, дерево чистое).

## Причина (уточнение прежнего диагноза)

Прежний диагноз FINAL («better-auth refresh истёкшей сессии / отличие PG18») был **ошибочным**. Evidence независимой matrix координатора и исправленного теста: колонка `expires_at` — `timestamp WITHOUT time zone` (UTC wall-clock representation); `now() - interval '1 second'` через implicit cast пишет **wall-clock SQL-сессии** — при TimeZone Europe/Moscow записанное значение читается как UTC на ~3 часа в будущем, сессия «действительна» → me 200. Better Auth проверяет expiry до refresh; версия PG ни при чём.

## Исправление (tests/auth/auth-flow.auth.test.ts, только fixture expiry)

`expireUserBSessions()` (обе точки существующего сценария): expiry пишется **параметризованным UTC ISO** из JS (`new Date(Date.now() - 60_000).toISOString()` — разумный запас 60s вместо хрупкой 1s), без интерполяции данных в SQL. Проверки: `rowCount > 0`; фактические записанные rows читаются (`expires_at::text`), интерпретируются как UTC (…Z) и утверждаются меньше текущего Node-времени. me 200 до экспирации, me 401 после; cookieCache off и контракт preserved. Никаких изменений src/auth config/options/cache/refresh/limiter/schema/runner; fixture — только synthetic sessions собственного actor.

## Timezone matrix и gates (Node24 v24.21.0 — /private/tmp/orbit-r4-review-runtime)

| Запуск | Результат |
| --- | --- |
| `npm run lint` / `npm run typecheck` | exit 0 / exit 0, 0 warnings |
| Временный кластер **UTC** (порт 37731, `timezone=UTC`, собственная конфигурация) — targeted `auth-flow` | exit 0 — **15/15** (свежий production build штатного runner) |
| Временный кластер **Europe/Moscow** (порт 37730, `timezone=Europe/Moscow`) — **полный `npm run test:auth`** (non-UTC target, зачтён как full gate) | exit 0 — **124/124** (все файлы, включая исправленный expiry-тест и planning suite) |
| Скан полного auth лога (Moscow) | `idle client error` / `terminating connection` / `57P05` / `uncaughtException` — **0 вхождений** |
| Cleanup обоих кластеров | каждая БД: **0 orbit_test\*-баз / 0 соединений** до stop; `pg_ctl stop` ×2; кластеры/пароли/env удалены, порты 37730/37731 закрыты |
| Diff | `git diff --check` чист; cumulative `git diff --check 394aef441a..HEAD` — чист |

Остальные suites (unit/DB/E2E/no-env build) не повторялись: test-only correction; финальное evidence FINAL на `34998ae` сохраняется с честной пометкой прошлого SHA. PG17 оставался недоступен — не проверен (Colima/CRM не запускались).

## Ограничения / не входило

- Продукт (src/auth config/Better Auth options/cache/refresh/limiter/schema/migrations/runner) не менялся; refresh не отключался; тест не подменён revoke-вариантом и не маскирует отказ ожидаемым 200; чужие среды не затронуты.
- main/другие worktree/localhost:3000/CRM/VPN/hooks не менялись; merge/push/amend/rebase/reset/stash/deploy не выполнялись; cookie/token/credentials не печатались; TASK-008 DONE и TASK-009 не объявляются — остановка до review Codex.