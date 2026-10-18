# TASK-007 — отчёт исполнителя (GLM)

## Статус

READY_FOR_REVIEW (после коррекции R3b по повторному review reports/TASK-007.md; R1/R2/R3 закрыты Codex, не менялись; старт коррекции R3b `b28b80b5dacca602d6db0431cf1c15989f717f08`).

## Correction R3b (второй этап NEEDS_FIXES)

Изменены только: `src/components/orbit/tasks-view.tsx`, `tests/e2e/inbox.spec.ts` (+1 регрессия, 82 → 83). Service/schema/API/transactions/completion/locking/R1/R2 не переделывались.

Корень: при DELETE pending обе кнопки confirmation disabled и сфокусированная «Отмена» теряла фокус в BODY; failure-ветки handleDelete (HTTP refusal и network rejection) показывали ошибку и возвращали кнопки, но не восстанавливали фокус. Исправление: обе failure-ветки после `setDeleteError` (при живом mounted) ставят `deleteFocus {target:"cancel"}` с новым nonce — post-commit effect возвращает фокус в безопасную enabled «Отмену» живого confirmation. Unmount/смена actor: setDeleteFocus не вызывается и effect этого компонента не срабатывает — фокус наружу не переносится. Escape/cancel при deletePending по-прежнему игнорируются; success → quick-add; cancel/Escape в обычном режиме → trigger; rename focus — без изменений (все прежние assertions сохранены).

Regression (inbox.spec +1, **83**): «R3b: отказ DELETE (500 и network) возвращает фокус в confirmation» — две фазы на одной задаче: (1) held DELETE → HTTP 500 → ошибка видима, Cancel enabled и **focused**; Escape после отказа → confirmation закрыт, фокус на trigger, DELETE не повторился; (2) network rejection (route.abort) → тот же failure focus lifecycle; финальный успешный DELETE → строка скрыта, фокус на quick-add. Pending-policy asserted (Cancel disabled во время DELETE).

## Проверки после коррекции R3b (Node v24.21.0 / npm 11.19.0 — /tmp/orbit-node24)

| Команда | Результат |
| --- | --- |
| `npm run lint` / `npm run typecheck` | exit 0 / exit 0, без warnings |
| `npm test` | exit 0 — 44 passed |
| `npm run test:db` | exit 0 — 47 passed |
| `npm run test:auth` №1 / №2 (последовательно) | exit 0 — **101/101** оба; 0 lifecycle-паттернов |
| `CI=1 E2E_PORT=3270` / `3271` / `3272` (три прогона) | exit 0 — **83/83** все (82 + R3b regression); 0 lifecycle-паттернов |
| `npm run build` без `.env` | exit 0 |
| Leftovers | orbit_test\*-баз: 0; `git diff --check` чист; изменения — 1 компонент + 1 spec |

Ограничения — без изменений к предыдущим раундам (реальные устройства/production proxy не проверялись; даты/notes/priority/project assignment/subtasks/recurrence вне scope; limiter single-process; clock skew устранён server-side `now()` в раунде реализации).

---

# Предыдущие раунды (исходная реализация и R1/R2/R3)

## Correction R1/R2/R3 (этап NEEDS_FIXES)

Изменены только: `src/components/orbit/tasks-view.tsx`, `tests/e2e/inbox.spec.ts` (+3 регрессии, 79 → 82). Service/schema/API/transactions/completion/locking и timestamp corrections (now() из БД) не переделывались — замечания раунда подтверждены как UI-only.

### R1 — read failure не переклассифицируется в failed mutation
`refreshLists` получил catch: network/JSON rejection чтения → контролируемый outcome (`setListError(true)` при живом actor) и `return false`, без throw. Все mutation-обработчики (create/rename/toggle/delete) после успешного ответа вызывают `await refreshLists()` — сбой последующего чтения теперь показывает **read error с кнопкой «Повторить» (только GET)** и не попадает в catch обработчика, поэтому подтверждённая mutation больше не помечается failed; draft create уже очищен к этому моменту. Retry (кнопка «Повторить») выполняет только `refreshLists()` — два GET, без повторного POST/PATCH/DELETE. Правда failed mutation (отказ самого запроса) сохраняет прежний draft/error/retry. Actor/lifecycle guards сохранены.

