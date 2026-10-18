# Orbit — Technical architecture

## Stack
- Next.js App Router, TypeScript, React.
- Tailwind CSS + shadcn/ui or equivalent accessible primitives.
- PostgreSQL + Drizzle ORM with checked-in migrations.
- Better Auth for email/password sessions and server-side authentication. Integrate through its documented Next.js and Drizzle APIs; verify package APIs during installation.
- Zod schema validation at server boundaries.
- Vitest for pure rules and integration tests; Playwright for minimum end-to-end flows.
- Docker Compose for local Postgres and, after local verification, application deployment. Reverse proxy with TLS for public access.

## Runtime architecture
Responsive Next.js UI -> authenticated server handlers / route handlers -> typed application service -> Drizzle/PostgreSQL.
No microservices or message bus in MVP. Keep task operations in reusable services so a future authenticated MCP adapter can call the same authorization and business logic, rather than duplicating queries.

## Data model (logical)
- Better Auth-managed `user` and session/account tables; do not manually assume their complete structure.
- `user_settings`: user_id PK/FK, timezone IANA string, theme, created_at, updated_at.
- `projects`: id UUID PK, owner_id FK, name, sort_order, archived_at nullable, created_at, updated_at.
- `tasks`: id UUID PK, owner_id FK, project_id nullable, parent_id nullable, title, notes, priority 1-4, planned_date nullable (DATE), planned_time nullable (TIME), deadline_date nullable (DATE), recurrence_rule nullable (restricted enum/config for MVP), sort_order, completed_at nullable, deleted_at nullable, created_at, updated_at.
- `task_completions`: id UUID PK, owner_id FK, task_id FK, occurrence_date nullable DATE, completed_at timestamptz, unique key / transaction guard to prevent duplicate recurrence advancement.

Indexes for owner_id and typical owner/date/completion queries. FK constraints, ownership checks for every nested reference; no reliance on frontend filtering. Avoid leaking task existence in cross-owner API responses.

