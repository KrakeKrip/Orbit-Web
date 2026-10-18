# Orbit

Персональный менеджер задач (в разработке). Сейчас реализованы каркас
веб-интерфейса с входом по email/password (регистрация на сервере отключена),
инфраструктура базы данных: локальный PostgreSQL 17, Drizzle схема с
ownership-связями и проверяемые миграции. Реальны one-off задачи: Inbox
(quick-add/rename/complete/reopen/удаление), планирование дата/время/дедлайн
с зоной аккаунта, экраны Today/Upcoming. Продуктовая функциональность
добавляется следующими задачами (см. `TASKS.md` в корне репозитория).

## Требования

- **Node.js 24 LTS** (целевая версия, фиксируется `.nvmrc`; проверено на v24.21.0).
  Удобно использовать [nvm](https://github.com/nvm-sh/nvm): `nvm install` / `nvm use`
  в корне проекта подберёт версию из `.nvmrc`.
- **npm 11** (входит в комплект Node 24; проверено на npm 11.19.0).
- Для unit-тестов нужен только Node; для E2E — браузер Chromium, который Playwright
  ставит локально в пользовательский кеш (см. ниже). Сборка и UI-тесты
  не требуют БД, Docker и env.
- Для входа в приложение, миграций и DB/auth-тестов: локальный PostgreSQL
  (Compose) и Docker-совместимый runtime (проверено с Colima).

## Быстрый старт

```sh
cp .env.example .env   # затем заполните пароли/секрет (см. комментарии внутри)
npm ci                 # воспроизводимая установка зависимостей по package-lock.json
docker compose up -d   # локальный PostgreSQL; дождитесь healthy
npm run db:migrate     # применить миграции к dev-базе
npm run auth:bootstrap # создать первый локальный аккаунт (интерактивно)
npm run dev            # http://localhost:3000 → редирект на /login
```

## Локальная база данных (PostgreSQL 17 + Drizzle)

1. Создайте локальный `.env` из шаблона и сгенерируйте свой пароль
   (`.env` игнорируется Git; реальные секреты в репозиторий не попадают):

   ```sh
   cp .env.example .env
   # замените change-me-local-only на свой пароль, например: openssl rand -hex 24
   ```

2. Поднимите локальный PostgreSQL (Compose, project name `orbit`; порт
   публикуется только на 127.0.0.1, по умолчанию 55432, настраивается
   `ORBIT_DB_PORT`; занятый порт освобождать за счёт чужих сервисов нельзя —
   поменяйте `ORBIT_DB_PORT` в `.env`):

   ```sh
   docker compose up -d   # запуск контейнера
   docker compose ps      # дождитесь статуса healthy
   ```

3. Примените миграции к dev-базе (`orbit_dev` из `DATABASE_URL`):

   ```sh
   npm run db:migrate     # checked-in SQL из drizzle/; повторный запуск безопасен
   ```

4. Изменение схемы: правьте `src/server/db/schema.ts` (auth-таблицы в
   `schema.auth.ts` генерируются Better Auth CLI, см. ниже) и зафиксируйте
   историю миграций:

   ```sh
   npm run db:generate    # создаст SQL-миграцию в drizzle/; schema push запрещён
   npm run db:migrate
   ```

Безопасная остановка без удаления данных:

```sh
docker compose stop     # либо docker compose down — БЕЗ флага -v (volume сохраняется)
```

`docker compose down -v` удаляет данные базы — в обычном workflow не используется.

### Схема и auth-таблицы

- `src/server/db/schema.auth.ts` — core auth-таблицы `user`, `session`,
  `account`, `verification`, сгенерированные официальным CLI закреплённой
  версии Better Auth (`@better-auth/cli` 1.4.x / `better-auth` 1.7.x,
  email/password без plugins). Файл не редактируется вручную; воспроизведение:
  `npx @better-auth/cli generate --config scripts/auth-generator.config.ts --output src/server/db/schema.auth.ts -y`
  (подключения к БД генерация не выполняет).
- `src/server/db/schema.ts` — доменные таблицы `user_settings`, `projects`,
  `tasks`, `task_completions`: UUID PK, owner/user `text` (Better Auth id),
  composite FK (id, owner_id) для task→project, task→parent и completion→task,
  SQL checks (priority 1–4, длины, planned_time⇒planned_date, recurrence⇒planned_date
  без deadline и без постоянного completed_at, parent_id ≠ id, revision ≥ 0),
  партиальные индексы по owner+датам для активных задач. Событийные timestamp —
  timestamptz; календарные planned_date/planned_time — DATE/TIME.
- `src/server/db/client.ts` — ленивый пул: на import подключений нет,
  `DATABASE_URL` нужен только при явной DB-операции.
- `updated_at` заполняется при insert (default); обновление timestamp при
  UPDATE — обязанность будущего сервисного слоя (триггеров нет).

### Тесты базы данных

`npm run test:db` — интеграционный suite на реальном PostgreSQL (28 проверок
схемы + guard- и sentinel-тесты раннера): defaults и nullable-поля, ownership
composite FK (в том числе на UPDATE), SQL checks, round trip DATE/TIME и
физических типов, дубликаты idempotency/revision — с двумя синтетическими
пользователями. Раннер требует явный `TEST_DATABASE_URL` (fallback на
`DATABASE_URL` отсутствует; query-параметры и нелокальные хосты отвергаются
до подключения), создаёт для каждого запуска **новую уникальную** базу
`orbit_test_<запуск>` (без `IF NOT EXISTS` — ничего предварительно не
удаляется) и применяет миграции перед тестами. После прогона удаляется
только база, созданная этим запуском: ранее существовавшие базы (включая
`orbit_test`) не затрагиваются. Без настроенного доступа команда падает
с ошибкой, а не пропускает тесты.

## Маршруты

| Путь          | Доступ      | Экран                      |
| ------------- | ----------- | -------------------------- |
| `/`           | —           | перенаправление на `/today` |
| `/login`      | анонимно    | Вход (email/password)      |
| `/today`      | сессия      | Сегодня (планы и дедлайны) |
| `/inbox`      | сессия      | Входящие (quick-add задач) |
| `/upcoming`   | сессия      | Предстоящее (7 дней по датам) |
| `/projects`   | сессия      | Проекты (создание/архив)   |
| `/settings`   | сессия      | Настройки (timezone, тема, выход) |
| `/api/v1/me`  | сессия      | GET identity endpoint      |
| `/api/v1/settings` | сессия | GET/PATCH timezone/theme аккаунта |
| `/api/v1/projects` | сессия | GET list (status=active/archived/all), POST create |
| `/api/v1/projects/[projectId]` | сессия | GET item, PATCH rename/archive (DELETE нет) |
| `/api/v1/tasks` | сессия | GET views inbox/today/upcoming + status + start, POST create |
| `/api/v1/tasks/[taskId]` | сессия | GET item, PATCH title/complete/planning, DELETE soft delete |

Все workspace-маршруты защищены на сервере: анонимный браузер перенаправляется
на `/login`, API отвечает `401 {"error":{"code":"UNAUTHENTICATED"}}`.

Оболочка: sidebar (~240 px) при ширине **от 960 px**, компактный header + bottom
nav — ниже. Активный раздел помечен `aria-current="page"`; есть skip link
«К содержимому».

## Аутентификация

- [Better Auth](https://better-auth.com) 1.7.7 (email/password, Drizzle adapter)
  поверх таблиц `user/session/account/verification`. **Публичная регистрация
  отключена на сервере** (`disableSignUp=true`, без env-переключателя): прямой
  POST на sign-up отвергается и не создаёт записей.
- Сессии: HttpOnly cookie, SameSite=Lax, cookie cache отключён (отзыв/истечение
  проверяются на каждом запросе). Sign-in rate limit: 10 попыток/60s на IP
  (однопроцессное memory-хранилище; перед deployment требуется пересмотр).
- Runtime-конфигурация (только в `.env`): `DATABASE_URL`, `BETTER_AUTH_SECRET`
  (минимум 32 символа случайности: `openssl rand -hex 32`), `BETTER_AUTH_URL`.
  Без них auth-запросы fail-closed; сборка и UI-тесты работают без env.
- **Первый аккаунт** — локальная одноразовая процедура (не публичный endpoint):

  ```sh
  npm run auth:bootstrap   # интерактивно спросит email и пароль (скрытый ввод)
  ```

  Повторный запуск с тем же email отказывает, не меняя пароль. Восстановление
  пароля — отдельная будущая задача.
- Выход: кнопка «Выйти» в `/settings` (отзывает сессию на сервере).

### Тесты аутентификации

`npm run test:auth` — интеграционный suite на реальном PostgreSQL и production
Next-сервере: изолированная per-run база (тот же проверенный target, что и в
`test:db`), синтетические пользователи с одноразовыми паролями, закрытые
подключения и cleanup только своих ресурсов. Покрывает: запрет signup прямым
запросом, generic ошибки входа без user enumeration, HttpOnly/SameSite cookie,
поддельный/истёкший/отозванный session cookie, actor isolation, hostile Origin,
rate limit 429, повторный bootstrap.

## Настройки аккаунта (timezone и тема)

`/settings` сохраняет в PostgreSQL два параметра аккаунта через защищённый
`GET/PATCH /api/v1/settings` (actor только из сессии; query/header identity
игнорируются):

- **Часовой пояс** — именованная зона IANA (например `Europe/Moscow`) или
  `UTC`. Значение канонизируется через Intl (алиасы поддерживаются);
  numeric-offset формы (`+03:00`, `UTC+3`, `GMT+3`) и неизвестные имена
  отвергаются. Default нового аккаунта — `UTC`; timezone не угадывается по
  browser/locale/IP и пока ни на что не влияет: применение к Сегодня /
  Предстоящему / повторениям — следующие этапы.
- **Тема** — `light` / `dark` / `system`; default нового аккаунта —
  `system`. Выбор применяется сразу (preview) и сохраняется PATCH'ем;
  подтверждённым считается только ответ сервера, при ошибке выбор
  возвращается к сохранённому значению, а «сохранено» не показывается.

Правила хранения: PATCH принимает непустое подмножество полей и меняет
только их атомарным upsert'ом по PK `user_id` (конкурентные обновления
разных полей не перетирают друг друга); GET отсутствующей строки возвращает
defaults без INSERT; `updated_at` — явный server write. Все ответы, включая
ошибки — `Cache-Control: private, no-store`; ошибки типизированы:
`401 UNAUTHENTICATED`, `400 VALIDATION_ERROR`, `403 FORBIDDEN_ORIGIN`,
`413 PAYLOAD_TOO_LARGE`, `415 UNSUPPORTED_MEDIA_TYPE`, `500 INTERNAL`.
PATCH дополнительно защищён точной server-side проверкой Origin против
configured `BETTER_AUTH_URL` (это собственный cookie mutation endpoint,
Better Auth routes его не защищают); body ограничен 2 KiB; query параметры
не поддерживаются.

Тема аккаунта применяется на всех workspace-маршрутах после входа, refresh
и смены аккаунта: настройки в БД — источник истины, локальный `orbit-theme`
(next-themes) — только визуальный cache и не источник автоматического
сохранения. Настройки другого аккаунта из локального cache не подхватываются.
Login и /login не читают настройки аккаунта.

## Тема оформления (локальная презентация)

До входа (например, на `/login`) действует локальная тема next-themes
(«Системная / Светлая / Тёмная», `localStorage` ключ `orbit-theme`). После
входа приоритет имеет тема аккаунта (см. раздел выше).

## Проекты

`/projects` — первый реальный CRUD-раздел: создание, переименование,
архивирование и восстановление собственных проектов. Активные и архивные
проекты показываются отдельными списками (по умолчанию — активные); архив
**не удаляет** проект и не трогает связанные задачи. Повторяющиеся имена
разрешены; имя — 1–120 Unicode code points с trim; rename доступен и в
архиве. Имя проекта — текст, перехода на task view пока нет (список задач
внутри проекта — будущий этап).

API (cookie-auth, owner-scoped service, actor только из сессии):
`GET /api/v1/projects?status=active|archived|all`, `POST` `{name}` → 201,
`GET/PATCH /api/v1/projects/[projectId]` (PATCH — непустой subset
`{name?, archived?}`). Сортировка стабильная (sort_order, created_at, id);
DELETE и ручная сортировка отсутствуют. Ошибки — envelope
`{error:{code,field?}}`: 400 (validation/UUID/лишний query), 401, 403
(точная Origin-защита mutations), 404 (чужой и неизвестный id
неразличимы), 413/415, 500; все ответы `private, no-store`; mutations
ограничены 2 KiB JSON. Значения `id/owner_id/sort_order` из payload
отвергаются.

## Входящие: базовые one-off задачи

`/inbox` — первая реальная работа с задачами: quick-add (label «Название
задачи», Enter), переименование, завершение/повторное открытие и soft
delete с подтверждением («Удалить задачу?» + Подтвердить/Отмена). Открытые
и завершённые показываются отдельными списками; задача без даты в активном
проекте тоже попадает во Входящие; задачи архивных проектов и с датами на
экране не показываются (server-side фильтр). Заголовок — 1–500 Unicode
code points, дубликаты разрешены, NUL/unpaired surrogates отвергаются.

API (cookie-auth, owner-scoped, actor только из сессии):
`GET /api/v1/tasks?status=open|completed|all`, `POST` `{title}` → 201,
`GET/PATCH/DELETE /api/v1/tasks/[taskId]`; PATCH — непустой subset
`{title?, completed?}`. Мутации транзакционны с row lock задачи; archive
проекта сериализуется row lock'ом проекта (409 `PROJECT_ARCHIVED` при
конфликте), child/recurrence задачи → 409 `UNSUPPORTED_TASK`. Завершение
пишет journal `task_completions` тем же server timestamp в той же
транзакции; повторные завершения — no-op без новых записей. Удаление —
soft delete (deleted_at, revision+1) с каскадным скрытием собственных
активных прямых подзадач тем же timestamp; физического DELETE нет, undo
пока не реализован. Ошибки: 400/401/403/404/409/413/415/500, все ответы
`private, no-store`.

