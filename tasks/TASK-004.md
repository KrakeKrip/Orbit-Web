# TASK-004 — Better Auth, вход и защищённые серверные границы

## Статус / цель
DONE — независимое review 2026-10-08 завершено, R1/R1b/R2/R3/R3b/R3c закрыты; локальный merge 6424fd247af9f21a3e556a207412ef4ae2df7aef и интеграционные проверки PASS. Отчёт: reports/TASK-004.md. Исходная цель: Подключить настоящий email/password вход к принятой PostgreSQL схеме, запретить публичную регистрацию на сервере, создать безопасную локальную процедуру первого аккаунта и reusable session boundary. CRUD/tasks/settings persistence не входят в задачу.

## Исходное состояние
Прочитать AGENTS.md, PRODUCT.md, ARCHITECTURE.md, DESIGN.md, DECISIONS.md, reports/TASK-003.md и этот TASK.
- База review: `fbebaef9a1300bd0212dac48ae7f78c700aa9fc1` — принятый TASK-003.
- Ветка `task/TASK-004`, worktree `/Users/atlhnv/Codex/orbit-worktrees/TASK-004`.
- Main координатора `/Users/atlhnv/Orbit` не менять. Старые worktrees не использовать.
- Между audit-базой и стартом — assignment commit Codex: этот TASK, AGENTS/TASKS/ARCHITECTURE/DESIGN/DECISIONS. Полный starting SHA записать до изменений, сверить с передачей пользователя.
- Проверить pwd, toplevel, branch/status, полный HEAD, log от базы, Node/npm. Node 24 LTS, npm/единственный lockfile.
- Приняты: Next 16.4/React 19.3, UI shell five routes/theme; Drizzle ORM 0.45.3/pg 8.23.1/Better Auth 1.7.7 core tables. 4 UI/47 DB/47 browser tests. Auth/user services ещё не реализованы. Pg pool пока без enforceable server-only marker, auth timestamps — convention генератора; это нужно проверить сейчас.
- PostgreSQL Orbit healthy на loopback 55432 при выдаче. Текущий просмотр main localhost:3000 и сторонний crm-db-1 не трогать. Реальные credentials не копировать в tracked files/отчёты; isolated tests создают синтетические аккаунты и свои уникальные DB. Не создавать личный аккаунт пользователя без его credentials: GLM реализует процедуру, в тестах только synthetic.

## Scope
src/server/auth/ (config/factory, session guards, env validation, bootstrap core); src/server/db/client.ts (server boundary + Drizzle accessor); src/lib/auth-client.ts; src/app/api/auth/[...all]/route.ts; src/app/api/v1/me/route.ts; src/app/login/; src/app/(workspace)/layout.tsx и минимальная UI кнопка выхода в Settings; src/components/orbit/ для login/logout, src/components/ui/ необходимые Input/Label, src/lib/i18n/ru.ts; scripts/bootstrap-user.*; .env.example, README; package.json/lockfile (только необходимые Zod/server-only/helpers); tests/ и configs auth/DB/E2E runners; next.config.ts; reports/TASK-004-executor.md.
Допустимо добавлять test scripts/configs и исправить ownership cleanup собственных fixture из TASK-003 при повторном использовании для auth tests. Никакого предварительного DROP существующих DB/fixtures. Только если runtime совместимость требует: auth schema generator config/генерируемая schema.auth.ts + новая миграция; объяснить причину, не редактировать принятую старую миграцию и не менять доменную схему без BLOCKED/обсуждения.
Не менять корневые coordination docs/исторические docs/source/прежние reports/TASK. UI изменения только login/logout и protection; навигация/темы не переделываются. Не обновлять framework/toolchain без необходимости, audit fix --force запрещён.

