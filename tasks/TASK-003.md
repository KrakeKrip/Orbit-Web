# TASK-003 — PostgreSQL, Drizzle и проверяемые миграции

## Статус и цель
DONE — принят Codex 2026-10-08 после исправления R1/R2/R1b и локально интегрирован. Итог: reports/TASK-003.md. Ниже сохранено исходное задание; повторно не выполнять. Создать локальную инфраструктуру БД и физическую схему для последующих auth/CRUD TASK. Никаких пользовательских операций или изменений экранов.

## Перед началом
Прочитать AGENTS.md, PRODUCT.md, ARCHITECTURE.md, DECISIONS.md, этот TASK и reports/TASK-002.md. TASK-001/002 приняты. Node 24 LTS, npm/единственный package-lock.json; Next/React/UI версии не менять.
- База независимого review: `af5d1f82dcd828272eadb4baa8ab19a79744e27d`.
- Ветка: `task/TASK-003`.
- Worktree: `/Users/atlhnv/Codex/orbit-worktrees/TASK-003`.
- Основной checkout координатора: `/Users/atlhnv/Orbit`, main. Не работать там.
- Между базой и стартовым SHA — assignment commit только с tasks/TASK-003.md, AGENTS.md, TASKS.md, ARCHITECTURE.md, DECISIONS.md. Точный стартовый SHA — в передаче пользователя. Самостоятельно записать полный HEAD до правок.
- Проверить pwd, git rev-parse --show-toplevel, git branch --show-current, git status --short, git rev-parse HEAD, git log --oneline от базы, node --version, npm --version. При чужих изменениях остановить затронутую работу.

## Scope
Разрешены: compose.yaml; .env.example; .gitignore; drizzle.config.ts; drizzle/ с SQL и metadata; src/server/db/ (schema, lazy client, lifecycle); scripts/ для генерации/миграций/DB test runner и минимальной schema-generation конфигурации; отдельный DB test config и tests/db/; package.json/package-lock.json; README.md; reports/TASK-003-executor.md.
Изменение vitest.config.ts допустимо только для отделения DB suite от существующего npm test. Дополнительные server-only helpers и tsconfig допускаются лишь при обоснованной необходимости. Не менять UI, маршруты, E2E или существующие UI assertions.
Не менять корневые координационные документы, docs/source, прежние задания/отчёты. Архитектурные предложения записать в отчёт; существенный конфликт — BLOCKED, не молчаливое расширение scope.

## 1. Локальный PostgreSQL
- Compose только для PostgreSQL, отдельный project name Orbit, именованный volume, healthcheck, стабильный PostgreSQL 17 (выбрать поддерживаемый patch tag, не latest), публикация порта только на 127.0.0.1. Порт конфигурируемый, например 55432; занятый порт не освобождать за счёт чужого сервиса.
- .env.example содержит имена переменных, безопасные пояснения/локальные placeholders; реальные секреты только в ignored .env. Пароль не hardcode в Compose/SQL и не показывать в отчётах, командах с выводом или credential-bearing URL.
- README: настройка env, up/healthcheck, миграция, безопасная остановка без удаления volume, подключение и отдельная test DB. Не выполнять down -v, prune, drop пользовательской DB или глобальные изменения Docker.
- Docker CLI и Colima установлены, но при назначении default daemon недоступен (socket отсутствует). Проверить актуальное состояние. Допустимо запустить существующий локальный Colima обычным colima start без sudo/установки/смены глобального context, если он остановлен; не останавливать/перенастраивать чужие контейнеры. Если runtime требует системный пароль или недоступен — выполнить независимую работу и вернуть BLOCKED с невыполненными DB gates. SQLite/mock не заменяет PostgreSQL.

