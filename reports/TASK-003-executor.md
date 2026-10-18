# TASK-003 — отчёт исполнителя (GLM)

## Статус

READY_FOR_REVIEW (после коррекций R1/R2 и R1b по review reports/TASK-003.md от 2026-10-08).

## Correction R1b — неразрушающая sentinel-фикстура в regression-тесте

Старт коррекции: HEAD `fcaa4a0` (coord-коммит, R2 закрыто) поверх `d200fa6`. Изменён только `tests/db/runner.db.test.ts` + этот отчёт; runner (`db-target.ts`, `runner.ts`, `global-setup.ts`, `helpers.ts`), схема, миграции, зависимости и UI не менялись.

- Убрано `DROP DATABASE IF EXISTS "orbit_test"` из sentinel-теста (тот же запрещённый паттерн внутри обычного `npm run test:db`, на который указал review).
- Sentinel-фикстура теперь получает **уникальное** имя `orbit_test_sentinel_<rand>` и создаётся `CREATE DATABASE` **без предварительного DROP/IF NOT EXISTS**; флаг владения выставляется только после успешного CREATE.
- Cleanup (afterAll и пути сбоев setup/assertions — включая падения между CREATE и завершением теста) удаляет только успешно созданную фикстуру; существующие базы и данные не затрагиваются. Проверка строго фиксированного `orbit_test` на текущем кластере не выполняется (по review — допустима только в отдельном изолированном кластере).
- Проверено: `prepareTestDatabase` и teardown сохраняют заранее созданную фикстуру и её строку `keep-me` на всех этапах (до teardown, после teardown, после завершения теста).
- Разбиение числа DB-тестов в предыдущей редакции отчёта исправлено: **47 = 28 schema + 15 guard + 4 runner** (было ошибочно указано «12 guard + 7 runner»). Исторический раздел ниже описывает состояние ДО коррекций.

### Проверки после R1b (Node v24.21.0 / npm 11.19.0)

| Команда | Результат |
| --- | --- |
| `npm run typecheck` / `npm run lint` | exit 0 / exit 0 |
| `npm run test:db`, два последовательных запуска | оба exit 0 — **47 passed** (28 schema + 15 guard + 4 runner) |
| Проверка кластера после прогонов | только `orbit_dev` (+ служебный postgres): ни фикстуры, ни временных баз |
| `npm ci` | exit 0 |
| `npm test` | exit 0 — 4 UI tests |
| `npm run build` | exit 0 |
| `CI=1 E2E_PORT=3175 npm run test:e2e` | exit 0 — 47 passed |
| `git diff --check` / `git status` после коммитов | чисто |

Коммиты коррекции R1b: fix-коммит + обновление отчёта (полный latest SHA — в ответе пользователю).

---

## Correction R1/R2 — безопасный DB test runner (первая коррекция)

Старт коррекции: HEAD `736d460` (coord-коммит с review) поверх `3706dd2`. Изменены только затронутые области: `tests/db/` (новые `db-target.ts`, `runner.ts`, guard/sentinel тесты; переработаны `global-setup.ts`, `helpers.ts`), `README.md`, `.env.example` и этот отчёт. Зависимости, схема, миграции, compose и UI не менялись.

### R1 — раннер больше не уничтожает существующие базы
- Удалён предварительный `DROP DATABASE IF EXISTS … WITH (FORCE)`. Каждый запуск создаёт **новую уникальную** базу `orbit_test_<timestamp>_<rand>` через `CREATE DATABASE` **без IF NOT EXISTS**: коллизия/чужая база приводят к громкой ошибке, а не к удалению.
- Teardown удаляет только базу, успешно созданную этим запуском (флаг + проверка имени по шаблону раннера; при сбое миграций база удаляется там же, где создана). Ранее существовавшие `orbit_test`, `crm_test` и любые прочие базы не затрагиваются, подключения к ним не терминируются.
- `TEST_DATABASE_URL` теперь задаёт проверенный сервер и namespace `orbit_test`; имя в URL должно быть точно `orbit_test` (чужие namespace, включая другие `*_test`, отвергаются).
- Проверено sentinel-тестом: тест сам создаёт «ранее существовавшую» `orbit_test` с таблицей и строкой `keep-me`, выполняет настоящий `prepareTestDatabase`, и sentinel остаётся нетронутым на всех этапах; teardown удаляет только созданную базу. Два последовательных запуска создают разные базы и убирают только свои.