### R2 — конфликтующие действия строки заблокированы при pending
Прежний `rowBusy` исключал текущую toggle-строку. Теперь `busy` (rename/toggle/delete pending) блокирует **все** action-кнопки **всех** строк: у строки с held complete её «Переименовать»/«Удалить»/повторный toggle disabled (pending-лейбл на toggle). Handler- guards продублированы: `handleToggle/handleDelete/handleRenameSubmit/openRename/openDeleteConfirm` отказывают при любом чужом in-flight. Повторный toggle и force/programmatic клики не открывают editor/confirmation и не отправляют вторую mutation. После response/ошибки guards снимаются (pending-лейблы/кнопки возвращаются). Rename P→Q regression (TASK-006/R2) сохранена.

### R3 — delete confirmation: focus/Escape/cancel
Confirmation inline сохранён. При открытии фокус — **безопасная «Отмена»** (`task-delete-cancel-<id>` через `deleteFocus` state+effect, объект с nonce перезапускает эффект; сам эффект только фокусирует DOM — StrictMode-идемпотентно, без setState). Escape до DELETE (onKeyDown контейнера, игнорируется при pending) отменяет и возвращает фокус на `task-delete-trigger-<id>`; явная «Отмена» — то же; мутирующего запроса нет. После успешного удаления фокус — quick-add input (`task-title-input`, логичный следующий control); при failure фокус не теряется, error виден. Pending policy: Escape/Отмена при deletePending игнорируются/заблокированы.

### Browser regressions (inbox.spec, +3)
1. **R1**: реальный POST проходит на сервер (route.fallback), GET lists aborted → read error «Не удалось обновить список задач.» + «Повторить», без «Не удалось добавить задачу», draft пуст; retry → ровно одна строка, `postCount === 1`, `pageErrors` пуст (нет unhandled Failed to fetch).
2. **R2**: held PATCH complete → rename/delete/toggle строки disabled asserted; force-click не открывает editor/confirmation; PATCH count остаётся 1; релиз 500 → alert, кнопки снова enabled, retry-завершение работает.
3. **R3**: keyboard open → activeElement = `task-delete-cancel-<id>`; Escape → confirmation закрыт, activeElement = `task-delete-trigger-<id>`, DELETE count 0; явная Отмена → то же; keyboard confirm (Shift+Tab+Enter) → ровно один DELETE, activeElement = `task-title-input`.

## Проверки после коррекции (Node v24.21.0 / npm 11.19.0 — /tmp/orbit-node24)

| Команда | Результат |
| --- | --- |
| `npm run lint` / `npm run typecheck` | exit 0 / exit 0, без warnings |
| `npm test` | exit 0 — 44 passed |
| `npm run test:db` | exit 0 — 47 passed |
| `npm run test:auth` №1 / №2 (последовательно) | exit 0 — **101/101** оба; 0 lifecycle-паттернов |
| `CI=1 E2E_PORT=3266` / `3267` (последовательно) | exit 0 — **82/82** оба (79 + 3 новых регрессии); 0 lifecycle-паттернов |
| `npm run build` без `.env` | exit 0 |
| Leftovers | orbit_test\*-баз: 0; `git diff --check` чист; изменения — 1 компонент + 1 spec |

Ограничения — без изменений к исходному раунду (реальные устройства/production proxy не проверялись; даты/notes/priority/project assignment/subtasks/recurrence вне scope; clock skew устранён server-side `now()`; limiter single-process).

---

# Предыдущий раунд (исходная реализация)

## Исходное состояние (проверено до изменений)

- Worktree `/Users/atlhnv/Codex/orbit-worktrees/TASK-007`; ветка `task/TASK-007`; дерево чистое.
- База review `3b716dc0bfd06fbf5a508a83382abc1fda77d852` (принятый TASK-006); **starting SHA: `1c6684af70a770b9f2c0edbbfca7e5ed909424ae`** (assignment, единственный над базой).
- Runtime: **Node v24.21.0 / npm 11.19.0 из `/tmp/orbit-node24/node-v24.21.0-darwin-arm64/bin`** (системный Node v26.10.0 не использовался для gates; первая `npm ci` под npm26/11.19.1 дала ENOTEMPTY при смешении артефактов — node_modules удалён и переустановлен начисто под Node 24, exit 0).
- Docker PostgreSQL Orbit healthy 127.0.0.1:55432; localhost:3000/CRM/main не затрагивались. `.env` подготовлен (untracked, git check-ignore подтверждён), значения не выводились. Новых зависимостей нет.