## Date and recurrence policy
- DATE values represent calendar dates in the user's timezone, not UTC midnight timestamps. Optional planned TIME is interpreted in that timezone. All event timestamps use timestamptz in DB.
- `deadline_date` is independent of `planned_date`.
- MVP recurrence values: DAILY, WEEKDAYS, WEEKLY (weekly anchored to task's weekday). Additional recurrence patterns later.
- Recurrence requires planned_date; deadlines on recurring tasks are unsupported in MVP to avoid ambiguous meanings.
- Completion of recurring task transactionally inserts completion log and advances planned_date to the first eligible date strictly after the greater of current scheduled date and completion date. Guard against double-completion race/retry.
- Define a stable reopening rule: one-off tasks can be reopened; completion history for repeating tasks is shown, but undoing a past occurrence is postponed to a later version unless explicitly supported with safe transactional semantics.

## Security
- Public signups disabled via server-side auth configuration; initial account created by a documented one-time operator/admin procedure (no open temporary production signup endpoint).
- Secure session cookies and CSRF defenses from selected auth framework; secrets only server side. Protect against IDOR by checking owner on every project/task read and mutation.
- Validate inputs, apply lengths and date bounds; avoid raw SQL built from input.
- Rate-limit sign-in; enforce HTTPS in deployment; never expose database port publicly.
- Backups (nightly PostgreSQL dumps, encrypted if stored off-server) and documented restore procedure before production personal use.
- Distinct local/dev and production secrets; `.env.example` includes keys without values.

## Deployment constraints
Deploy to the user's existing VPS only after reviewing free RAM, disk space, open ports and reverse-proxy/VPN conflicts. Do not modify, interrupt or reconfigure the existing VPN deployment as a side effect. Use dedicated hostname and reverse proxy, isolated network/service, explicit resource and backup policy.

## API/business service capabilities
- projects: list/create/rename/archive.
- tasks: list with filters, quick-create, update, complete, reopen one-off, soft-delete, get detail; enforce project/parent ownership.
- occurrences: completion history and schedule advancement for recurring tasks.
- settings: get/update timezone/theme.

## Later MCP adapter (NOT in MVP)
User-authorized ChatGPT integration must call existing task services using a scoped user identity and appropriate consent/authorization. Never expose a single admin token or global data to all users. Avoid promising that arbitrary ChatGPT clients/plans support write operations before validating actual eligibility.

## Quality gates
- Typecheck, lint, unit tests for recurrence/timezone/date semantics, authorization integration tests, mobile navigation E2E, production build.
- Seed realistic development-only tasks with no personal private data.
- Document migrations, local startup, environment setup and backup restoration.

## References (reviewed 2026-10-08)
- https://nextjs.org/docs/app
- https://nextjs.org/docs/app/guides/progressive-web-apps
- https://better-auth.com/docs/installation
- https://better-auth.com/docs/adapters/drizzle
- https://better-auth.com/docs/reference/options

## INITIAL SETUP: уточнения и границы
Архитектура преимущественно целевая. TASK-001 реализовал Next.js foundation; TASK-002 — responsive shell, five routes и local theme selection. БД, auth и task services пока отсутствуют. Используется именно shadcn/ui на Tailwind, не произвольная замена.

### Структура кода после соответствующих TASK
- src/app: App Router, layouts, route handlers, Server Actions; минимальная HTTP-обвязка.
- src/components/ui: shadcn/ui; src/components/orbit: интерфейс продукта.
- src/lib: локализация, чистые правила дат/recurrence, общие утилиты.
- src/server/auth: Better Auth, requireUser; src/server/db: Drizzle schema/client.
- src/server/services: бизнес-операции с доверенным actor из requireUser; этот слой не принимает owner_id от клиента.
- drizzle: проверяемые SQL migrations; tests: integration и E2E по мере появления функций.
Не создавать пустые слои только ради схемы. TASK-001 создаёт только Next.js foundation, не auth/db/services.

### Авторизация и целостность
Проверка сессии в layout/proxy — удобство навигации; каждый server entry point и service обязательно проверяет пользователя. Персональные данные не попадают в общий cache или PWA cache.
Связи task→project и task→parent проверяются в транзакции; схема должна обеспечивать совпадение owner через составные ключи/FK там, где применимо. Проверка архива, глубины и проекта обязательна и на update/move. Конкретная физическая схема утверждается в TASK-003, формат auth tables — по Better Auth.

### Повторное завершение recurrence
Одного idempotency key недостаточно: два клика могут иметь разные ключи. Добавить revision задачи; completion передаёт expected_revision и idempotency_key. В транзакции блокировка задачи/compare-and-swap, проверка owner и текущей revision, unique(owner_id, idempotency_key), запись occurrence и увеличение revision вместе с переносом даты. Повтор того же ключа возвращает сохранённый результат; устаревшая revision не завершает следующую occurrence. Клиент обновляет состояние при конфликте. Формат ошибок и физические ограничения детализируются в TASK-011 до реализации.

### PWA
MVP требует онлайн-доступа к данным. Manifest и icons плюс проверка установки; service worker не обязателен для первого MVP. Если появится, не кешировать authenticated HTML/API и не реализовывать очередь offline mutations.

### Инструменты foundation
npm и единственный package-lock.json; Node.js 24 LTS как целевой runtime. На машине координатора обнаружен Node 26.10.0, это не проверка совместимости приложения. GLM фиксирует совместимые стабильные версии, engines/.nvmrc и фактический runtime отчёта. ESLint запускается напрямую, build не заменяет lint/typecheck. Сборка foundation не требует БД, auth secrets, внешних шрифтов или сетевых runtime-запросов.

Проверенные официальные источники (2026-10-08):
- https://nextjs.org/docs/app/getting-started/installation
- https://better-auth.com/docs/authentication/email-password (server disableSignUp)
- https://nextjs.org/docs/app/guides/progressive-web-apps

## Проверенное состояние после TASK-001 (2026-10-08)
Next 16.4.0 / React 19.3.0 / Tailwind 4.3.3 через @tailwindcss/turbopack; TypeScript 5.9.3 strict, ESLint 9.39.5, Vitest 5.0.3. Node 24.21.0 / npm 11.19.0 использованы для независимого review. Статическая русская стартовая страница и SVG favicon; команды и локальный запуск в README. cacheComponents/partialPrefetching включены, фактических персональных данных/cache нет. Перед auth интеграцией проверить session/logout/cache границы. Известные tooling ограничения — reports/TASK-001.md.

## Клиенты и общий сервер (уточнение пользователя)
Первый релиз — веб/PWA онлайн. Далее планируются приложения iOS и macOS; Telegram возможен, формат (бот/Mini App) пока не выбран. Native UI frameworks пока не утверждены. Офлайн и синхронизация локальных изменений — отдельный будущий этап.
Общий сервер — один источник данных и бизнес-правил. Next.js Server Actions служат веб-клиенту, а HTTP API должен предоставлять операции будущим клиентам без привязки к внутреннему формату Server Actions. До первого CRUD TASK зафиксировать versioned API contracts, validation/errors и разделение transport/services. Auth для native, Telegram linking и MCP credentials проектируются в соответствующих отдельных TASK; не использовать общий admin token. Реализации API и native приложений сейчас нет.

## Проверенное состояние после TASK-002 (2026-10-08)
Route-group (workspace) использует общий AppShell; / перенаправляет на /today, дополнительно /inbox /upcoming /projects /settings. Desktop/sidebar от 960 px, mobile header/bottom nav ниже; UI strings в src/lib/i18n/ru.ts. Данные на экранах — честные development placeholders, не ответ DB.
shadcn radix-nova Button/Select, consolidated radix-ui и cn package по generated CLI; CSS role surface — alias card. ThemeProvider next-themes: root class, default system, orbit-theme в localStorage. Theme selection локальная, account persistence в TASK-005. Runtime Next/React/Tailwind versions не менялись.
Vitest 4 screen-render tests + Playwright 47 browser tests, production build/boot в составе E2E. Независимый review подтвердил mobile areas >=44×44, keyboard/refresh/system preference/navigation/no overflow. Реальные устройства/auth/DB/PWA этим не подтверждены.

## Контракт TASK-003 (задание, ещё не реализация)
Auth core schema генерируется под закреплённую Better Auth версию без публичной auth интеграции; auth user ID text, доменные IDs UUID. Composite FK удерживают owner для project/parent/completion links. task revision integer >=0; completion хранит completed_revision до операции и idempotency_key, unique(owner_id, idempotency_key) и unique(task_id, completed_revision). Runtime completion/locking/retry semantics реализуются в последующих TASK. Parent depth/cycles/same project, archive и timezone validation остаются service invariants; обычные FK их не доказывают. Lazy server DB client не требует env/БД для существующих UI build/tests. PostgreSQL integration suite отделена от npm test и работает лишь с явно выбранной isolated local test DB. Длины: project name 120, task title 500, notes 10000, idempotency key 128; DB checks, timezone default UTC, theme default system. PostgreSQL 17 для локальной среды; deployment не входит в задание.

## Проверенное состояние после TASK-003 (2026-10-08)
Локальный PostgreSQL 17.11-trixie (Compose loopback 55432), Drizzle ORM 0.45.3/kit 0.31.11, pg 8.23.1. Core auth schema сгенерирована для Better Auth 1.7.7, runtime auth ещё не подключён. Доменные таблицы/owner composite FK/checks/completion revision журнал и SQL migrations реализованы. Lazy pg pool пока без enforceable server-only marker; добавить перед app/service подключением. DB suite отдельна от UI: 47 tests, явный local target без query overrides, уникальные per-run/fixture DB и cleanup своих ресурсов. Unit/UI 4 и browser 47 tests; main build без env/БД подтверждён. Completion алгоритм, межстрочные parent/archive правила, IANA validation и auth security остаются следующим TASK. Генератор deprecated CLI 1.4.22 включает старые вложенные auth/ORM; audit ограничения описаны в reports/TASK-003.md, до deployment требуется пересмотр toolchain.

## Контракт TASK-004 (реализован и принят 2026-10-08)
Runtime Better Auth email/password disableSignUp=true, отдельный CLI-only bootstrap, server session guards и минимальный GET /api/v1/me для actor identity. Minimal logout входит в auth TASK ради revocation проверки; settings persistence остаётся TASK-005. Cache Components/partialPrefetching отключаются на этапе auth integration до появления обоснованных cached data paths; session cookie cache также OFF, request-time session validation. Build/UI tests без env/DB, runtime auth требует явной конфигурации и fail-closed behavior. Sign-in limiter enabled (допустима single-process memory storage до deployment), trustedOrigins ограничены; CSRF/origin defense не отключается. Auth/browser tests на собственной уникальной DB, не dev. Enforce server-only boundaries до app data подключения. Native auth/API расширение вне этого TASK.

Проверенное состояние TASK-004: runtime Better Auth 1.7.7, signup OFF, trustedOrigins explicit, cookie cache OFF, single-process sign-in limiter 10/60s; lazy server-only app boundary. Pool общий source/compiled Next через globalThis registry (одно app/DATABASE_URL на процесс). CLI provisioning использует adapter transaction=true, нормализованный email и rollback собственных rows по returned primary key. Protected five routes и /api/v1/me возвращают actor только из session. Main 4 UI/47 DB/31 auth/56 E2E и no-env build PASS; реальные устройства/deployment не проверены. Test teardown закрывает фактический pool и связывает локальный shutdown completion с runner: forced cleanup → gate failure. Account settings/CRUD пока не реализованы.


## Контракт TASK-005 (реализован и принят 2026-10-08)
GET/PATCH /api/v1/settings — cookie-authenticated versioned transport; actor только requireUser, общая server-only settings service. GET отсутствующей row возвращает UTC/system без INSERT. PATCH валидирует непустой subset timezone/theme и atomically upsert-ит только переданные fields для actor PK; unrelated fields не теряются при concurrent updates. updated_at явный, created_at сохраняется. Timezone canonical named Intl IANA zone или UTC, offset/unknown запрещены; theme enum. DB — источник account preferences, orbit-theme — только UI cache; при входе/смене actor применяется server theme без auto-PATCH local cache. PATCH origin только exact configured base URL, missing/null/foreign запрещены; все ответы private/no-store, reusable error envelope. Settings test mutations изолированы по fixtures/owners, прежний auth lifecycle/лимиты не ослабляются. CRUD/PWA/native вне scope.

Проверенное состояние TASK-005: account preferences service и GET/PATCH /api/v1/settings работают на существующей user_settings, без schema/migration changes. Server-only/verified session actor, Origin policy, bounded JSON/no-store/errors, atomic partial upsert и canonical Intl timezone validation проверены HTTP/PostgreSQL suites. Workspace bridge применяет DB theme, local cache не пишет server preferences; stale UI callbacks после unmount/actor switch подавляются симметричным StrictMode-safe mounted guard. Timezone Input disabled при save. Main 15 unit/pure/47 DB/51 auth/63 browser и no-env build PASS; отдельный live dev success/error probe подтверждён, постоянной dev suite нет. Timezone schedule semantics/task/project CRUD пока отсутствуют.


## Контракт TASK-006 (принят)
Projects server-only service на существующей таблице, verified session actor во всех entry points; owner-scoped list/read/UPDATE, foreign и missing UUID одинаковый 404. GET/POST /api/v1/projects, GET/PATCH /api/v1/projects/[projectId]; list status active(default)/archived/all, stable sort_order/created_at/id ASC. POST name, PATCH subset name/archived, без client owner/sort/id. Atomic partial update, archive timestamp idempotent, related tasks не мутируются. DTO id/name/archivedAt/createdAt/updatedAt; cookie mutations требуют собственную exact configured Origin защиту и bounded JSON, все responses private/no-store. Schema/migrations, DELETE/reorder, task APIs вне scope. UI показывает только реальный project list/flows; late callbacks/StrictMode guards и fixtures ownership сохраняют инварианты TASK-005.

Проверенное состояние TASK-006: project service/server-only и versioned collection/item API реализованы на существующей schema без миграций; owner-scoped read/update, atomic partial PATCH, archive timestamp preservation, bounded JSON/exact media type/Origin/no-store. /projects работает с server data, принимает 120 Unicode code points без UTF-16 обрезания и блокирует смену rename editor во время pending. Main 29 unit/47 DB/72 auth/71 browser и no-env build PASS. Project tasks view/task CRUD/deletion/reorder/sharing ещё не реализованы; реальные устройства/proxy/deployment не проверены.

## Контракт TASK-007 (принят)
Server-only tasks service на существующей schema; GET/POST /api/v1/tasks (Inbox collection status=open|completed|all) и GET/PATCH/DELETE item. POST только title; PATCH title/completed; DELETE soft. DTO текущего subset id/title/projectId/parentId/completedAt/revision/createdAt/updatedAt без owner. Collection исключает deleted/dated/child/archived-project tasks, stable sort_order/created_at/id. Owner-scoped transaction+row lock сериализует one-off completion/reopen/delete и title update; completion log атомарен, completed_revision до перехода, occurrence_date=NULL, server-generated UUID key; повтор completed не пишет log, reopen сохраняет history. Revision увеличивается один раз на effective mutation, no-op не меняет timestamps/revision. Delete родителя soft-deletes own direct children атомарно. Project row lock согласует archive check с конкурентным archive; foreign/missing/deleted reads одинаковый404. Mutations recurrence/child —409 UNSUPPORTED_TASK, archived project —409 PROJECT_ARCHIVED до соответствующих TASK. Native/external auth не добавляется; cookie/Origin/exact JSON/2KiB/no-store contracts сохраняются. Полные acceptance/transaction fixtures — tasks/TASK-007.md; schema migrations не требуются.

Проверенное состояние TASK-007: Inbox tasks collection/item API и server-only service на существующей schema, atomic task/journal transitions под task→project row locks; completion/reopen/no-op revisions/soft delete parent+direct children проверены в HTTP/DB suites. Timestamps tasks/projects/settings используют clock БД (SQL now), сохраняя atomic partial write semantics. Inbox confirmed mutations/refetch, controlled read errors/retry, pending guards и keyboard confirmation focus/error/cancel/retry работают. Main 44 unit/47 DB/101 auth/83 browser и no-env build PASS; реальное устройство/production proxy не проверены. Schedule/project assignment/subtask/recurrence APIs и native clients ещё не реализованы.

## Контракт TASK-008 (реализован и принят)
Additive plannedDate/plannedTime/deadlineDate DTO/write fields в существующих tasks API, strict civil date/time validation и locked partial merge; title/completed/journal/revision/no-op/soft-delete/owner/archive guards TASK-007 сохраняются. GET tasks view=inbox|today|upcoming (default inbox), status=open|completed|all, start только upcoming; response tasks array + context timezone/today/asOf/view/range из own settings и единого PostgreSQL reference instant. Working views root one-off/non-deleted/active-project owner-scoped, Today union plan<=today OR deadline<=today с one-ID grouping, Upcoming plannedDate range7 inclusive. Pure calendar arithmetic/Intl Gregorian explicit zone, DATE не превращать в UTC event; TIME wall-clock label, instant/alarms/DST gap resolution вне scope. Tasks POST/PATCH4KiB (title500emoji+schedule), shared default/settings/projects/DELETE2KiB unchanged. Shared rows/controller + отдельный schedule editor вместо дублирования большого TasksView; UI state matrix, dirty-field PATCH, latest read/context response guards и network/focus regressions обязательны. Schema не меняется; external/native auth не добавляется.

Проверенное состояние TASK-008: server planning partial merge, own account context, Inbox/Today/Upcoming, общий Today comparator service/UI, shared rows/editor и lifecycle/write/read guards приняты. Auth timestamp WITHOUT time zone fixtures записывают UTC representation явно; implicit SQL local now для expiry не использовать. Финальная независимая проверка Node24.21/PG18.6 — 69 unit/47 DB/124 auth/123 browser/no-env build PASS; PG17/реальные устройства/production финально не проверены. Подробнее reports/TASK-008.md.

## TASK-009A: project tasks read API (задание, ещё не реализовано)

GET /api/v1/projects/[projectId]/tasks, status=open|completed|all(default open), UUID/strict query. Actor из requireUser; foreign/missing project404 идентичны. Own archived project read доступен, workspace filters по-прежнему исключают его tasks. Собственные root one-off/non-deleted tasks данного проекта, без фильтра по plan date; stable sort_order/created_at/id. Envelope project DTO + tasks DTO + server actor context timezone/today/asOf/view=project/projectId. No-store success/errors, без UI/assignments/writes/schema changes. Критерии tasks/TASK-009A.md.