### R2 — guard проверяет эффективную конфигурацию подключения
- Единая валидация в `tests/db/db-target.ts`: только протоколы `postgresql://`/`postgres://`; **query-параметры запрещены целиком** (блокирует `?host=`-перенаправление); явно обязательны host/port/user/password/database — переменные `PGHOST/PGUSER/PGPASSWORD` и системный пользователь в подключение не попадают; hostname проверяется и в raw, и в percent-декодированном виде против allowlist localhost/127.0.0.1/::1 (IPv6-скобки нормализуются).
- Подключения (админ-создание/удаление базы, миграции, все тестовые клиенты) собираются **из проверенных частей** target; сырой URL в pg не передаётся. Админ-операции — на тот же проверенный сервер, в maintenance-базу `postgres`. Ошибки валидации не содержат user/password/URL.
- Guard-тесты (12, чистые, без сети/DDL): отказ без/с пустым `TEST_DATABASE_URL`; отсутствие fallback на `DATABASE_URL`; чужой протокол; `?host=10.0.0.5` и `?sslmode=disable`; remote host, произвольный домен, percent-закодированный remote; отсутствие порта/user/password; namespace `crm_test`/`production`; уникальность и шаблон создаваемых имён; сборка target из частей. Runner-тесты: отказ до DDL без разрешения/с fallback; отказ до DDL при remote и query-подмене.

### Актуализация по замечаниям review (не R1/R2, но требовалось в отчёте)
- **Картина audit уточнена** (прежняя формулировка «только braces» была неполной): полный `npm audit` — 21 finding (8 moderate, 12 high, 1 critical); critical — во вложенном дереве deprecated `@better-auth/cli` (better-auth 1.4.22 + drizzle-orm 0.41.0), основной стек better-auth 1.7.7 / drizzle-orm 0.45.3 — другие экземпляры. `npm audit --omit=dev` — 4 moderate в цепочке drizzle-kit→esm-loader→core-utils→esbuild (advisory о dev server): production audit **не чистый**, evidence об использовании уязвимого esbuild server приложением нет; при подготовке deployment — пересмотр toolchain, автоматический downgrade drizzle-kit не выполняется. Force-fixes не применялись.
- **Исправлено утверждение отчёта о FK**: `task_completions.owner_id` имеет и inline FK на `user(id)` (restrict), и composite FK (task_id, owner_id); фактически сгенерированный SQL содержит обе связи.
- Незаблокирующие замечания приняты к сведению без изменений кода (вне R1/R2): enforceable server-only boundary у client.ts — до первого app-подключения; политику auth timestamp timezone — подтвердить в TASK-004; дополнить owner-update сценарии (смена project_id/parent_id у task, task/owner у completion) в будущих service-тестах.
- Оценка нового официального CLI `auth` вместо deprecated `@better-auth/cli` — отдельное предложение вне коррекции (требует проверки совместимости вывода с закреплённой better-auth 1.7.7; текущая сгенерированная схема сверена review побайтово).

### Проверки после коррекции (Node v24.21.0 / npm 11.19.0)

| Команда | Результат |
| --- | --- |
| `npm ci` | exit 0 |
| `npm run lint` / `npm run typecheck` | exit 0 / exit 0 (strict) |
| `npm test` | exit 0 — 4 UI tests, без БД |
| `npm run test:db`, два последовательных запуска | оба exit 0 — **47 passed** (28 schema + 15 guard + 4 runner); после прогонов в кластере только `orbit_dev` и служебный `postgres` |
| `npm run build` | exit 0 |
| `CI=1 E2E_PORT=3161 npm run test:e2e` | exit 0 — 47 passed |
| `git diff --check` / `git status` после коммитов | чисто |