## 1. Runtime auth и environment
- Использовать основной Better Auth 1.7.7, его совместимый Drizzle adapter и существующие user/session/account/verification exports. Никаких отдельных users таблиц, password форматов или собственных JWT/session protocol.
- Реальный config: emailAndPassword.enabled=true, disableSignUp=true без env переключателя, social/plugins/anonymous signups отсутствуют. Не наследовать runtime из generator config с signup ON. Сам факт отсутствия формы регистрации не защита: прямой HTTP POST signup обязан быть отвергнут и не создавать rows/session/cookies.
- Проверяемые DATABASE_URL, BETTER_AUTH_SECRET (достаточная длина/случайность) и явный BETTER_AUTH_URL/baseURL. trustedOrigins только заданные origins; никаких wildcard и доверия любому Host/forwarded header. Ошибки не печатают credentials/URL/секреты. При отсутствии конфигурации явный auth запрос ошибается понятно, без fallback secret/admin user.
- Build и быстрые UI/pure tests без env/БД остаются рабочими: lazy initialization, никаких request/session queries на build/import. Приложение с отсутствующей runtime-конфигурацией не должно превращаться в anonymous workspace. Авторизованный локальный запуск требует env + migration.
- Enforceable server-only marker на app-facing DB/auth modules; CLI/test-compatible lower-level core допускается отдельно, не ослаблять boundary ради Vitest. Не передавать pool/auth secret в client bundle.
- Next cacheComponents/partialPrefetching выключить в этом TASK: для текущего небольшого shell ещё нет оправданных cached data paths. Protected pages/session reads динамические; без use cache/unstable_cache вокруг auth. Обычный request-local dedup допустим, если не переживает request. Root / по-прежнему ведёт /today и дальше guard.
- Session cookie cache отключён явно: revoked session не принимается по cookie snapshot. Auth timestamps/conversion: подтвердить реальный session expiry на PostgreSQL, не сравнивать локальные строки как UTC. Cookie secure в HTTPS deployment policy, HttpOnly и SameSite; loopback HTTP development поддерживается документированным config. CSRF/origin defenses не отключать для прохождения тестов.
- Явно включить sign-in rate limiting и проверить 429. Допустим Better Auth memory storage для одного локального процесса: разумный documented sign-in лимит (например 5 попыток/60s), без Redis/новой инфраструктуры. Это не распределённая durable защита; до deployment пересмотр trusted proxy/IP и limiter storage. Тесты используют изолированные процессы/тестовые identities, не выключают limiter в app runtime.

## 2. Session boundaries
- /login открыт анонимно; все пять workspace routes закрыты server-side. Guard в layout обеспечивает redirect, но не заменяет проверку каждого server entry point/service.
- Создать reusable requireUser/requireSession для последующих services: доверенная identity только из проверенной сессии текущего запроса. Отсутствующая/поддельная/истёкшая/отозванная сессия не даёт actor. Ни user_id/owner_id/query/header от клиента не определяют пользователя.
- Browser pages анонимно перенаправляются /login. Session errors не маскировать под signed-in empty state. Вход ведёт /today; login уже авторизованного пользователя — /today. Не добавлять произвольный redirect/callback parameter, открывающий external redirect; фиксированный /today достаточен.
- Минимальный защищённый GET /api/v1/me упражняет server boundary для будущего HTTP API: 200 JSON {user:{id}} из session, 401 JSON {error:{code:"UNAUTHENTICATED"}} без session. Никаких user/email/session tokens/password hashes в ошибке; переданный user_id/owner_id не меняет результат. Cache-Control: private, no-store и никаких shared cache responses. Это один identity endpoint, не CRUD/API SDK/MCP.
- Better Auth route handler использует documented Next integration; реальные cookies и getSession. Наличие cookie само по себе не авторизация. Proxy/middleware необязателен; если используется, только UX shortcut, не единственная защита.

## 3. Login / минимальный logout
- Русский /login: email/password inputs с labels, корректные autocomplete email/current-password, submit, pending/disabled state, keyboard Enter/focus, понятная generic ошибка неверного email/password без user enumeration. Никаких signup/reset/OAuth/email sending. UI strings — единый ru.ts.
- Использовать существующие tokens/shadcn, light/dark, 360/390/1280px; controls >=44px, без horizontal overflow. Auth form не внутри workspace navigation. Сохранить выбранную локальную тему.
- Минимальная реальная кнопка «Выйти» в Settings: Better Auth signOut, pending/error, очистка клиентской session state и переход /login. Это часть TASK-004 для проверки session revocation; TASK-005 добавит preferences, не дублирующий auth flow.
- После выхода refresh/direct entry/server endpoint снова закрыты. Back navigation не должна возвращать работоспособный authenticated state: при новом запросе guard проверяет сессию. Две одновременные browser contexts не смешивают пользователя и cache.
- Workspace по-прежнему показывает честные data placeholders. Не добавлять fake task rows, account settings/timezone или CRUD.

## 4. Локальная одноразовая bootstrap процедура
- npm run auth:bootstrap (или documented equivalent) создаёт email/password account через поддерживаемый Better Auth API/crypto и adapter, без собственного password hashing. Account schema и subsequent signIn совместимы с runtime config.
- Работает только как локальный операторский CLI: явно проверенный local DB target, явное разрешение provisioning, приватный ввод данных (stdin/prompts/ignored private env); пароль не argv/history/stdout/отчёт. Не запускать процедуру на пользовательских production/unknown DB. Имя/email/password берёт оператор, не hardcode реального owner.
- Повторный запуск с существующим email отказывается без изменения password/account и без нового user/session; никаких implicit upsert/reset или публичной bootstrap endpoint. Успешный bootstrap не оставляет активную session, cookies/token не выводятся. При частичном сбое не оставлять orphaned user/account; предусмотреть atomicity/rollback supported workflow.
- Допустим отдельный CLI-only Better Auth instance, позволяющий framework создание аккаунта, если это необходимо выбранному API. Его config не импортируется HTTP handler и не управляется browser request/env флагом публичного приложения; production app всегда disableSignUp=true. Не включать открытый signup «временно». Generator script тоже не auth route.
- Минимальный accounts provisioning core может использоваться тестами с синтетическими users A/B на собственной DB; не делать скрытой функции admin user creation по network.
- README: local bootstrap prerequisites/input, migration и запуск app, sign-in/logout, recovery пока вручную отдельным будущим TASK; public signup disabled. Продуктовые user_settings defaults могут быть созданы только если нужны bootstrap целостности; settings editing/validation — TASK-005.

