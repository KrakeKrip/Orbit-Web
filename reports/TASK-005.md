# TASK-005 — независимое review Codex

2026-10-08. **NEEDS_FIXES**. Проверена реализация `458d8100987fcf58aa07f26d1b2e1f6bb21d3bc3`, старт assignment `d5c949249a359616f5d4fd78fea8b852f2e13b4f`, audit base `738dbec9a333147484284d63e3e51a4c5cde0312`. Branch task/TASK-005, worktree /Users/atlhnv/Codex/orbit-worktrees/TASK-005. Implementation diff от assignment: 22 файла, 1825 insertions/56 deletions. Перед review дерево чистое, git diff --check чист. Merge/push/deploy не выполнены, TASK-006 не выдан.

## Обязательные исправления

### R1 [P2] Запоздавший отказ PATCH прежнего аккаунта меняет тему нового

`src/components/orbit/account-theme-select.tsx:61–74`: callback после await вызывает глобальный next-themes setTheme(confirmed) при отказе/exception. Нет отмены запроса/проверки mounted и принадлежности текущему actor. При unmount React игнорирует собственные setState, но setTheme обновляет сохраняющийся root provider и localStorage — поэтому callback старого экрана всё ещё действует.

Независимое воспроизведение настоящим Chromium на собственном production E2E server, unique DB, порт 3230, synthetic users A/B:
1. A имеет подтверждённую light, выбирает dark. Ответ PATCH удержан route intercept.
2. Пока сохранение pending, A выходит через настоящий logout и B входит через настоящий login, в том же browser context/storage.
3. У B DB theme=system, prefers-color-scheme=dark, html корректно dark.
4. Старый PATCH A получает контролируемый 500. html B становится **light**, orbit-theme=**light**, хотя DB settings B остаются system.

Это нарушение явного TASK требования «поздние ответы A не меняют UI B». Серверная owner isolation в данном сценарии не нарушена; дефект в presentation/cache и lifecycle callback.

Исправить lifecycle settings save: ответы после unmount/смены actor должны игнорироваться, включая rollback setTheme и ошибки/catch/finally. Отмена через AbortController полезна, но сама по себе недостаточна, если её exception также откатывает theme. Применение server preferences/контролы должны быть scoped по actor; не добавлять client owner_id как источник серверной identity. Не откатывать законно завершённые DB записи A после клиентской отмены — требуется защитить текущий UI, а не менять transaction protocol.

Acceptance: browser regression с удержанным PATCH A, logout → login B и последующим 500/network rejection старого запроса: B сохраняет свою server theme в html и orbit-theme, не получает ложный статус старого save. Проверить также уход со Settings при pending и обычный error rollback без смены аккаунта. Обычные theme save/refresh/new context/system assertions сохранить.

### R2 [P2] Ответ timezone save стирает новый draft, введённый во время запроса

`src/components/orbit/timezone-field.tsx:49–57` и editable Input: save отправляет значение на момент старта, но Input остаётся доступным; по ответу безусловно setDraft(savedTimezone) и status=saved.

Независимый Chromium probe (контролируемый delayed 200): отправлено Asia/Tokyo → во время pending введено Europe/Moscow → пришёл ответ `{settings:{timezone:"Asia/Tokyo",theme:"system"}}` → поле стало **Asia/Tokyo**, новый draft Europe/Moscow потерян, отображается «Часовой пояс сохранён».

Исправить согласованность draft/request: либо запретить редактирование поля на время save, либо отслеживать версию отправленного draft и не перезаписывать более новый текст/не считать его сохранённым. Input/submit/pending feedback должны явно отражать выбранное поведение; ошибка по-прежнему оставляет доступный retry draft, Enter и keyboard доступность сохраняются.

Acceptance: deterministic browser regression с delayed response, попыткой изменить timezone во время pending и проверкой отсутствия потери ввода/ложного saved state. Если input disabled — это явно asserted; если редактирование разрешено — более новый draft остаётся и требует отдельного сохранения.

## Подтверждённая часть реализации

Pure enum/timezone canonicalization, defaults UTC/system, offset rejection, строгий PATCH subset; GET missing row без INSERT; PostgreSQL field-specific atomic upsert сохраняет unrelated fields, created_at и owner boundary. Session-derived actor, cookie mutation Origin policy, no-store success/errors и body streaming limit; server errors не печатают SQL/секреты. Server theme bridge не инициирует PATCH при mount. Test fixtures изолированы, production limiter не ослаблен. signInLocalUser — CLI/test provisioning module, не HTTP route; использует поддерживаемый Better Auth API/временный test secret. Schema/миграции/dependencies не менялись.