Коммиты коррекции: fix-коммит + обновление отчёта (полный latest SHA — в ответе пользователю).

---

## Исходная реализация (до коррекции R1/R2)

## TASK

TASK-003 — PostgreSQL, Drizzle и проверяемые миграции (локальная DB-инфраструктура, физическая схема, DB-интеграционные тесты).

## Исходное состояние (проверено до изменений)

- Worktree: `/Users/atlhnv/Codex/orbit-worktrees/TASK-003`; ветка `task/TASK-003`; дерево чистое.
- База review `af5d1f82dcd828272eadb4baa8ab19a79744e27d` — предок HEAD; поверх только assignment-коммит `a140480` (документы: tasks/TASK-003.md, AGENTS.md, TASKS.md, ARCHITECTURE.md, DECISIONS.md — без исходников).
- **Стартовый полный SHA: `a140480cf5b1d6f3dd76bd07c9ec6f6476279ba0`** (совпадал с main).
- Node v24.21.0 / npm 11.19.0 (локальный официальный runtime из /tmp/orbit-node24; системный Node не изменялся).

## Реализовано

### 1. Локальный PostgreSQL
- `compose.yaml`: только PostgreSQL `postgres:17.11-trixie` (последний поддерживаемый патч линии 17 по Docker Hub на 2026-10-08), project name `orbit`, именованный volume `orbit_pgdata`, healthcheck `pg_isready`, публикация порта **только на 127.0.0.1** (проверено `docker port`: `5432/tcp -> 127.0.0.1:55432`), порт/пользователь/имя базы/пароль — из `.env` (`${VAR:?}` требует заполненности), пароль не захардкожен.
- `.env.example`: имена переменных + безопасные локальные placeholders и пояснения. Реальный `.env` создан локально со сгенерированным паролем (`openssl rand -hex 24`), игнорируется Git (проверено `git check-ignore`), пароль отсутствует во всех трекаемых файлах (автопроверка) и в этом отчёте.
- Docker/Colima: daemon был остановлен; запущен существующий локальный Colima обычным `colima start` (без sudo/установки/смены контекста — Docker context уже был `colima`). Чужие контейнеры не трогались; после работы контейнер БД оставлен запущенным (dev-ресурс, останавливается `docker compose stop` без удаления данных).
- README: настройка env, up/healthcheck, миграции, изменение схемы, безопасная остановка (stop/down без `-v`), test DB.

### 2. Drizzle и будущий Better Auth
- Версии (npm, lockfile): `drizzle-orm` **0.45.3**, `drizzle-kit` **0.31.11** (dev), `pg` **8.23.1**, `@types/pg` **8.23.1** (dev), `better-auth` **1.7.7** (использует внутренний `@better-auth/drizzle-adapter` 1.7.7, peer-совместим с drizzle-orm ^0.45.2), `@better-auth/cli` **1.4.22** (dev, только для генерации). Источники: registry.npmjs.org, https://better-auth.com/docs/adapters/drizzle, https://orm.drizzle.team/docs/migrations.
- Core auth schema (`src/server/db/schema.auth.ts`): `user`, `session`, `account` (включая `password` для email/password), `verification` — получена официальным генератором: `npx @better-auth/cli generate --config scripts/auth-generator.config.ts --output src/server/db/schema.auth.ts -y` (better-auth CLI 1.4.22 для better-auth 1.7.7). Конфиг генератора `scripts/auth-generator.config.ts`: `betterAuth({ database: drizzleAdapter(drizzle(pool), { provider: "pg" }), emailAndPassword: { enabled: true } })`, без plugins; Pool ленивый и не подключается — генерация не требует ни реального URL/секрета (placeholder в fallback), ни работающей БД. Файл не редактировался вручную и воспроизводим этой командой (версии зафиксированы для TASK-004). Auth user id — `text` ✓.
- Никакого публичного auth handler/сессий/login/signup/bootstrap — только схема и конфиг генерации вне src/app.
- `src/server/db/client.ts` — ленивый server-only пул: на import ничего не подключается, `DATABASE_URL` не нужен; при явной операции без URL — понятная ошибка без секрета. `closeDbPool()` для явного закрытия.