## 5. Проверки и тестовая инфраструктура
- Сохранить DB suite 47 assertions и защиту R1/R2/R1b. Собственные unique fixture handles регистрировать сразу после CREATE и cleanup даже при failed initialization. Никакого удаления заранее существующей orbit_test/volume, никаких DROP IF EXISTS user DB, secrets/test storageState не коммитить.
- Отдельный auth integration suite на реальном PostgreSQL и настоящий Next production server для E2E. TEST_DATABASE_URL как validated local base namespace, уникальная DB каждого auth run, реальные миграции, синтетические A/B accounts, закрытые подключения/own-resource cleanup. Никогда fallback на dev DB для автоматических auth/browser tests. Не seed/clear dev DB ради тестов.
- Auth E2E требует env/DB, но build/UI/pure tests остаются без env. Разделить build-time и runtime config; test runner после build запускает server с собственной test DB/temporary secret/baseURL в памяти. CI=1/reuseExistingServer=false, отдельный free loopback port. DB teardown после остановки своего server, не чужих процессов.
- Существующие 47 navigation/theme browser scenarios адаптировать к authenticated fixture/context, сохранить их пользовательские assertions (не удалять/skip ради auth). Минимум browser flow anonymous → login error → valid login → /today → refresh → Settings logout → anonymous; 360px и desktop. Два контекста users A/B + /api/v1/me возвращают разные actor IDs.
- Integration/HTTP: public signup forbidden and no user/account/session changes; bootstrap compatible sign-in and duplicate email unchanged; wrong-password/unknown-email generic rejection; missing/tampered/expired/revoked session 401 + page redirect; authenticated identity; query/body/header user_id cannot impersonate; hostile Origin mutation/signup/signin rejected там, где применима framework защита; origin/cookie policies подтверждены. Rate limit 429 на реальном runtime path. Реквизиты cookies/tokens не выводить.
- No DB/secret fallback tests: build без env PASS; auth requests без runtime env fail closed, protected workspace не открыт. Unit/pure env validation tests допустимы, но не заменяют HTTP/DB auth.
- Загруженные server modules должны использовать основной auth 1.7.7, не вложенный deprecated CLI auth 1.4.22. CLI генерации не нужен для обычного runtime. Full/omit-dev audit выполнить и отделить новые риски от уже принятых tooling warnings, без автоматических force fixes. Вынесение/замена старого generator CLI — proposal, не обязано расширять TASK, если схема остаётся совместимой.

## Acceptance / обязательные команды
До/после: branch/status/full SHA, diff от базы, git diff --check.
На Node 24: npm ci, npm run lint, npm run typecheck, npm test; npm run test:db; отдельный documented test:auth (или эквивалент) на реальной PostgreSQL; npm run build БЕЗ .env/auth secrets/DB; CI=1 E2E_PORT=<свободный порт> npm run test:e2e через own auth test DB. localhost:3000 не занимать. Не обещать PASS при skip/no runtime; обязательный gate недоступен — BLOCKED с причиной.
Реальные user-visible login/logout/cookies/HTTP boundaries проверены, PostgreSQL schema совместима, публичный signup выключен даже прямым запросом; bootstrap повторяем без повреждения существующего аккаунта; старые UI/navigation/theme/DB проверки сохраняются. README и env template позволяют воспроизвести запуск.

## Не делать / результат
Не реализовать projects/tasks/settings CRUD, recurrence, PWA/native/Telegram/MCP, email services/reset flow, deployment/VPS/push/merge. Не менять main/другие ветки/coord docs. Без amend/rebase/reset/stash; обычные новые commits.
Создать reports/TASK-004-executor.md: READY_FOR_REVIEW либо BLOCKED, full starting/implementation SHA, файлы/версии, реальные commands/exit codes/counts/HTTP/browser evidence, bootstrap method и boundaries, known limitations и непроверенное. Latest full SHA report commit вернуть в сообщении после commit, не вписывать будущий SHA в сам файл. После отчёта остановиться до review Codex; TASK-005 не начинать.

## Официальные источники
Координатор проверил 2026-10-08; исполнитель сверяет API с установленной 1.7.7:
- https://better-auth.com/docs/authentication/email-password
- https://better-auth.com/docs/integrations/next
- https://better-auth.com/docs/adapters/drizzle
- https://better-auth.com/docs/reference/options