## Реализовано

### 1. Pure contracts — `src/lib/tasks.ts` (новый)
`parseTaskTitle`: trim, 1–500 Unicode code points (`Array.from`, тест доказывает отличие от UTF-16), **отсечение NUL и unpaired surrogates до PostgreSQL** (`containsInvalidUnicodeText` — иначе PG давал бы 500 на некорректный UTF-8; валидные surrogate pairs/emoji разрешены). `parseTaskCreate` (ровно `{title}`), `parseTaskPatch` (непустой subset `{title?, completed?}`, поле в ошибке), `parseTaskListStatusQuery` (`status=open|completed|all`, default open, дубликаты/лишние keys → invalid), `isValidTaskId`, `toTaskDTO` (`{id,title,projectId,parentId,completedAt,revision,createdAt,updatedAt}`, owner не входит).

### 2. Service — `src/server/tasks/service.ts` (новый, server-only)
- `listInboxTasks(actorId, status)`: собственные не-deleted root задачи (parent_id NULL) без planned_date, где project_id NULL **или** EXISTS собственный неархивированный проект (composite FK гарантирует owner-согласованность — меж-owner join невозможен); фильтр completed по completed_at; сортировка sort_order/created_at/id ASC; ошибка БД пробрасывается.
- `createTask`: INSERT {owner, title} — все остальные поля по DB defaults (priority 4, sort_order 0, даты NULL, revision 0).
- **Транзакционные мутации**: порядок блокировок всегда task row (SELECT … FOR UPDATE по id+owner+deleted_at IS NULL) → project row (FOR UPDATE, если project_id задан). Row lock проекта сериализует mutation с принятым archive UPDATE projects — архив не может вклиниться между проверкой и записью (доказано детерминированным regression: ждущий PATCH наблюдается в pg_stat_activity, commit архива → 409). Встречных task-блокировок у project archive нет → deadlock невозможен. Guard'ы: parent_id/recurrence_rule → UNSUPPORTED_TASK; archived project → PROJECT_ARCHIVED; конкурентно удалённая → not-found/no-op по семантике.
- **PATCH**: изменения вычисляются под блокировкой; revision +1 **только при реальном изменении** (title/complete/reopen; combined — одна revision), updated_at только при изменении; полный no-op возвращает текущий DTO без записи. complete: `completed_at` = journal `completed_at` = **один `now()` БД** (транзакционно-стабилен); journal INSERT в той же транзакции (`occurrence_date` NULL, `completed_revision` = revision ДО перехода, `idempotency_key` — server UUID); отказ INSERT откатывает и task. Повтор complete/reopen — no-op без новых записей. **Теперь timestamps пишутся `now()` БД** — см. «Clock skew fix».
- **DELETE**: soft delete root (deleted_at/updated_at/revision+1) + скрытие собственных активных direct children **тем же `now()`** (транзакционно-стабилен → «один timestamp» гарантирован СУБД) с revision+1; pre-deleted children, project и journal не меняются; completion log сохраняется. Повтор DELETE своей удалённой → no-op (204); foreign → 404.

### 3. HTTP — `src/app/api/v1/tasks/route.ts` + `[taskId]/route.ts` (новые)
GET collection (query `status`, ошибки 400) / POST `{title}` → 201 (query →400). Item: GET 200 / 404 (foreign/missing/deleted одинаково); PATCH 200 + 409 codes; DELETE 204 no-store без media requirement, непустой body →400, >2KiB →413 (новый `readBodySizeWithLimit` в общих helpers), query →400; DELETE тоже требует auth+Origin. Invalid UUID →400 `field:"taskId"`. Все ответы, включая 204, `private, no-store`; envelope `{error:{code,field?}}`.