Фактические независимые gates Node 24.21.0:
- npm ci --offline PASS, lint/typecheck PASS без warnings, npm test **15 PASS**.
- test:db **47 PASS**.
- test:auth **51 PASS**, exit 0, без lifecycle errors.
- CI=1 E2E_PORT=3229 test:e2e **62 PASS**, exit 0, без lifecycle errors. Assertions существующей регрессии сохранены; PASS не покрывает выявленные delayed response сценарии.
- Build без .env/DATABASE_URL/BETTER_AUTH_SECRET/BETTER_AUTH_URL/TEST_DATABASE_URL на git archive snapshot с собственной npm ci PASS; workspace/settings API Dynamic.
- Дополнительные browser probes выше подтверждают R1/R2; app source координатором не менялся. Test server закрыт с clean completion; leftover orbit_test_* DB **0** после suites/probes.
- Executor заявляет два auth/E2E прогона; Codex в этом review выполнил по одному, поскольку два конкретных browser defects уже требуют коррекции. После исправлений повторить обязательные gates TASK и regressions.

## Ограничения

Реальные устройства/production/reverse proxy не проверены. Timezone лишь preference, расписание ещё отсутствует. Прежние memory limiter/pool registry/dependency audit ограничения сохраняются; новых dependencies нет. Основные контракты service/API менять не требуется для исправления UI lifecycle. Контроль same-field strict completion order не является новым blocker.

## Передача GLM

Та же ветка/worktree. Исправить только R1/R2 и связанные regressions, обновить reports/TASK-005-executor.md. Обычные новые commits без amend/rebase/reset/merge/push/deploy; main/3000/CRM/coord docs/защитные настройки не менять. Вернуть full latest SHA и READY_FOR_REVIEW либо точную BLOCKED диагностику. TASK-006 не начинать.


## Повторное review 050ce13 — 2026-10-08

**NEEDS_FIXES: R1/R2 закрыты в production; осталось R1b [P2] для Next dev/StrictMode.** Проверен `050ce13a00286227f8607db5381a3391263bb218` относительно `08b348c020840eec0dc4f6f53afdc6316f448b1d`: фактически 5 файлов (4 implementation/test + executor report), 205 insertions/20 deletions. Service/API/schema не менялись. Merge/push/deploy не выполнялись, TASK-006 не выдан.

### Закрытые R1/R2
Независимый Chromium probe повторён на собственном production server 3237/unique DB: delayed PATCH A → настоящий logout/login B → delayed 500. У B server theme=system/prefers dark; html до/после **dark**, local cache после **system**. Прежний callback больше не перекрашивает B. Timezone delayed response: input **disabled во время pending**, результат Asia/Tokyo показан и сохранённое состояние корректно подтверждается. Прежние обычные error/retry/keyboard assertions и новые browser regressions прошли.

### R1b [P2] mounted guard навсегда false после StrictMode effect replay
`src/components/orbit/account-theme-select.tsx:59–69`: ref инициализируется true только при рендере, эффект содержит один cleanup со сбросом false. Setup не восстанавливает true. React StrictMode в Next dev выполняет setup → cleanup → setup, сохраняя ref; после этого isCurrentSave всегда false даже для живого компонента текущего actor.

Независимое воспроизведение на настоящем `next dev` с настройками проекта (StrictMode не выключался), собственный порт **3236**, synthetic account, новая собственная PostgreSQL test DB:
- Выбор dark: PATCH **200**, DB theme **dark**, UI спустя ответ всё ещё **«Сохранение темы…»**, «Тема сохранена» отсутствует.
- Следующий выбор light тоже записывает DB light, но UI не подтверждает save. На failed PATCH rollback/error handling по той же причине пропускаются.
Production E2E используют next build, поэтому все 63 assertions проходят и dev-регрессию не видят.

Исправить симметричный lifecycle guard: каждый setup эффекта восстанавливает mounted=true, cleanup ставит false; сохранить проверки принадлежности actor/неактуальных async completions. Не выключать StrictMode и не удалять guard. Убедиться, что actor-specific state не применяется после ухода/смены пользователя.

Acceptance: тест или реальный dev browser сценарий с StrictMode replay — normal 200 подтверждает save и сбрасывает pending, failed/network error откатывает theme и показывает ошибку. Сохранить production regressions delayed A failure после login B, уход со Settings и timezone disabled при pending. Не перерабатывать service/API/schema.