### 3. Физическая схема (`src/server/db/schema.ts`)
- Таблицы (экспорты): `userSettings`→`user_settings` (user_id PK/FK→user, timezone text default 'UTC', theme enum light/dark/system default system, created_at/updated_at), `projects`, `tasks`, `taskCompletions`→`task_completions`; enum-типы `user_theme`, `task_recurrence_rule` (DAILY/WEEKDAYS/WEEKLY).
- Ownership composite FK: `projects`/`tasks` имеют UNIQUE (id, owner_id); `tasks.project_id+owner_id`→`projects(id,owner_id)`; `tasks.parent_id+owner_id`→`tasks(id,owner_id)` (self-referential composite); `task_completions.task_id+owner_id`→`tasks(id,owner_id)` — совпадение owner держится и на UPDATE (проверено тестами). Domain FK: ON DELETE/UPDATE NO ACTION/RESTRICT — никакого каскадного удаления задач; будущие удаления — soft delete.
- CHECK (31 constraint суммарно): имя проекта/title непустые после btrim и ≤120/≤500; notes ≤10000; priority 1..4 default 4; revision ≥ 0; planned_time⇒planned_date; recurrence⇒planned_date И отсутствие deadline_date; recurring задача не хранит постоянный completed_at; parent_id ≠ id; completed_revision ≥ 0; idempotency_key непустой после btrim и ≤128; timezone непустой. NOT NULL обязательных полей.
- Индексы: partial `tasks_owner_planned_date_idx`/`tasks_owner_deadline_date_idx` (owner+дата, WHERE deleted_at IS NULL — активные задачи), `tasks_owner_project_idx`, `tasks_owner_parent_idx`, `projects_owner_id_idx`, `task_completions_owner_completed_at_idx` (история). Уникальные (owner_id, idempotency_key) и (task_id, completed_revision) — одновременно ограничения и индексы; отдельных дублирующих индексов нет.
- Типы: событийные timestamp — timestamptz; planned_date/deadline_date/occurrence_date — DATE; planned_time — TIME WITHOUT TIME ZONE (физические типы подтверждены через information_schema тестом).
- `updated_at`: default now() при insert; обновление при UPDATE — обязанность сервиса/ORM, триггеров нет (документировано в README/комментарии схемы).
- **Остающиеся service invariants** (не обеспечиваются FK/CHECK, реализуются последующими TASK): один уровень вложенности и запрет циклов; совпадение проекта родителя/ребёнка (включая NULL); правила архивации и soft delete; IANA-валидация timezone; семантика completion повторений (использование completed_revision/idempotency_key — TASK-007/011).