### 4. Clock skew fix (обоснованная адаптация принятых services)
Обнаружено прогоном: **часы Docker-VM (PostgreSQL) расходятся с хостовыми (Node) на ~0.7s** — приёмо-стойкие сравнения `updated_at (node) > created_at (pg)` стали flaky (упали существующие projects.auth/tasks rename assertions). Минимальная правка: `updated_at`/`created_at` при update/insert в **accepted services projects и settings** и в новом tasks service пишутся `sql`now()`` (server write теми же часами БД, что и created_at). Поведение/контракты не изменились; settings/projects тесты защищают эквивалентность. Без этого TASK-007 и прежние gates были бы environment-flaky.

### 5. UI — `src/components/orbit/tasks-view.tsx` (новый client) + inbox page
Quick-add (label «Название задачи», Enter, pending блокирует input/button, draft при ошибке, invalid — локальная pure-проверка), tabs «Открытые»/«Завершённые» (aria-pressed), строки: title текстом, «Завершить»/«Открыть снова», inline rename (prefilled/Отмена/focus-return через post-commit effect), «Удалить» с inline подтверждением «Удалить задачу?» (Подтвердить/Отмена). Подтверждение только по server response + refetch обоих списков; failed mutation сохраняет строку/draft. Pending-изоляция по TASK-006/R2: renamePending блокирует чужие rename triggers (force-click не открывает форму), toggle/delete — per-row. Lifecycle/actor guards: симметричный mounted-эффект + actorRef; запросы не прерываются. Inbox page: `requireUserOrRedirect` + начальные open/completed списки. /today,/upcoming — прежние placeholders.

### 6. Тесты
- **Pure** `tests/tasks-validation.test.ts` (15) + адаптация `tests/workspace-pages.test.tsx` (InboxPage → TasksView рендер: empty/tabs/quick-add/escaping; ProjectsView сохранён; today/upcoming с прежними assertions). Итого **44**.
- **Integration** `tests/auth/tasks.auth.test.ts` (29): defaults/DTO/DB defaults; 500/501 cp; NUL/unpaired → 400 (не 500); дубликаты; 12 невалидных create payload → 400 без записи; transport (jsonp 415, charset 201, 413, query 400, Origin 403×3, no-store); foreign==missing 404; rename/no-op/combined (одна revision+один journal, completed_revision=до перехода); повтор complete no-op; **конкурентный complete → ровно 1 journal**; concurrent title+complete → оба поля; reopen/re-complete → новый log; **fault injection journal INSERT → task/revision/журнал откачены** (trigger на собственной БД); Inbox-фильтры (dated/child/archived-project исключены, project task входит); child/recurrence 409 без log; archived 409 → project restore → успех; **row lock regression**: не закоммиченный archive UPDATE держит блокировку, PATCH наблюдается ждущим в pg_stat_activity (детерминированный poll, не sleep-assert), COMMIT → 409, снятие архива → успех; DELETE каскад (один timestamp root+child, pre-deleted нетронут, journal сохранён, parent complete не завершает child), repeat 204 no-op, deleted 404/вне списков, DELETE errors; owner isolation; revoked 401. Фикстуры — U/V + signInLocalUser; побочные fixture-rows напрямую в own DB.
- **E2E** `tests/e2e/inbox.spec.ts` (8): quick-add/rename cancel(focus)+save/reload; complete→Завершённые→reopen; delete cancel/confirm/reload; failed create retry+draft; 500/501 emoji insertText; delayed complete + навигация (stale guard); rename pending блокирует Q; mobile 360. Фикстуры — пользователь A (settings.spec ревокирует B). Адаптация theme.spec: добавлено ожидание «Тема сохранена» перед reload/навигацией (усиление детерминизма: reload выигрывал гонку у PATCH — флейк воспроизведён в run 2, после фикса 3 подряд зелёных прогона). Итого browser: **79**.

### 7. Dev StrictMode probe
Реальный `next dev` (порт 3245→3255-схема, StrictMode по умолчанию), уникальная БД + synthetic пользователь: `DEV-SUCCESS: create применён, задача переживает reload` → `DEV-COMPLETE: complete/reopen работают под StrictMode` → `DEV-FAILURE: ошибка видима, строки нет; retry успешен` → `DEV CHECK PASS`, exit 0. Cleanup: сервер остановлен по слушателю порта, dev-БД удалена, `next-env.d.ts` возвращён к HEAD-байтам, temp-скрипты удалены.

