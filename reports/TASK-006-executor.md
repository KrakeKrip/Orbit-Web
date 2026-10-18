# TASK-006 — отчёт исполнителя (GLM)

## Статус

READY_FOR_REVIEW (после коррекции R1/R2/R3 по review reports/TASK-006.md; старт коррекции `d22a65ec7d3b19f2702c9164b64b3888a49543b1`).

## Correction R1/R2/R3 (этап NEEDS_FIXES)

Изменены только: `src/server/http.ts`, `src/components/orbit/projects-view.tsx`, `tests/auth/projects.auth.test.ts`, `tests/auth/settings.auth.test.ts`, `tests/e2e/projects.spec.ts`. Service/schema/ownership/main не менялись.

### R3 — точный media type application/json
`hasJsonContentType` теперь сравнивает media type **точно**: part до `;` → trim → lowercase === `application/json`. `application/jsonp` и похожие префиксы → 415 без записи; `application/json;charset=UTF-8` и регистр token'а принимаются. Regressions: POST jsonp → 415 без записи, PATCH jsonp → 415 без мутаций, PATCH с parameters → 200 (projects.auth); settings jsonp → 415 (settings.auth — общий helper, ослабления нет).

### R1 — ввод полного 120-code-point имени
`maxLength={200}` убран из create input: HTML maxLength считает UTF-16 units и молча резал non-BMP имена (120 🦄 = 240 units → 100). Лимит 120 code points остаётся в pure-валидации (`parseProjectName`), клиентская invalid-подсказка без запроса при 121.
Regression: `keyboard.insertText` (путь реальной вставки) 120 🦄 → в поле ровно 120 code points (assert через `Array.from(value).length`) → create → строка в списке → reload сохраняет; 121 → сообщение «Введите название проекта», draft 121 сохранён, строки нет.

### R2 — чужой rename закрыт на время pending rename
`openRename` guard: `if (renamePending || renameInFlight.current) return;`; все rename triggers получают `disabled={archivePending || renamePending}` (раньше только archivePending). Пока PATCH P в pending, «Переименовать» у Q недоступен — поздний ответ P физически не может закрыть/изменить форму Q; 500-вариант P остаётся ошибкой в форме P.
Regression: два проекта P/Q → held route `**/api/v1/projects/**` → rename P submit → Q trigger **disabled** asserted → force-click не открывает форму Q (textbox Q count 0) → релиз 200 → закрывается только форма P, Q trigger снова enabled. Cancel/focus-return/error-retry/lifecycle/StrictMode поведение не менялось.

## Проверки после коррекции (Node v24.21.0 / npm 11.19.0)

| Команда | Результат |
| --- | --- |
| `npm run lint` / `npm run typecheck` | exit 0 / exit 0, без warnings |
| `npm test` | exit 0 — 29 passed |
| `npm run test:db` | exit 0 — 47 passed |
| `npm run test:auth` №1 / №2 (последовательно) | exit 0 — **72/72** оба (71 + media-type regressions); 0 lifecycle-паттернов в обоих логах |
| `CI=1 E2E_PORT=3251` / `3252` (последовательно) | exit 0 — **71/71** оба (69 + R1-emoji и R2-rename-Q regressions); 0 lifecycle-паттернов |
| `npm run build` без `.env` | exit 0 |
| Leftovers | orbit_test\*-баз: 0; `git diff --check` чист; изменения — 2 src + 3 test файла |

Известные ограничения — без изменений к исходному раунду (реальные устройства/production proxy не проверялись; task list внутри проекта/deletion/reorder/sharing вне scope; strict ordering одного поля не asserted; limiter single-process).

---

# Предыдущий раунд (исходная реализация)

## Исходное состояние (проверено до изменений)

- Worktree `/Users/atlhnv/Codex/orbit-worktrees/TASK-006`; ветка `task/TASK-006`; дерево чистое.
- База review `9b2ba6465f2c5bda5aba88cf8f26cd0ffdd0cc2c` (принятый TASK-005); **starting SHA: `bcde56f30be4dd3e09e3819151a41fcac7134651`** (assignment-коммит, единственный над базой).
- Node v24.21.0 / npm 11.19.0; Docker PostgreSQL Orbit healthy 127.0.0.1:55432; localhost:3000/CRM/main не затрагивались. `.env` скопирован из рабочего окружения (untracked, git check-ignore подтверждён; значения не выводились). `npm ci` exit 0; новых зависимостей нет.

## Реализовано