### 4. Миграции и тесты
- `drizzle.config.ts` (schema: schema.auth.ts + schema.ts, out: drizzle/, strict). Checked-in миграция `drizzle/0000_gifted_echo.sql` + journal/snapshots. Скрипты: `db:generate` (drizzle-kit generate), `db:migrate` (scripts/db-migrate.ts: применяет к DATABASE_URL, закрывает пул). Schema push не используется.
- Проверено на пустой dev-базе `orbit_dev` (контейнер healthy, порт 55432): применение → exit 0; повторное применение → exit 0 без изменений/ошибок; генерация по неизменной схеме → «No schema changes, nothing to migrate», новых SQL-файлов нет.
- `vitest.db.config.ts` + `tests/db/global-setup.ts`: требуют явный `TEST_DATABASE_URL` (fallback на DATABASE_URL отсутствует), ДО любого DDL проверяют локальный хост (localhost/127.0.0.1/::1) и имя базы `[a-z0-9_]+_test`, пересоздают только эту базу (DROP IF EXISTS … WITH (FORCE) + CREATE), применяют миграции; подключения закрываются. Негативная проверка: `TEST_DATABASE_URL=postgresql://…@10.0.0.5:5432/prod_clone` → exit 1, «Refusing non-local test database host», 0 выполненных DDL.
- `tests/db/schema.db.test.ts`: 28 интеграционных проверок на реальном PostgreSQL через pg-драйвер (без моков), два синтетических пользователя: auth-схема (дубликат email), user_settings (defaults UTC/system, темы light/dark, дубликат PK, невалидная тема 22P02, blank timezone, FK), projects (defaults, trailing spaces сохраняются, blank/>120, неизвестный owner), tasks (Inbox-nullable и defaults; round trip DATE '2026-10-08'/TIME '19:30:00' через ::text; deadline без planned; planned_time без planned_date; recurrence без planned/с deadline; recurring с completed_at; priority 0/5 и 1/4; revision −1; blank title/>500; notes 10000/10001; self-parent; DAILY/WEEKDAYS/WEEKLY), ownership composite FK (чужой project/parent на INSERT; смена owner задачи и проекта на UPDATE; nullable project_id), task_completions (валидная one-off с occurrence_date; чужая задача; дубликаты (owner,key) и (task,revision); key blank/>128; negative revision; разные задачи/ключи). Физические типы (DATE/TIME/TIMESTAMPTZ) проверены через information_schema.
- `vitest.config.ts`: единственное изменение — exclude `tests/db/**` для отделения быстрой UI suite от DB suite (разрешено TASK).

## Изменённые файлы

| Файл | Что изменено |
| --- | --- |
| `compose.yaml` | новый: PostgreSQL 17.11-trixie, loopback-порт, volume, healthcheck |
| `.env.example` | новый: имена переменных и безопасные placeholders |
| `drizzle.config.ts` | новый: конфиг drizzle-kit (чтение .env без новых зависимостей) |
| `drizzle/0000_gifted_echo.sql`, `drizzle/meta/*` | новые: checked-in миграция + journal/snapshot |
| `scripts/auth-generator.config.ts` | новый: минимальный конфиг генерации Better Auth (вне src/app) |
| `scripts/db-migrate.ts` | новый: применение миграций с закрытием пула |
| `src/server/db/schema.auth.ts` | новый: сгенерированная core auth schema (не редактировался) |
| `src/server/db/schema.ts` | новый: доменные таблицы, composite FK, checks, индексы |
| `src/server/db/client.ts` | новый: ленивый пул + closeDbPool |
| `tests/db/global-setup.ts` | новый: pre-checks, изолированное пересоздание test DB, миграции |
| `tests/db/helpers.ts` | новый: подключения/два пользователя/expectPgError |
| `tests/db/schema.db.test.ts` | новый: 28 интеграционных проверок |
| `vitest.db.config.ts` | новый: отдельный DB suite config |
| `vitest.config.ts` | exclude tests/db (отделение suite) |
| `package.json` / `package-lock.json` | зависимости + скрипты db:generate/db:migrate/test:db |
| `README.md` | раздел БД: env/compose/миграции/остановка/test DB/схема/обновление стека |
| `reports/TASK-003-executor.md` | этот отчёт |

UI, маршруты, E2E и существующие UI assertions не менялись; корневые документы, docs/source, прежние задания/отчёты не менялись.

## Проверки (фактически выполненные, Node v24.21.0 / npm 11.19.0)

