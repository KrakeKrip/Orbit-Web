# TASK-003 — независимое review Codex

2026-10-08. **DONE — принято и локально интегрировано; gates main PASS.** R1/R2/R1b закрыты; TASK-004 не выдан, push/deployment не выполнялись.

## Локальная интеграция и итог
Merge --no-ff `c536b49ad979504e12a1595cb320334bbfac9592`; ветка task на review commit `1306624`, исходный executor HEAD `c10f34c9c62c93c7c38583726dc9d393dec2fc4c`. Main сохраняет историю и все координационные статусы.
Main gates: npm ci --offline, lint/typecheck, 4 UI tests PASS; полный test:db 47 PASS. Для DB suite проверенный ignored env из worktree загружен только в память child process, секреты не копировались в main/отчёт. Main .env отсутствует: production build и 47 browser tests прошли без env/DB через CI=1 E2E_PORT=3191. Source/config/schema/tests/lockfile main идентичны проверенной task ветке; после DB teardown orbit_test_* отсутствуют. Push/deploy/TASK-004 не выполнялись. Ранее выявленные tooling audit и неблокирующие cleanup ограничения сохранены ниже; build не доказывает auth или production security.

## Финальное review R1b
Проверен `c10f34c9c62c93c7c38583726dc9d393dec2fc4c`: изменены только sentinel fixture и executor report. Нет предварительного DROP фиксированной orbit_test; fixture создаётся под уникальным именем, cleanup ограничен своим успешно созданным ресурсом. История сохранена, дерево и diff --check от audit-базы чистые.
Независимо на Node 24.21.0/npm 11.19.0: npm ci --offline, lint/typecheck, 4 UI tests PASS; полный npm run test:db два последовательных раза — 47 PASS каждый (28 schema + 15 guard + 4 runner). После teardown pg_database не содержит orbit_test_* временных БД. Production build и 47 browser tests PASS на CI=1 E2E_PORT=3181. Ранее в этом review уже подтверждены миграции на пустую DB, повторное применение и no-change generation; SQL/schema с тех пор не менялись.
Первый технический запуск test:db во время npm ci не нашёл vitest (exit 127); после окончания установки оба штатных запуска успешны. Это ошибка порядка проверок координатора, не дефект реализации.
Оставшееся неблокирующее ограничение cleanup: createSentinelFixture записывает внешний ownership handle после создания таблицы, поэтому сбой fixture initialization может оставить свою новую DB; аналогично сбой второго prepare в тесте двух запусков может оставить первую свою DB. Удаления существующих ресурсов больше нет. Рекомендация на будущий test tooling cleanup — регистрировать handles сразу после CREATE и оборачивать каждый setup в finally; критерию защиты пользовательских данных это не препятствует.
Ниже история замечаний; NEEDS_FIXES в исторических разделах больше не является текущим статусом.

## Повторное review коррекции R1/R2 — текущий результат
Проверен HEAD `d200fa60342fc7fccea57dccea0809c03f2ca874`, fix commit `3b2240fdbce150ae9d21f9b7975dc1e251815fd8`, старт коррекции `736d460bbf4c42813f62db5e81b275c25ef83a42`. Коррекция ограничена девятью файлами test runner/guard/docs, dependencies/schema/migrations/UI не менялись. Рабочее дерево и diff --check чистые.

**R2 закрыто:** query параметры запрещены, разрешены только PostgreSQL protocols и явные local host/port/user/password; pg подключения собраны из проверенных компонентов, IPv6 нормализован. Независимые guard assertions прошли.

**R1 в prepareTestDatabase исправлено, но в полной test команде остаётся открытым.** Новый runner создаёт уникальную DB без предварительного DROP и удаляет свой ресурс. Однако новый regression test выполняет то же запрещённое удаление фиксированной существующей БД:

### R1b [P1] Sentinel-тест удаляет существующую orbit_test
`tests/db/runner.db.test.ts:44,64–66`: `sentinelDb = "orbit_test"`, затем `DROP DATABASE IF EXISTS "orbit_test" WITH (FORCE)` перед CREATE. Этот файл включён в обычный `npm run test:db`. На машине с существующей orbit_test suite уничтожит данные и отключит клиентов ещё до «доказательства», что runner сохраняет sentinel. Флаг sentinelCreated ставится ПОСЛЕ удаления чужого ресурса и проблему не решает. Не считать тестовое окружение основанием для удаления ранее существующих данных.

Исправить только sentinel fixture и связанные cleanup/assertions/отчёт: новое уникальное имя sentinel DB, CREATE без предварительного DROP/IF NOT EXISTS, флаг ownership только после успешного CREATE; cleanup лишь успешно созданного fixture. Проверить, что prepareTestDatabase и teardown сохраняют этот заранее созданный fixture и его строку. Если нужна проверка строго фиксированного orbit_test, она допустима только в отдельном полностью изолированном кластере, созданном самим тестом; на текущем local cluster нельзя удалять/пересоздавать фиксированную DB. Исправление namespace generator для этого не требуется. Все cleanup пути должны соблюдать ownership, включая сбои setup/assertions.