### Независимые проверки исправленного commit
Node 24.21.0: lint/typecheck PASS без warnings, npm test 15 PASS; DB 47 PASS; auth 51 PASS; CI=1 E2E_PORT=3235 — 63 PASS, все exit 0, logs без lifecycle errors. По одному auth/E2E прогону Codex; заявленные 2× — executor evidence, не выдаются за повтор Codex.
Дополнительные production probes подтвердили R1/R2; реальный dev probe подтвердил R1b. Все собственные server/browser/DB ресурсы закрыты, leftover orbit_test_* **0**. next dev автоматически добавил framework block в AGENTS.md и изменил generated next-env.d.ts; Codex вернул ровно эти автоматически созданные изменения к исходным HEAD bytes (дерево до запуска было чистым), не затрагивая пользовательские правки/историю. Product source координатором не реализовывался.
Реальные устройства/production proxy не проверены, прежние ограничения сохраняются. TASK остаётся NEEDS_FIXES до закрытия dev regression.

### Следующая передача GLM
Та же ветка/worktree, только R1b lifecycle setup/reset и regression, обновить executor report. Обычные новые commits без merge/push/amend/rebase/reset/deploy. Не менять main/3000/CRM/coord docs/защитные настройки; не отключать StrictMode. После соответствующих gates вернуть latest SHA и READY_FOR_REVIEW. TASK-006 не начинать.

Отдельный no-env build архивного snapshot 050ce13 с собственной npm ci также PASS: workspace и settings API Dynamic, runtime auth/DB env отсутствовали.


## Финальное review 2c3298b — 2026-10-08

**APPROVED для локальной интеграции. R1/R2/R1b закрыты.** Проверен `2c3298b382c798838e2ec19ef004d392526c09aa` относительно `12ac7775c9958db4d5f1cde7e51a47bf1af0b104`: 2 файла (один product component + executor report), 49 insertions/6 deletions. Mounted guard теперь симметричен при StrictMode replay; actor checks и unmount stale-response suppression сохранены. Service/API/schema/dependencies не менялись.

Независимые gates Node 24.21.0: lint/typecheck без warnings, 15 unit/pure, 47 DB, 51 auth, CI=1 E2E_PORT=3241 — 63 browser PASS, все exit 0, logs без lifecycle errors. Предыдущие delayed-response/account switch/timezone pending regressions сохранены.
Реальный Next dev/StrictMode на собственном порту 3242/unique test DB/synthetic account: PATCH 200 → DB dark → pending отсутствует, «Тема сохранена» видима; следующий выбор light с контролируемым 500 → DB остаётся dark, html откатывается dark, alert видим. Все ресурсы закрыты. Первый probe остановился на неоднозначном getByRole(alert), поскольку Next добавляет route announcer alert; повтор с точным span locator завершился exit 0 — ошибка review-helper, не product defect. Автоматические next dev изменения AGENTS.md/generated next-env.d.ts возвращены к исходным HEAD bytes; пользовательских изменений до запуска не было.

Постоянного отдельного dev-mode suite нет: реальный dev replay проверен независимо и executor procedure сохранена в отчёте; это неблокирующее ограничение, не причина расширять TASK. Root settings/defaults/owner isolation/Origin/no-store/upsert semantics остаются ранее подтверждёнными. Real devices/production proxy/deployment не проверялись, прежние limiter/tooling audit ограничения сохраняются.

Следующий шаг: локальный no-ff merge в чистую main, integration checks и no-env build, затем DONE. TASK-006 этим review не выдан; push/deploy не разрешены.


## Локальная интеграция — DONE, 2026-10-08

Принятая реализация `2c3298b382c798838e2ec19ef004d392526c09aa`, review commit `6f8d863f3a6bff3e2c6349f98bb7946257feb1f0`, локальный merge --no-ff **`40f72596ec0c7d758f786cde65f59ec91467e822`**. Main перед merge была чистой, конфликтов нет, история сохранена.

На интегрированной main независимо: npm ci --offline; lint/typecheck; 15 unit/pure; 47 DB; 51 auth; CI=1 E2E_PORT=3243 — 63 E2E; build без .env/DATABASE_URL/BETTER_AUTH_SECRET/BETTER_AUTH_URL — все PASS/exit 0. Auth/E2E logs без lifecycle errors. Settings API и workspace Dynamic, no runtime fallback. Suites использовали только own unique test DB; реальные personal accounts/dev DB не создавались/не мигрировались. TEST_DATABASE_URL передан из ignored локальной конфигурации без вывода секретов и без записи .env в main.

TASK-005 DONE, Foundations завершён, TASK-006 не выдан. Координационные статусы актуализированы; push/deploy/изменение защитных настроек не выполнялись. Реальные устройства/production proxy не проверены. Следующий пункт очереди — project CRUD TASK-006, начало только после отдельного assignment.