## Планирование: даты, Сегодня и Предстоящее

Задачи получают плановую дату (`ГГГГ-ММ-ДД`, Gregorian 1900–2199),
опциональное время (`ЧЧ:мм`, только вместе с датой; очистка даты очищает
время) и независимый дедлайн (раньше плана — разрешено, не сдвигается
автоматически). Дата «сегодня» вычисляется сервером из одного снимка
`current_timestamp` PostgreSQL в часовом поясе аккаунта (по умолчанию UTC;
смена пояса не переписывает сохранённые даты — меняется только
классификация при следующем чтении). Время — настенное label в поясе
аккаунта, без будильников/DST-резолюции; просрочка определяется датой.

Экраны: **Сегодня** — четыре взаимоисключающие секции (просрочен план /
на сегодня / дедлайн просрочен / дедлайн сегодня), каждая задача один раз;
quick-add планирует на серверное «сегодня». **Предстоящее** — группы по
плановой дате за 7 дней включительно, навигация вперёд/назад/текущая,
диапазон в URL (`/upcoming?start=…`, сохраняется при reload; невалидный
start — явная ошибка). **Входящие** — задачи без плановой даты; дедлайн сам
по себе не убирает задачу из Входящих. Кнопка «Планирование» открывает
редактор: сохраняются только изменённые поля, при ошибке черновик
сохраняется для повторной попытки.