**Независимые gates после коррекции:** Node 24.21.0/npm 11.19.0; npm ci --offline по cache, lint, typecheck, 4 UI tests — PASS. Через временный reviewer config выполнены реальные обновлённые globalSetup/teardown и два безопасных файла (schema.db.test.ts + db-target.test.ts): **43 PASS = 28 schema + 15 guard**. После teardown запрос pg_database не обнаружил оставшихся orbit_test_* временных баз. Полный npm run test:db и runner.db.test.ts намеренно не запускались из-за R1b. `CI=1 E2E_PORT=3171 npm run test:e2e` — production build и 47 browser tests PASS. main не изменён.

Executor report указывает разбиение «28 schema + 12 guard + 7 runner», фактически текущие исходники содержат 15 guard + 4 runner = те же 47 total; исправить counts. Исторический раздел исходного отчёта допустим с обозначением, что он описывает состояние ДО коррекции.

**Передача GLM:** исправить R1b в той же ветке, обычными новыми коммитами. R2 повторно не переделывать; scope не расширять. Самостоятельно выполнить безопасный полный DB suite дважды, остальные обязательные gates, обновить executor report, вернуть latest full SHA. Без merge/push/amend/rebase/reset; TASK-004 не начинать.

---
Ниже сохранено первоначальное review для истории; его R2 закрыто и заменено текущим результатом выше.

## Проверенная история и scope
- База audit: `af5d1f82dcd828272eadb4baa8ab19a79744e27d`.
- Assignment/start: `a140480cf5b1d6f3dd76bd07c9ec6f6476279ba0`.
- Implementation: `79ab1484121bf9b69e4be2afeafd6532cc5ba418`.
- Executor report/проверенный HEAD: `3706dd26ae802a18d94f5ebe5134a2619e7cb03f`.
- Ветка `task/TASK-003`, worktree `/Users/atlhnv/Codex/orbit-worktrees/TASK-003`. База — предок HEAD, до review дерево чистое, diff --check чистый. Diff от базы 25 файлов, включая пять assignment docs. UI/auth flows не добавлялись.

## Обязательные исправления

### R1 [P1] Test runner уничтожает ранее существовавшую базу
`tests/db/global-setup.ts:60–61`: после проверки лишь loopback и суффикса `_test` выполняется `DROP DATABASE IF EXISTS ... WITH (FORCE)`. Любая существующая локальная БД, например `crm_test` или `orbit_test` с сохранёнными данными, будет удалена; подключённые клиенты принудительно отключатся. TEST_DATABASE_URL и суффикс не доказывают, что ресурс создан этим runner. Это прямо нарушает TASK: cleanup только ресурсов, созданных данным runner; не удалять чужую/существующую DB. Комментарий «чужие данные не затрагиваются» неверен.

Исправить setup без предварительного DROP существующей БД. Предпочтительно: проверенный локальный maintenance target, новое уникальное имя Orbit test DB для каждого запуска, CREATE без IF NOT EXISTS, передача URL фактически созданной DB всем workers/helpers, teardown лишь своей DB после закрытия connections. Альтернатива — отказ до DDL, если фиксированная test DB уже существует. Cleanup не должен удалять ресурс, если CREATE данного запуска не был успешен. Явное разрешение test режима требуется до DDL; не принимать обычный DATABASE_URL как fallback. Обновить README/.env.example/отчёт в соответствии с фактическим поведением.

Acceptance: два последовательных запуска проходят; sentinel в заранее существующей test DB остаётся неизменным; случайное имя существующей DB не приводит к DROP/termination; отсутствие разрешения/URL завершается ошибкой до DDL. Не доказывать это на пользовательской БД: sentinel DB создаётся самим проверочным тестом и удаляется только им.

### R2 [P1] Loopback guard проверяет не тот адрес, к которому подключится pg
`tests/db/global-setup.ts:32–46,55–57,67`: `new URL(rawUrl).hostname` валидируется, но оригинальный URL со всеми query parameters затем передаётся pg. pg поддерживает переопределение host через query string. Независимое воспроизведение БЕЗ сетевого подключения на установленном pg 8.23.1:
```text
postgresql://synthetic:placeholder@127.0.0.1:55432/orbit_test?host=10.0.0.5
guardHost = 127.0.0.1
new Client({connectionString: URL}).host = 10.0.0.5
```
Таким образом guard проходит, а административный CREATE/DROP может попасть на удалённый PostgreSQL. Это нарушает обязательный отказ от remote/unknown target до DDL.

