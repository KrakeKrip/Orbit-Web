# TASK-001 — Next.js foundation

## TASK ID
TASK-001. Статус DONE — принят Codex и локально интегрирован 2026-10-08. Ниже сохранено исходное задание; повторно не выполнять. Результаты: reports/TASK-001.md.

## Цель
Создать запускаемый минимальный Next.js App Router проект с TypeScript и Tailwind CSS, воспроизводимой установкой и командами проверок. Это только foundation; функциональность таск-менеджера не входит в задачу.

## Контекст
Прочитать AGENTS.md, PRODUCT.md, ARCHITECTURE.md, DESIGN.md, DECISIONS.md, затем этот TASK. TASKS.md — очередь, не разрешение на весь Milestone 0. CODEX_PROMPT.md помечен superseded и не является заданием.
Спецификации целевые: кода, зависимостей, БД и тестов пока нет.

## Исходное состояние
- База review (координационный foundation commit): `a1ebc3b024cfafe44c5e25d9167ac77a4df3c962`.
- Ветка: `task/TASK-001`.
- Worktree: `/Users/atlhnv/Codex/orbit-worktrees/TASK-001`.
- Корень координатора: `/Users/atlhnv/Orbit`, ветка main.
- После указанной базы Codex добавляет только этот TASK отдельным assignment commit; ветка исполнителя создаётся на assignment commit. Это ожидаемый координационный diff, не работа GLM.
- Точный стартовый SHA: `git rev-parse HEAD` перед первым изменением; он должен совпасть с `git rev-parse main` и содержать только assignment commit поверх базы. Записать SHA в отчёте до реализации. main не изменять.
- На момент выдачи worktree должен быть чистым. Если HEAD/ветка/файлы расходятся с этим состоянием, вернуть BLOCKED и описать расхождение.
- На машине Codex Node 26.10.0 / npm 11.19.1; это инвентаризация, не целевой runtime и не результат тестов приложения.

## Scope
Обязательные файлы:
- package.json, package-lock.json; только npm, без альтернативных lockfiles.
- .nvmrc, TypeScript и Next.js configuration, ESLint flat config, PostCSS/Tailwind configuration по установленной версии.
- src/app/layout.tsx, src/app/page.tsx, src/app/globals.css, next-env.d.ts при генерации.
- vitest.config.ts и минимальный smoke test в tests/.
- README.md; reports/TASK-001-executor.md.
Допустимо при непосредственной необходимости: .gitignore, public/ с локальным favicon, вспомогательные configs/setup test. Не создавать пустую структуру будущих auth/db/services ради дерева.
Не менять AGENTS.md, PRODUCT.md, ARCHITECTURE.md, DESIGN.md, TASKS.md, DECISIONS.md, CODEX_PROMPT.md, docs/source/ и reports/README.md. Предложения к ним — в отчёте.