API (cookie-auth, owner-scoped): `GET /api/v1/tasks?view=inbox|today|upcoming&status=open|completed|all&start=YYYY-MM-DD`
(ответ `{tasks, context:{timezone, today, asOf, view, startDate?, endDate?}}`;
client timezone/today не принимаются), `POST {title, plannedDate?, plannedTime?, deadlineDate?}`,
`PATCH` непустой subset `{title?, completed?, plannedDate?, plannedTime?, deadlineDate?}`
(null — только schedule-поля; валидация merge: время без даты → 400, очистка
плана без явного времени очищает время, явное время при очистке плана → 400).
Лимит тела задач — 4 KiB (эмодзи-заголовок 500 code points + расписание);
Settings/Projects/DELETE остаются 2 KiB. Ошибки и no-store — как раньше.

## Production-сборка и запуск

```sh
npm run build # production-сборка Next.js
npm start     # запуск собранного приложения на http://localhost:3000
```

`npm start` обслуживает результат `npm run build`; порт по умолчанию — 3000,
можно переопределить: `npm start -- --hostname 127.0.0.1 --port 3101`.

## Скрипты

| Команда             | Назначение                                                  |
| ------------------- | ----------------------------------------------------------- |
| `npm run dev`       | сервер разработки Next.js (localhost:3000)                  |
| `npm run build`     | production-сборка                                           |
| `npm start`         | запуск production-сборки (localhost:3000)                   |
| `npm run lint`      | ESLint (flat config, `eslint.config.mjs`)                   |
| `npm run typecheck` | TypeScript, `tsc --noEmit` (strict включён)                 |
| `npm test`          | Vitest: быстрые UI smoke-тесты (`tests/*.test.tsx`), без БД  |
| `npm run test:db`   | Vitest: интеграционные тесты схемы на изолированном локальном PostgreSQL (нужен `TEST_DATABASE_URL`, см. раздел БД) |
| `npm run test:auth` | Vitest: интеграционные тесты аутентификации на реальном PostgreSQL и production-сервере (нужны `TEST_DATABASE_URL`; build входит) |
| `npm run test:e2e`  | Playwright: пересобирает production build и гоняет браузерные тесты `tests/e2e/` на свободном loopback-порту (по умолчанию 3123, переопределяется `E2E_PORT`) |
| `npm run auth:bootstrap` | интерактивное создание первого локального аккаунта (только local DB) |
| `npm run db:generate` | генерация SQL-миграции из `src/server/db/schema*.ts` в `drizzle/` |
| `npm run db:migrate`  | применение checked-in миграций к dev-базе из `DATABASE_URL` |

