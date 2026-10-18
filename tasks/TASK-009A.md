# TASK-009A — чтение задач проекта

**PAUSED по решению пользователя**, 2026-10-12: приоритет перенесён на native/local-first. Не выполнять этот TASK, даже если старый prompt разрешает. Ветка/worktree и требования сохранены.

## Одна цель / старт

Добавить owner-scoped GET /api/v1/projects/[projectId]/tasks для будущего экрана проекта. Только read service + HTTP + tests, без UI и новых mutations. База review: 463c8f16f6317ae1a6257ff704c23c9f1716b2fa (принятый TASK-008). Стартовый SHA — coordinator assignment HEAD после базы, зафиксировать полный SHA до работы. Ветка task/TASK-009A, worktree /Users/atlhnv/Codex/orbit-worktrees/TASK-009A. Проверить Git root/branch/status; при чужих правках остановить затронутую работу.

## Разрешённый scope

src/server/tasks/service.ts — небольшая новая read function, без переработки существующих writes/views; новый src/app/api/v1/projects/[projectId]/tasks/route.ts; новый tests/auth/project-tasks.auth.test.ts; reports/TASK-009A-executor.md. Использовать существующие isValidProjectId, parseTaskListStatusQuery, getProject/toProjectDTO, toTaskDTO/getTasksReadContext и HTTP helpers. Новые deps/schema/migrations/DTO поля/публичные clock endpoints не нужны. Pure helpers менять только при доказанной необходимости, предварительно сообщить координатору; не расширять scope самостоятельно.

## Точный read контракт

- GET, projectId синтаксический UUID; query только status=open|completed|all, default open. Неизвестные/duplicate keys, owner/timezone/view/start overrides и неверный status/UUID →400 VALIDATION_ERROR (parsing до auth, как принятые routes).
- requireUser определяет actor. Анонимная/поддельная/отозванная session →401. Собственный проект читается; чужой и неизвестный корректный UUID → одинаковые404 NOT_FOUND без owner/name/task count утечки. Подсказки существования из query не принимать.
- Архив собственного проекта доступен для ЧТЕНИЯ, как требует PRODUCT.md; project.archivedAt даёт будущему UI readonly metadata. Это не добавляет write в архив и не возвращает архивные tasks в рабочие Inbox/Today/Upcoming. Archive сохраняет tasks, read endpoint не мутирует ни проект, ни task.
- Возвращаются собственные non-deleted root one-off tasks именно этого projectId, независимо от plannedDate/deadlineDate (без Inbox/Today фильтра). Child/recurrence не включать в этот первый root list; subtask/recurrence views — будущие задания. status по completedAt.
- Стабильный sort_order ASC, created_at ASC, id ASC. Проверка owner/project должна находиться в server query, не client filtering/read чужого project по одному id. Reuse read helpers допустим; не применять workingTaskFilters с archivedAt IS NULL к archive read.
- 200 envelope: {project: ProjectDTO, tasks: TaskDTO[], context: {timezone,today,asOf,view:"project",projectId}}. ProjectDTO/TaskDTO существующие, без owner. Context — существующий server getTasksReadContext actor, один reference instant. Empty own project →200 tasks:[], не404. Никаких client clock/zone overrides/cache.
- Все success/error responses private,no-store через существующие helpers. Ошибка env/DB →500 INTERNAL без raw details. Новый endpoint только GET, POST/PATCH/DELETE не реализовывать. Global tasks collection API не менять.

## Компактные integration проверки

Отдельные synthetic users U/V + own projects и fixture tasks в own per-run DB. Пока project assignment API нет, fixture вставить параметризованным SQL прямо в тестовую БД; это test setup, не новый продуктовый путь. Сессии через существующий signInLocalUser/provision helpers, без изменения auth-flow fixtures или ослабления sign-in limiter.

- U видит ровно свои roots нужного проекта: dated и undated; other project, V, deleted, child, recurrence исключены. Empty собственный project200.
- status open/completed/all и default; stable triple на контролируемых fixture sort_order/created_at/id, не порядок randomUUID/скорость часов.
- UUID/query invalid400; anonymous/revoked401; foreign/missing идентичные404. No-store success/error.
- Own archived project/tasks читаются; archived task не появляется в Inbox/Today/Upcoming. После restore рабочие views возвращают подходящие rows. Даты/state/revision не изменены чтением.
- Context timezone своего actor из settings, today по собственному asOf; без обязательного различия дат UTC/другой зоны.

Небольшие таблица-тесты допустимы; никаких E2E/UI frameworks в этой задаче. Не требуются десятки отдельных дублирующих тестов.

## Соразмерные gates / окружение

Node24 проверить до запуска: /private/tmp/orbit-r4-review-runtime/node-v24.21.0-darwin-arm64/bin если существует; иначе отдельный официальный runtime, не менять system Node. npm ci (при доступном cache --offline допустим), lint0 warnings/typecheck. Свежий production npm run test:auth -- tests/auth/project-tasks.auth.test.ts tests/auth/projects.auth.test.ts tests/auth/tasks-planning.auth.test.ts; записать фактические выбранные файлы/counts. Если существующий projects test называется иначе — проверить путь до команды. Полные unit/DB/auth/E2E/no-env/dev пока не нужны: UI и writes не меняются.

Не копировать пользовательские .env из других checkout и не подключаться к dev БД ради tests. TEST_DATABASE_URL явный, существующий guarded runner/own unique orbit_test namespace. PG17 если уже доступен; если закрыт, свой временный PG18 loopback с эфемерным паролем разрешён. Colima/CRM не запускать. Auth suites последовательно, проверить leftovers0DB/0connections; остановить/удалить только собственный временный кластер/пароль. Credentials/URI/storageState не печатать.

## Завершение / запреты

Обычный scoped commit, git diff --check и clean tree. Подробный отчёт только reports/TASK-009A-executor.md: start/latest SHA, files, commands/exits/counts/DB version, owner/archive/order evidence, cleanup, ограничения. В чат 4–5 коротких строк: READY_FOR_REVIEW/BLOCKED, full SHA, итог, checks, путь отчёта. Остановиться до независимого review Codex.

Не начинать TASK-009B и весь исходный пакет TASK-009; DONE/merge/push/amend/rebase/reset/stash/deploy не выполнять. Не менять main/другие worktree/localhost3000/CRM/VPN/hooks/coordination docs. Не коммитить secrets/.env/logs. Новые проблемы вне scope — точное evidence координатору, без самостоятельной переработки продукта.