## Требования
1. Node 24 LTS как целевой runtime, npm; зафиксировать .nvmrc и совместимые engines. Проверить совместимые stable Next.js/React/TypeScript/Tailwind/Vitest/ESLint по официальным docs, записать точные версии и источники в отчёт. Не использовать prerelease, legacy next lint или отключение lint/type errors ради успешной сборки.
2. Scaffold создавать аккуратно: не запускать генератор поверх документов с риском перезаписи. Можно генерировать во временной директории и переносить только разрешённые файлы.
3. App Router, src/, strict TypeScript, alias @/* → src/*. Статическая стартовая страница на русском с названием Orbit и пояснением «Персональный менеджер задач». html lang=ru, корректные metadata. Без mock tasks, неработающих продуктовых кнопок или навигации будущих экранов.
4. Tailwind подключён, базовый читабельный responsive layout без horizontal overflow на 360 px. Использовать системные шрифты; build/start не требуют внешней сети, PostgreSQL или auth secrets. shadcn/ui и полный app shell — TASK-002.
5. Scripts: dev, start, lint (eslint), typecheck (tsc --noEmit), test (vitest run), build (next build). Команды не должны скрывать ошибки или проходить за счёт passWithNoTests.
6. Vitest smoke: импорт/рендер стартовой страницы, проверка доступного heading и отсутствие ошибки рендера. Не добавлять фиктивную бизнес-функцию или тест 1+1 лишь для зелёного test. Проверка boot страницы через HTTP отдельно обязательна.
7. README: prerequisites, Node/npm versions, npm ci, dev, production build/start, scripts, порт localhost 3000; честный перечень ещё не реализованных возможностей. Не добавлять секреты или ненужные env placeholders. Не устанавливать ничего глобально.
8. Если Node 24 недоступен, не менять системный Node и сторонние проекты. Допустим существующий version manager или локальный runtime в worktree; иначе сообщить ограничение, точный фактический runtime и результат проверок. Проверка на другом Node не подтверждает целевой Node 24.

## Не делать
Auth, PostgreSQL/Drizzle, migrations, Docker setup, app shell, projects/tasks CRUD, recurrence, PWA/service worker, MCP, CI/CD, deploy, remote/VPS/VPN actions. Не выполнять следующие TASK. Не удалять исходные спецификации и не переписывать историю. Не применять --force/--legacy-peer-deps вместо устранения совместимости.

## Acceptance criteria
- Весь diff в разрешённом scope; документы пользователя сохранены.
- npm ci воспроизводит install по lockfile, без unresolved peer dependencies.
- npm run lint, npm run typecheck, npm test, npm run build проходят; strict mode включён, тест действительно выполняется.
- После production build приложение запускается через npm start на свободном локальном порту, GET / возвращает 200 и Orbit; нет runtime exception.
- На 360 и 1280 px страница читаема, без горизонтального overflow; если браузер недоступен, явно указать непроверенный criterion.
- README достаточно для повторного запуска; нет секретов/личных данных/generated build artifacts в Git.
- Нет реализации за рамками foundation, зависимости и runtime отражены в отчёте.

## Проверки
До изменений:
```sh
pwd
git rev-parse --show-toplevel
git branch --show-current
git status --short
git rev-parse HEAD
git log --oneline a1ebc3b024cfafe44c5e25d9167ac77a4df3c962..HEAD
node --version
npm --version
```
После установки и реализации:
```sh
npm ci
npm run lint
npm run typecheck
npm test
npm run build
git diff --check
git status --short
```
Запустить npm start на свободном порту (например `npm start -- --hostname 127.0.0.1 --port 3101`), проверить GET / через curl/browser, завершить только собственный процесс. Не останавливать существующие сервисы.
Проверить страницу browser на 360/1280 px и записать результат либо ограничение. После commit проверить diff от базы и отсутствие непредусмотренных файлов:
```sh
git diff --check a1ebc3b024cfafe44c5e25d9167ac77a4df3c962..HEAD
git diff --stat a1ebc3b024cfafe44c5e25d9167ac77a4df3c962..HEAD
git status --short
```
При недоступной сети/инструментах не выдумывать результаты; BLOCKED если обязательный gate не выполнен. Не повышать задачу до DONE самостоятельно.

## Git
Только task/TASK-001 в назначенном worktree. Обычные новые коммиты, например `feat: scaffold Orbit Next.js foundation`; отчёт отдельным обычным commit при необходимости. Никаких merge, push, amend, rebase, reset и force push. Сохранить все коммиты для независимого review.
В отчёте фиксировать SHA реализации, а в ответе пользователю полный SHA последнего commit, включая report commit; не пытаться вписать в сам commit его будущий SHA.

## Результат
Создать reports/TASK-001-executor.md и вернуть:
- READY_FOR_REVIEW либо BLOCKED;
- branch, полный starting SHA и полный latest SHA;
- выполненные изменения и конкретные файлы;
- точные версии, runtime, ссылки на официальные источники;
- реально выполненные команды и результаты/exit codes;
- HTTP/browser проверку, известные ограничения и непроверенные критерии.
Остановиться и ждать независимого review Codex. Не начинать TASK-002.