Исправить единую валидацию именно эффективной конфигурации подключения. Простой допустимый вариант для local-only runner: разрешить только postgresql/postgres protocol и запретить query parameters целиком, затем собрать pg config из уже проверенных host/port/database/user/password вместо повторной передачи непроверенного URL. Учитывать URL-нормализацию IPv6 (`[::1]`), percent decoding и возможные PG environment defaults; не выводить user/password/full URL. Все admin/test/helper подключения должны использовать один проверенный target. Не переносить проверку только в README.

Acceptance: remote host, локальный URL с `?host=remote`, host/port overrides и недопустимый protocol отвергаются ДО подключения и DDL; допустимые явно выбранные local targets проходят. Добавить воспроизводимые guard tests без доступа к реальным remote серверам.

## Независимые проверки
Runtime Node 24.21.0 / npm 11.19.0.
- `npm ci --offline` сначала ENOTCACHED (xtend отсутствовал в cache). Повторный `npm ci --cache ...` с registry доступом — PASS; tracked lockfile не менялся.
- `npm run lint`, `npm run typecheck`, `npm test` — PASS, 4 UI tests.
- Docker read-only inventory: `orbit-postgres` healthy, `127.0.0.1:55432`; отдельный `crm-db-1` на 5433 не изменялся.
- Для безопасного DB review использована новая UUID-named DB `orbit_review_<random>_test`, созданная Codex без предварительного DROP. На ней checked-in миграция применена дважды, journal остался с одной записью. Исходные 28 DB assertions прошли через временный reviewer config без небезопасного globalSetup. После закрытия соединений удалена ТОЛЬКО эта успешно созданная DB. Скрипты review находятся в work/ папки чата, не входят в реализацию.
- `npm run test:db` с оригинальным setup намеренно НЕ запускался из-за R1/R2. PASS 28 assertions не означает приёмку исходного runner.
- `npm run db:generate` — no schema changes, новых миграций нет.
- Auth generator повторно выполнен в отдельный scratch output; `cmp` с tracked schema.auth.ts — совпадение. При генерации Better Auth 1.7.7 выводит предупреждение baseURL и diagnostic «Missing tables ...» для config без schema, затем CLI успешно генерирует файл; auth runtime этим не проверен.
- `CI=1 E2E_PORT=3157 npm run test:e2e` — PASS: production build и 47 browser tests. localhost:3000 не занимался. Этот независимый build загрузил существующий ignored .env; отдельная проверка build без env в этом review не повторялась (есть только evidence исполнителя).
- Pattern check по конкретному текущему ORBIT_DB_PASSWORD: 0 совпадений в tracked файлах. Это ограниченная проверка, не полный security audit.

## Неблокирующие замечания / ограничения
- Полный npm audit: 21 package findings (8 moderate,12 high,1 critical). Critical относится к вложенному better-auth 1.4.22 старого deprecated `@better-auth/cli`, вместе с вложенным drizzle-orm 0.41.0; основной better-auth 1.7.7 / drizzle-orm 0.45.3 — другие экземпляры. Executor report ошибочно сводит audit к прежнему braces риску. Обновить фактическую картину в отчёте. Новый официальный CLI `auth` стоит оценить отдельно для закреплённой совместимой версии, без force fixes/изменения runtime в рамках R1/R2.
- `npm audit --omit=dev`: 4 moderate package findings в одной цепочке drizzle-kit→esm-loader→core-utils→esbuild (advisory о dev server), high/critical 0. drizzle-kit отмечен lockfile как devOptional из-за dependency graph. Не называть production audit чистым; нет evidence, что уязвимый esbuild server используется текущим приложением. До deployment пересмотреть toolchain, не выполнять предложенный audit downgrade drizzle-kit до 0.18.1 автоматически.
- В client.ts термин server-only пока комментарий, без Next `server-only` marker. Текущих client consumers нет; добавить enforceable boundary до первого подключения из app/service слоя. Сам module ленивый, getDbPool возвращает pg Pool, Drizzle обёртка пока только в миграциях.
- Auth timestamps без timezone сохранены по генератору; доменные events timestamptz. Политику auth timestamp timezone подтвердить при TASK-004 runtime integration.
- Executor report говорит, что у completion нет отдельного user FK; фактические TS/SQL его содержат. Обновить отчёт, схему ради удаления корректного FK менять не требуется.
- DB assertions на UPDATE ограничены сменой owner task/project и self-parent. При дальнейших owner service tests дополнить сценарии смены project_id/parent_id и completion task/owner; SQL composite FK уже присутствуют.
- Native devices/auth flows/IDOR API/recurrence algorithm/container restart/production не проверялись и не входят в текущую приёмку.

## Поручение GLM
Исправить только R1 и R2, добавить связанные runner/guard regression checks и актуализировать README/.env.example/reports/TASK-003-executor.md. Та же ветка/worktree, обычные новые коммиты, без amend/rebase/reset/merge/push; корневые coordination docs не менять. Выполнить обязательные gates TASK-003 (включая исправленный npm run test:db), вернуть полный latest SHA и READY_FOR_REVIEW либо BLOCKED. После отчёта остановиться. TASK-004 не начинать.