E2E-тесты требуют однократной установки Chromium (в пользовательский кеш,
без изменения системы):

```sh
npx playwright install chromium
```

E2E-покрытие: redirect `/`, прямой вход и навигация по всем разделам, активная
ссылка (`aria-current`), отсутствие горизонтального overflow на 360/390/768/1280 px,
выбор темы light/dark (мышью и клавиатурой) с сохранением в аккаунте после
refresh и в новом контексте, реакция системной темы на `prefers-color-scheme`,
сохранение timezone с явным сохранением и retry при ошибке сервера, отсутствие
наследования локальной темы при смене аккаунта, skip link, touch targets ≥44 px,
отсутствие ошибок в консоли браузера.

## Стек

- [Next.js 16](https://nextjs.org/docs/app) (App Router, `src/`, Turbopack) + React 19
- TypeScript (strict, alias `@/*` → `src/*`)
- Tailwind CSS 4 + [shadcn/ui](https://ui.shadcn.com) (Radix-база: Button, Select)
- next-themes (light/dark/system, ключ `orbit-theme`)
- PostgreSQL 17 + [Drizzle ORM](https://orm.drizzle.team) 0.45 / drizzle-kit 0.31,
  драйвер pg 8.23; аутентификация — [Better Auth](https://better-auth.com) 1.7.7
  (email/password, Drizzle adapter, signup отключён на сервере)
- ESLint 9 (flat config) + `eslint-config-next`
- Vitest 5, Playwright 1.64 (Chromium)

UI-строки интерфейса централизованы в `src/lib/i18n/ru.ts`.

## Что ещё НЕ реализовано

Серверная бизнес-логика one-off задач и планирование реализованы. Пока
отсутствуют и не притворяются работающими:

- Задачи: notes/priority editing, project assignment/move, subtask UI, recurrence, completion history UI, search; project deletion/reordering/colors/sharing; API besides identity/settings/projects/tasks endpoints;
- смена email/пароля, восстановление пароля, сессии «на других устройствах»;
- применение timezone к расписанию: Сегодня/Предстоящее/повторения пока не
  используют настройки (см. раздел «Настройки аккаунта»);
- алгоритм completion повторений (в схеме только журнал task_completions);
- межстрочные правила (глубина/циклы подзадач, перенос архивации) — будущие
  service invariants, БД их не обеспечивает;
- PWA-манифест и установка на домашний экран;
- деплой, CI/CD, резервное копирование.

Ссылки на планирование: `PRODUCT.md`, `ARCHITECTURE.md`, `DESIGN.md`, `TASKS.md`.