## 2. Drizzle и будущий Better Auth
- Использовать стабильные совместимые drizzle-orm/drizzle-kit и pg с typings либо postgres driver; закрепить реальные версии в lockfile и отчёте. Не выполнять npm audit fix --force и общий cleanup tooling.
- Auth user ID — text, совместимый с выбранной версией Better Auth; продуктовые IDs — UUID. Все owner/user FK ссылаются на настоящий Better Auth user, не на временную users-заглушку.
- Сейчас подготовить только core auth schema user/session/account/verification: получить её из официального генератора для закреплённой стабильной Better Auth версии и минимального email/password Drizzle config без plugins. Записать версии, команду и настройки генерации, чтобы TASK-004 мог воспроизвести схему. Генерация не должна требовать действующего production URL/секрета или подключения к реальной БД.
- Разрешены Better Auth и нужный CLI/adapter только для этой совместимости. Использовать API именно выбранной версии; текущие docs могут отличаться. Минимальный generator config держать вне src/app; никакого публичного handler, session middleware, login/signup, bootstrap аккаунта или auth client. TASK-004 подключит реальные auth flows с server signup OFF.
- Lazy DB client только для server кода: не подключаться на import, не требовать DATABASE_URL для npm test/build существующих страниц. При явной DB операции без URL — понятная ошибка без утечки секрета. CLI/test runner закрывают pool/connection, не оставляют hanging process.

## 3. Физическая схема
Имена экспортов/таблиц должны быть однозначны и отражены в README/отчёте. Минимальные поля:
- user_settings: user_id PK/FK, timezone (IANA строка, default UTC), theme light/dark/system (default system), created_at/updated_at.
- projects: UUID id, owner_id, name (не пустое после trim, max 120), sort_order integer default 0, archived_at nullable, created_at/updated_at.
- tasks: UUID id, owner_id, nullable project_id/parent_id, title (не пустое после trim, max 500), notes (nullable, max 10000), priority integer 1..4 default 4, planned_date DATE, planned_time TIME WITHOUT TIME ZONE, deadline_date DATE, recurrence_rule nullable enum DAILY/WEEKDAYS/WEEKLY, sort_order integer default 0, revision integer default 0 и >=0, nullable completed_at/deleted_at, created_at/updated_at.
- task_completions: UUID id, owner_id, task_id, occurrence_date nullable DATE, completed_at, completed_revision integer >=0, idempotency_key непустая ограниченная строка (max 128). Уникальные (owner_id, idempotency_key) и (task_id, completed_revision). completed_revision обозначает revision ДО завершения; изменение revision/повторный запрос реализуется позже в TASK-007/011. Это структура журнала, не реализация completion алгоритма.
- Event timestamps — timestamptz; календарные DATE/TIME не переводить в UTC timestamps. Физический SQL должен сохранять эту семантику.
- DB checks: planned_time требует planned_date; recurrence требует planned_date и отсутствие deadline_date; recurring task не хранит постоянный completed_at; parent_id != id. Length/theme/priority/revision checks и NOT NULL обязательных полей реально действуют.
- Composite unique/FK обеспечивают совпадение owner у task→project, task→parent и completion→task, включая UPDATE; обычного FK по id недостаточно. Nullable project_id сохраняет Inbox. Не вводить cascade, превращающий удаление проекта в удаление задач: сейчас restrictive/no-action links, будущий delete — soft delete.
- Один уровень вложенности, отсутствие циклов, одинаковый project родителя/ребёнка (включая NULL), archive/soft delete и IANA timezone validation — будущие service boundaries. Не выдавать обычные FK/CHECK за обеспечение этих межстрочных правил. Не добавлять сложные triggers в этом TASK; явно перечислить оставшиеся service invariants в отчёте.
- Нужны разумные индексы owner/project/parent, owner+planned_date/deadline_date для активных задач и completion history; объяснить назначения и не плодить дубли уникальных индексов. FK не заменяют owner filtering/авторизацию: IDOR проверяется в последующих TASK.
- updated_at policy документировать: default задаёт insert, дальнейшие updates обязаны обновлять timestamp через сервис/ORM; не обещать automatic SQL update без механизма.