### 1. Pure contracts — `src/lib/projects.ts` (новый)
`parseProjectName` (trim, непустое, ≤120 **Unicode code points** — `Array.from`, согласовано с PG char_length; тест доказывает отличие от UTF-16: `"e".repeat(119)+"🦄"` = 120 cp допустимо), `parseProjectCreate` (ровно `{name}` — id/owner_id/sort_order/archived/unknown запрещены), `parseProjectPatch` (непустой subset name/archived, типы, field в ошибке), `parseProjectListStatusQuery` (только `status=active|archived|all`, default active; дубликаты/лишние keys → invalid), `isValidProjectId` (UUID syntax), `toProjectDTO` (Date→ISO, owner не входит).

### 2. Service — `src/server/projects/service.ts` (новый, server-only)
`listProjects(actorId, status)`: WHERE owner_id, фильтр archived (active/archived/all), ORDER BY `sort_order ASC, created_at ASC, id ASC`. `getProject`: WHERE id AND owner_id. `createProject`: INSERT (id/UUID от БД, owner из actor, archived_at null, sort_order default). `updateProject`: **один атомарный owner-scoped UPDATE … RETURNING** без read-by-id; повторный `archived:true` — `COALESCE(archived_at, now())` (исходный timestamp сохраняется), `false` → NULL (повтор остаётся null), re-archive после restore — новый timestamp; `updated_at` — явный server write; tasks не затрагиваются. Чужой/неизвестный id → null (неразличимо). Никакого cross-request cache.

### 3. Shared transport — `src/server/http.ts` (новый, server-only)
`errorResponse` (envelope `{error:{code,field?}}`), `NO_STORE`, `hasJsonContentType` (parameters допускаются), `readJsonBodyWithLimit` (Content-Length pre-check + потоковый лимит 2 KiB, TextDecoder stream), `isAllowedOrigin` (точный configured BETTER_AUTH_URL; missing/null/hostile → false; Host/Forwarded не читаются). **Settings route рефакторен на эти хелперы без изменения поведения/порядка проверок** — покрытие settings-тестов (51 auth) защищает эквивалентность; ослабления нет.

### 4. Routes (новые)
`GET/POST /api/v1/projects` и `GET/PATCH /api/v1/projects/[projectId]`: порядок documentирован (id/query/media/size/parse → auth 401 → origin 403 → validation 400 → mutation); invalid UUID → 400 `field:"projectId"`; valid unknown/foreign → одинаковый 404; item query → 400; DELETE не реализован (405); любой отказ не пишет в БД; все ответы `private, no-store`.

### 5. UI — `src/components/orbit/projects-view.tsx` (новый client) + `page.tsx`
Server page: `requireUserOrRedirect` + initial active/archived списки → ProjectsView. Tabs «Активные»/«Архив» (aria-pressed), create form (Enter, pending блокирует input+button и double submit, invalid — локальная pure-проверка без запроса, server error — draft сохранён), rename — inline editor (prefilled, Отмена ничего не пишет, **focus return после коммита** через `renameFocusTarget` state+effect — прежний узел уничтожается пересозданием строки; effect без setState — lint `react-hooks/set-state-in-effect`/`purity` чистые, StrictMode-replay идемпотентен), Архивировать/Восстановить per-row. Подтверждение только после server response; после мутаций — refetch обоих списков; failed mutation не исчезает строку/не показывает fake success. Lifecycle/actor guard: симметричный mounted-эффект + actorRef (инварианты TASK-005), запросы не прерываются. Имена — текст (escaping), break-words, ≥44px, ru.ts.

### 6. Тесты
- **Pure** `tests/projects-validation.test.ts` (13) + адаптация `tests/workspace-pages.test.tsx`: ProjectsPage (server+DB) заменён рендер-тестами **ProjectsView** (empty state, tabs, экранирование markup `<b>Учёба</b>` → `&lt;b&gt;`, длинные/emoji имена, break-words). Итого unit/pure: **29** (3 других экрана сохранены с прежними assertions).
- **Integration** `tests/auth/projects.auth.test.ts` (20): defaults empty; create DTO/DB (owner, UUID, sort_order 0, trim); duplicates; 120/121 cp; 12 невалидных payload → 400 без записи; 415/413/Origin 403 (hostile/null/missing) без записи; точный Origin → 201; markup name; status filter + stable ordering (вычисляемый tie-break); owner scope U/V; invalid UUID 400; unknown==foreign 404 (одинаковый body); rename + timestamps; combined PATCH; archive idempotency/restore/re-archive; конкурентные unrelated updates; **archive сохраняет связанную task** (fixture INSERT прямо в собственную test DB — ни detach, ни delete); foreign/unknown PATCH 404 + spoofed owner_id; revoked 401. Фикстуры — отдельные U/V + signInLocalUser (без конкуренции за limiter).
- **E2E** `tests/e2e/projects.spec.ts` (6): create Enter → rename (cancel без записи + focus return) → reload persistence; invalid name без создания; archive → архив tab → rename в архиве → restore; failed mutation (route 500): draft/список сохранены, уход на /today при held request, retry успешен; длинное имя + markup + без overflow; mobile 360 (keyboard, tabs, overflow). Фикстуры — **пользователь A**: settings.spec завершается logout'ом B (параллельная ревокация ломала B-сессии — найдено прогоном, исправлено); projects данные не пересекаются с theme/settings. Serial mode в файле; счётчики строк через `li[data-project-id]`; `toHaveCount(0)` по role=alert заменён на конкретный текст (Next route announcer — постоянный пустой alert в DOM — найдено прогоном).