| Команда | Результат |
| --- | --- |
| до изменений: pwd/toplevel/branch/status/HEAD/log от базы, node/npm | окружение совпало с TASK |
| `colima start` (существующий локальный, был остановлен) | exit 0; docker engine 29.5.2 |
| `docker compose up -d` + healthcheck | healthy; `docker port` → 127.0.0.1:55432 |
| `npm run db:migrate` на пустую dev DB | exit 0 |
| `npm run db:migrate` повторно | exit 0, без ошибок и изменений |
| `npm run db:generate` по неизменной схеме | «No schema changes, nothing to migrate», новых файлов нет |
| `npm ci` | exit 0 (репродуцирует install по lockfile) |
| `npm run lint` | exit 0 |
| `npm run typecheck` | exit 0 (strict) |
| `npm test` | exit 0 — 4 UI tests, без БД/env |
| `npm run test:db` | exit 0 — **28 passed**; повторный прогон — exit 0, 28 passed (воспроизводимость пересоздания) |
| `TEST_DATABASE_URL=…@10.0.0.5:… npm run test:db` | exit 1, «Refusing non-local test database host», DDL не выполнялся |
| `npm run build` | exit 0, маршруты прежние (8, статические) |
| `npm run build` с временно перенесённым `.env` | exit 0 — UI build работает без env (`.env` возвращён) |
| `CI=1 E2E_PORT=3147 npm run test:e2e` | exit 0 — **47 passed** (собственный production webServer; localhost:3000 не занимался) |
| `git diff --check` / `git status --short` после коммитов | чисто; секреты только в игнорируемом `.env` (проверено автопоиском) |

## Решения в рамках локальной реализации (для сведения Codex)

1. `postgres:17.11-trixie` — выбранный поддерживаемый patch tag (последний 17.x в Docker Hub на дату), не latest.
2. `schema.auth.ts` оставлен ровно как сгенерировал CLI (включая `timestamp` без tz в auth-таблицах — конвенция Better Auth); доменные таблицы — timestamptz по TASK. Файл не «улучшался» ради сохранения воспроизводимости генерации.
3. `task_completions.owner_id` не имеет отдельного FK на user: composite FK на tasks(id, owner_id) транзитивно гарантирует существование owner и не создаёт дублирующий индекс.
4. В fallback-строке подключения конфига генератора — заведомо фиктивный пароль `placeholder` (подключения не происходит); реальный пароль нигде в трекаемых файлах (проверено автопоиском по значению).
5. Пересоздание test DB через `DROP DATABASE IF EXISTS … WITH (FORCE)` допустимо, потому что выполняется только для базы, явно названной в `TEST_DATABASE_URL` и прошедшей pre-checks (локальный хост + суффикс `_test`).
6. `process.loadEnvFile` (Node 24) вместо dotenv — без новой зависимости.

## Дополнительные изменения (вне перечисленного scope)

Нет.

## Не проверено

- Переживание перезапуска контейнера/хоста (named volume сохранение) — не тестировалось; остановка/удаление только через documented-команды.
- Реальный деплой PostgreSQL вне локального Docker — вне TASK.
- Better Auth runtime-поведение (сессии/регистрация) — сознательно не подключался (TASK-004).

## Известные проблемы

1. Полный `npm audit` остаётся с high по известной dev-цепочке (braces через eslint-config-next; теперь плюс цепочка shadcn→ts-morph, уже отмеченная в review TASK-002); production audit не пересчитывался в этом TASK. `npm audit fix --force` не применялся по запрету.
2. npm 11.19 (allowScripts) блокирует postinstall `esbuild`/`fsevents`/`unrs-resolver`; проверено, что drizzle-kit/vitest/playwright работают (бинарники esbuild приходят через optionalDependencies).
3. Хук координаторской среды (Mimosa) при коммите снова сообщил о незавершённой полной security-процедуре; заявлений о безопасности проекта не делается.

## Git

- Ветка: `task/TASK-003` (назначенная); worktree `/Users/atlhnv/Codex/orbit-worktrees/TASK-003`.
- Стартовый SHA: `a140480cf5b1d6f3dd76bd07c9ec6f6476279ba0`.
- Коммиты TASK: `79ab1484121bf9b69e4be2afeafd6532cc5ba418` (реализация) + отчётный коммит (SHA возвращается в ответе пользователю; в файл отчёта вписать его невозможно).
- Рабочее дерево после коммитов: чистое; merge/push/amend/rebase/reset не выполнялись; main и другие ветки не изменялись; localhost:3000 и чужие сервисы не затрагивались; `docker compose down -v`/prune не выполнялись.

## Итог

Реализация передана на независимое review Codex. TASK приёмкой не считается; merge в main не выполнялся; TASK-004 не начинался.