## Проверки (Node v24.21.0 / npm 11.19.0 — toolchain /tmp/orbit-node24)

| Команда | Результат |
| --- | --- |
| `npm ci` (после чистой переустановки node_modules под Node 24) | exit 0, lockfile неизменен |
| `npm run lint` / `npm run typecheck` | exit 0 / exit 0 (strict), без warnings |
| `npm test` | exit 0 — **44 passed** (29 прежних + 15 tasks pure; workspace адаптирован) |
| `npm run test:db` | exit 0 — **47 passed** (schema не менялась) |
| `npm run test:auth` №1 / №2 (последовательно, финальное состояние) | exit 0 — **101/101** оба (72 + 29 tasks); 0 lifecycle-паттернов |
| `CI=1 E2E_PORT=3259/3260` (последовательно; всего 3 зелёных прогона подряд 3258–3260) | exit 0 — **79/79** (71 + 8 inbox); 0 lifecycle-паттернов |
| `npm run build` без `.env` | exit 0; ƒ Dynamic: /api/v1/tasks, /api/v1/tasks/[taskId], /inbox (+ прежние) |
| Leftovers | orbit_test\*-баз: 0, соединений: 0; `git diff --check` чист |

## Транзакции/locking/no-op — кратко

1. PATCH/DELETE: `BEGIN` → `SELECT … FOR UPDATE` (id+owner+deleted_at IS NULL) → guard'ы child/recurrence (409 UNSUPPORTED_TASK) → row lock проекта при project_id (409 PROJECT_ARCHIVED; сериализация с archive UPDATE) → вычисление изменений под блокировкой → UPDATE … RETURNING → journal INSERT (только complete) → `COMMIT`. Порядок task→project фиксирован; deadlock невозможен.
2. completed: task.completed_at = journal.completed_at = `now()` (транзакционно-стабилен); completed_revision = revision до перехода; idempotency_key = server UUID; occurrence_date NULL.
3. Revision/updated_at: +1/now только при реальном изменении (title или переход completed); полный no-op — read-only ответ. Конкурентные completes сериализуются FOR UPDATE — ровно один переход/log, оба ответа 200.
4. DELETE: один `now()` для root и новых удалённых children (транзакционно-стабилен); revision+1 каждому реально изменённому; pre-deleted children/journal/completed_at не меняются; физического DELETE нет.

## Известные ограничения / не проверено

- Реальные устройства/production/reverse proxy не проверялись; Origin-политика за TLS-терминацией — deployment-этап.
- Даты/notes/priority/project assignment/subtask UI/recurrence/history/search — вне TASK; 409-поведение для child/recurrence — задел под TASK-009/011.
- Постоянного dev-mode suite нет; воспроизводимая live dev процедура описана (выполнена, DEV CHECK PASS).
- Clock skew Docker-VM vs host (~0.7s, наблюдён) — устранён в server timestamps переходом на `now()` БД; в момент наблюдения падали прежние accepted rename assertions (projects/tasks) — адаптация services описана выше, tests подтверждают эквивалентность. Клиентские часы в контрактах не используются.
- npm audit не пересчитывался (новых зависимостей нет); limiter single-process; прежние tooling ограничения действуют.

## Git

- Ветка `task/TASK-007`, worktree `/Users/atlhnv/Codex/orbit-worktrees/TASK-007`.
- Starting SHA `1c6684af70a770b9f2c0edbbfca7e5ed909424ae`; реализация — обычные новые коммиты; latest full SHA сообщён после commit.
- Merge/push/amend/rebase/reset/stash не выполнялись; main, старые worktree, localhost:3000, CRM/VPN, coordination docs не менялись; secrets только в untracked `.env`.

## Итог

TASK-007 реализован по scope (Inbox quick-add/rename/complete/reopen/soft delete, owner-scoped versioned API с транзакциями/журналом/блокировками, реальный UI). Остановка до независимого review Codex; TASK-008 не начинался.