### 7. Dev StrictMode probe
Реальный `next dev` (StrictMode по умолчанию), порт 3245, уникальная БД + synthetic пользователь (provisionLocalUser), временный untracked playwright-скрипт:
`DEV_READY after 2s` → `DEV-SUCCESS: create применён, проект переживает reload` → `DEV-FAILURE: ошибка видима, строки нет; retry успешен` → `DEV CHECK PASS`, exit 0. Cleanup: dev-сервер остановлен по слушателю порта, dev-БД удалена, `next-env.d.ts` возвращён к HEAD-байтам, temp-скрипты удалены.

## Проверки (Node v24.21.0 / npm 11.19.0)

| Команда | Результат |
| --- | --- |
| `npm ci` | exit 0, lockfile неизменен |
| `npm run lint` / `npm run typecheck` | exit 0 / exit 0 (strict), без warnings |
| `npm test` | exit 0 — **29 passed** |
| `npm run test:db` | exit 0 — **47 passed** (schema не менялась) |
| `npm run test:auth` №1 / №2 (последовательно) | exit 0 — **71/71** оба (51 + 20 projects); 0 lifecycle-паттернов в обоих логах |
| `CI=1 E2E_PORT=3247` / `3248` (последовательно) | exit 0 — **69/69** оба (63 + 6 projects); 0 lifecycle-паттернов |
| `npm run build` без `.env` | exit 0; ƒ Dynamic: /api/v1/projects, /api/v1/projects/[projectId], /projects (+ прежние) |
| Real `next dev` browser probe | DEV CHECK PASS (выше) |
| Leftovers | orbit_test\*-баз: 0, соединений: 0; `git diff --check` чист |

## Решения в рамках TASK (для сведения Codex)

1. **Settings route рефактор на общие `src/server/http.ts`** — эквивалентные хелперы, порядок проверок и поведение не менялись (51 auth-тест как regression-щит).
2. **projects.spec на пользователе A** — settings.spec ревокирует сессию B (logout в leakage-сценарии); найдено первым прогоном (все B-тесты получили redirect на /login). Данные projects изолированы от theme/settings по таблицам.
3. **Focus return через state+effect** (`renameFocusTarget`) — trigger-узел уничтожается пересозданием строки; синхронный `getElementById` в обработчике выполняется до коммита. Эффект без setState (react-hooks/set-state-in-effect), nonce через ref (react-hooks/purity).
4. **`toHaveCount(0)` по role=alert заменён на текстовый** — Next route announcer присутствует в DOM как пустой alert всегда.
5. Archive timestamp — SQL `COALESCE` в рамках поддерживаемого Drizzle `.set(sql\`...\`)`.

## Известные ограничения / не проверено

- Реальные устройства/production/reverse proxy не проверялись; Origin-политика за TLS-терминацией — deployment-этап.
- Task list внутри проекта, deletion/reorder/colors/sharing — вне TASK (UI не изображает); исключение задач архивного проекта из будущих task queries — инвариант TASK-007+.
- Strict ordering конкурентной записи одного поля не asserted (last write wins); revision/ETag не вводились.
- Sign-in limiter single-process; прежние tooling/audit ограничения TASK-003/004 действуют; npm audit не пересчитывался (новых зависимостей нет).
- Stable ordering проверяется на фактически возвращённых DTO (вычисляемый tie-break), специальной фиксации одинаковых created_at через API нет.

## Git

- Ветка `task/TASK-006`, worktree `/Users/atlhnv/Codex/orbit-worktrees/TASK-006`.
- Starting SHA `bcde56f30be4dd3e09e3819151a41fcac7134651`; реализация — обычные новые коммиты; latest full SHA сообщён после commit (в файл не вписывался).
- Merge/push/amend/rebase/reset/stash не выполнялись; main, другие worktree, localhost:3000, CRM/VPN, coordination docs не менялись; secrets только в untracked `.env`.

## Итог

TASK-006 реализован по scope (project list/read/create/rename/archive/restore, owner-scoped service, versioned API, реальный /projects UI). Остановка до независимого review Codex; TASK-007 не начинался.