## 4. Миграции и тесты
- Checked-in Drizzle SQL migrations + journal/snapshots. db:generate и db:migrate воспроизводимы; schema push запрещён как замена истории миграций.
- В тестах использовать отдельную пустую Orbit test DB на локальном PostgreSQL, явно отличную от dev. Runner проверяет host, имя DB и явное test разрешение ДО любого DDL; неизвестные/remote/production targets отвергает. Не очищать произвольную DB из DATABASE_URL. Отдельный TEST_DATABASE_URL не должен автоматически fallback на DATABASE_URL.
- db:migrate применяется к явно выбранной локальной dev DB; DB test runner создаёт/использует только свой изолированный test namespace/database. Для повторных прогонов допустимо создание новой test DB; cleanup лишь созданных этим runner ресурсов. Не удалять чужие/существующие volume/DB.
- Применить миграции к пустой DB, применить повторно без изменения данных/ошибок; генерация по неизменной схеме не даёт нового SQL. Проверить реальные PostgreSQL constraints через успешные и отвергнутые INSERT/UPDATE, с двумя синтетическими пользователями.
- Проверить: обязательные defaults/NULL поля; существующий owner/FK; чужой project/parent/task в completion отвергается, включая смену owner/project/parent; priority/length/theme/revision; time без date; invalid recurrence/deadline; self-parent; duplicate idempotency/revision. Проверить допустимые Inbox, one-off и recurrence записи, даты и timestamps через round trip. Тесты не должны сводиться к text matching SQL или мокам драйвера.
- npm test остаётся быстрой UI suite без БД. Отдельный npm run test:db запускает DB suite и ошибается при отсутствующем доступе (не silent skip/PASS). Существующая UI suite/production build/E2E работают без DB/env.

## Acceptance / обязательные gates
1. Compose валиден, isolated PostgreSQL healthy; секреты не в Git, порт loopback.
2. Реальная совместимая auth schema + доменные таблицы, ownership FK и checks подтверждены PostgreSQL integration tests.
3. Миграция на пустую DB, повторное применение и no-change generation подтверждены; SQL/metadata актуальны.
4. Node 24: npm ci, npm run lint, npm run typecheck, npm test, npm run test:db, npm run build проходят. Также CI=1 E2E_PORT=<свободный порт> npm run test:e2e (текущая регрессия 47 browser tests). Не занимать localhost:3000, где пользователь смотрит текущую main.
5. README позволяет повторить настройку, генерацию, миграцию и DB tests; команды/scripts существуют. git diff --check от review базы чист, рабочее дерево после обычных коммитов чистое.
Если обязательный gate невозможно выполнить, вернуть BLOCKED и точную причину, не READY_FOR_REVIEW по одним статическим проверкам.

## Не делать
CRUD/services/API, UI/auth flows/реальные аккаунты, recurrence алгоритм, native/Telegram/MCP/PWA, deployment/push/merge. Не запускать другие TASK. Не менять main/другие ветки, не делать amend/rebase/reset/stash, не удалять пользовательские данные.

## Передача результата
Обычные новые commits в назначенной ветке. reports/TASK-003-executor.md: READY_FOR_REVIEW либо BLOCKED, полный starting SHA, implementation SHA, список файлов/версий/источников, схема и ограничения, фактические команды/exit codes/test counts, DB runtime/migration evidence, непроверенное и вопросы review. Не публиковать env/секреты/connection URL. SHA будущего report commit нельзя вписать в него самого: вернуть latest full SHA в сообщении после коммита. После отчёта остановиться до независимого review Codex.

## Официальные источники
Координатор проверил 2026-10-08, исполнитель сверяет API с закреплёнными версиями:
- https://better-auth.com/docs/adapters/drizzle
- https://better-auth.com/docs/concepts/database
- https://orm.drizzle.team/docs/migrations
