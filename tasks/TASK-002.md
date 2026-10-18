# TASK-002 — дизайн-система и адаптивная навигация Orbit

## TASK ID
TASK-002. DONE — принят Codex и локально интегрирован 2026-10-08 после исправления R1. Ниже сохранено исходное задание; повторно не выполнять. Итог: reports/TASK-002.md.

## Цель
Заменить стартовую карточку на полноценный каркас веб-интерфейса: реальные маршруты основных разделов, desktop/sidebar и mobile/bottom navigation, shadcn/ui и работающий выбор темы. Данные задач и аккаунтов ещё не подключаются.

## Контекст
Прочитать AGENTS.md, PRODUCT.md, ARCHITECTURE.md, DESIGN.md, DECISIONS.md и этот TASK. TASK-001 принят: Next 16.4.0 / React 19.3 / Tailwind 4.3.3 через @tailwindcss/turbopack, strict TS, Node 24 LTS, npm. Команды foundation проходят. В интерфейсе пока только статическая карточка Orbit.
Следующие задачи подключат БД и auth. Не вводить ложные задачи, аккаунты, счётчики и рабочие CRUD-кнопки. Будущие iOS/macOS/Telegram используют общий backend, но не входят в этот TASK.

## Исходное состояние
- База review: `223e75cee2025e0644a0aee3f0de59a424d65f83` (принятый foundation, совпадал с origin/main перед назначением).
- Ветка: `task/TASK-002`.
- Worktree: `/Users/atlhnv/Codex/orbit-worktrees/TASK-002`.
- Codex: `/Users/atlhnv/Orbit`, main.
- Между базой и стартом исполнения ожидается один assignment commit Codex: tasks/TASK-002.md, TASKS.md, AGENTS.md, DESIGN.md и DECISIONS.md. В нём нет изменений исходников/зависимостей.
- До изменений записать `git rev-parse HEAD` (starting SHA), проверить branch/status и log от базы. Стартовая ветка должна совпадать с main на момент выдачи, дерево должно быть чистым. Точный стартовый SHA также в файле передачи пользователя.
- Старый TASK-001 worktree не использовать. Remote доступность не подразумевается: это локальный worktree.

## Scope
Обязательные области:
- `src/app/layout.tsx`, `src/app/page.tsx`, `src/app/globals.css`;
- маршруты/layout в `src/app/(workspace)/`: today, inbox, upcoming, projects, settings;
- `src/components/orbit/`: app shell, desktop/mobile navigation, reusable empty view, theme provider/selector;
- `src/components/ui/`: только действительно используемые shadcn Button и Select (включая необходимые helpers);
- `src/lib/utils.ts`, `src/lib/i18n/ru.ts` (единый источник UI-строк);
- `components.json`, `package.json`, `package-lock.json`;
- `README.md`, tests с обновлением foundation smoke; `reports/TASK-002-executor.md`.
Допустимы при непосредственной необходимости: дополнительные доступные shadcn primitives, next-themes, lucide-react, clsx/tailwind-merge/CVA, Playwright config + browser tests и script test:e2e, test setup, .gitignore для generated artifacts. Всё с npm lockfile.
Не менять корневые PRODUCT/ARCHITECTURE/DESIGN/TASKS/DECISIONS/AGENTS, исторические docs/source/, завершённые reports/TASK-001*, tasks/TASK-001.md. Предложения — в отчёте. Не менять Next/React/tooling versions для необязательного cleanup; существующий dev audit риск уже известен Codex.

## Требования
### 1. Маршруты и границы
- `/` перенаправляет на `/today`.
- `/today` — «Сегодня», `/inbox` — «Входящие», `/upcoming` — «Предстоящее», `/projects` — «Проекты», `/settings` — «Настройки».
- Общий route-group layout `(workspace)` сохраняет оболочку при навигации. Server components по умолчанию; client boundary только где нужны pathname, интерактивность и тема.
- Каждый экран содержит один h1 и осмысленное статическое пояснение. Today/Inbox/Upcoming/Projects прямо сообщают, что данные/создание задач будут подключены на следующих этапах. Не выдавать «у вас нет задач» за ответ реальной БД.
- Settings содержит только рабочий выбор темы и пояснение, что аккаунт/timezone подключатся позже. Не показывать fake user, login/logout или signup.
- Нет search, quick-add, FAB, фиктивных задач/проектов/дат/counts и product shortcuts Q/ /. Их очередь — после data TASK. Элементы навигации и выбора темы реально работают.

### 2. Визуальные решения
- Русский интерфейс, название Orbit, системный font stack; не добавлять сетевые шрифты/аналитику/внешние картинки.
- Нейтральные поверхности и сдержанный indigo accent (семейство existing favicon); семантические tokens light/dark, без произвольных hex в каждой компоненте.
- Tokens background, foreground, surface/card, muted + muted-foreground, border, accent/primary с foreground, danger/destructive, ring; совместить с реальной shadcn theme convention. Сохранить контраст обычного текста и focus outlines в обеих темах.
- Существующий prefers-color-scheme CSS не должен переопределять явно выбранную тему. Dark вариант контролируется root class/theme provider.
- Читаемый body 14–16 px, достаточные отступы, без большой декоративной hero-зоны и тяжёлых анимаций.
- Иконки lucide-react либо доступные локальные SVG. Декоративные иконки aria-hidden, icon-only кнопкам accessible label.

### 3. Desktop / mobile
- >=960 px: sidebar около 240 px с Orbit и четырьмя основными ссылками; Settings внизу. Header/content справа. Main content ограничить разумной шириной, не растягивать пояснения на весь монитор.
- <960 px (включая 768): компактный header с Orbit и доступной ссылкой Settings; bottom nav из четырёх ссылок «Сегодня», «Входящие», «Предстоящее», «Проекты». Sidebar скрыт.
- Использовать единый breakpoint 960 px (Tailwind arbitrary variant или явная CSS media query), не менять его случайно на стандартный lg=1024.
- Активная ссылка различима не только цветом, имеет aria-current="page"; скрытая версия nav не остаётся доступной в tab order/AX tree.
- Bottom nav учитывает env(safe-area-inset-bottom). Content имеет нижний padding, который исключает перекрытие последнего элемента, включая settings selector и footer пояснения. Для viewport использовать подходящие min-height/svh/dvh, без жёсткой высоты и скрытия контента.
- На 360/390/768/1280 px нет horizontal overflow; touch targets >=44×44 px, в том числе каждая ссылка bottom nav и settings access.

### 4. Темы
- Использовать next-themes по официальному shadcn Next.js guide; defaultTheme="system", enableSystem, class attribute, локальное сохранение под отдельным ключом `orbit-theme`.
- В Settings Select «Тема»: «Системная», «Светлая», «Тёмная». Выбор применяется сразу и сохраняется после refresh и переходов между экранами.
- В этом TASK настройка хранится только на устройстве; это явно указано. Account persistence — TASK-005.
- Предотвратить hydration mismatch и неверную первоначальную подпись Select: согласованный server fallback до mount. suppressHydrationWarning допустим только на html для next-themes; не скрывать ошибки всего дерева.
- В system режиме учитывать изменения системной темы. Не использовать обращения к window/localStorage во время server render.

### 5. shadcn и доступность
- Использовать официальный existing-project workflow, npm и совместимые stable packages; зафиксировать точные версии и источники в отчёте. Не запускать генератор нового приложения, не перезаписывать configs/документы без review diff.
- Сохранить подключение Tailwind через работающий Turbopack loader; не добавлять одновременно второй CSS pipeline без технической необходимости.
- components.json согласован с src/, @ alias и globals.css; импортируемые generated компоненты хранятся в src/components/ui.
- Реально использовать Button/Select, а не добавлять библиотеку только в package.json. Доступные primitives не заменять самодельным popup.
- nav landmarks имеют понятные имена, есть skip link «К содержимому», main имеет соответствующий id. Visible focus; все действия доступны клавиатурой.
- Select: раскрытие/выбор стрелками/Enter, закрытие Esc с возвратом фокуса. UI уважает prefers-reduced-motion. Не реализовывать отдельную модалку ради демонстрации.

### 6. Проверки и документация
- Сохранить dev/start/lint/typecheck/test/build, strict TS; не отключать проверки и не использовать passWithNoTests.
- Обновить существующий smoke test осмысленно после redirect /; проверить реальный render экрана/оболочки, а не только string constants. Не тестировать Next framework redirect вместо пользовательского поведения.
- Добавить минимальный browser regression test (Playwright предпочтительно) на навигацию, активную ссылку, выбор light/dark с persistence после refresh и overflow. Допустим существующий browser tool вместо нового runner, если все сценарии фактически проверены и есть воспроизводимый чеклист; не считать DOM render test доказательством работы themes/navigation.
- README обновить: доступные routes, theme storage, команды тестов, что auth/tasks/backend ещё отсутствуют. Если добавлен Playwright, указать установку Chromium и запуск tests с production build, отдельным свободным loopback-портом; не останавливать чужие сервисы.

## Не делать
PostgreSQL, Docker, auth/аккаунты, CRUD, серверные API, реальные задачи/проекты, localStorage task database, recurrence, search, task detail sheet, PWA/service worker, native apps, Telegram, MCP, деплой, push и merge. Не менять известные dev dependencies ради непрошенного audit cleanup. Не начинать TASK-003.

## Acceptance criteria
1. Работают все пять маршрутов, прямой HTTP-вход/refresh и переходы через Link; `/` ведёт на `/today` без 404. Нет фиктивной функциональности.
2. Desktop sidebar и mobile bottom nav переключаются на 960 px; активная ссылка/Settings access корректны на всех экранах.
3. На 360/390/768/1280 px readable layout, нет horizontal overflow/перекрытия контента, все touch targets >=44 px. Light и dark визуально проверены.
4. Theme Select работает мышью и клавиатурой; light/dark/system сохраняются локально после reload. Нет hydration ошибок и неверной подписи выбранной темы после mount.
5. Keyboard navigation, skip link, focus и aria-current работают; скрытая nav не создаёт дублированных tabbable controls.
6. shadcn components используются реально; все UI strings централизованы, npm lockfile актуален; build/start не требуют БД/auth secrets/внешних шрифтов.
7. npm ci/lint/typecheck/test/build проходят на Node 24; browser проверки выполнены и воспроизводимы, scope соблюдён, README/отчёт актуальны.

## Проверки
До изменений: pwd, git rev-parse --show-toplevel, git branch --show-current, git status --short, git rev-parse HEAD, git log --oneline 223e75cee2025e0644a0aee3f0de59a424d65f83..HEAD, node --version, npm --version.
После реализации:
```sh
npm ci
npm run lint
npm run typecheck
npm test
npm run build
git diff --check
```
Production smoke: npm start на свободном loopback порту, HTTP проверка / redirect и всех пяти routes; затем browser scenarios:
- каждая ширина 360/390/768/1280: Today → Inbox → Upcoming → Projects → Settings; active item, читаемость и overflow;
- light/dark на 360/1280; Settings light → refresh → dark → navigation → refresh; system preference если tools поддерживают emulation;
- Tab/Shift+Tab, skip link, Select keyboard + Escape; Settings доступен в обоих layouts;
- browser console без hydration/runtime errors. Сохранить screenshot evidence там, где поддерживается; не включать generated screenshot/test artifacts в Git без необходимости.
Если browser/Node24 недоступен, отметить непроверенные criteria, не выдумывать PASS. Обязательные gates, которые нельзя выполнить, — BLOCKED с точной причиной.
После commit: git diff --check 223e75cee2025e0644a0aee3f0de59a424d65f83..HEAD, git diff --stat от базы, git status --short.

## Git
Только task/TASK-002 в назначенном worktree. Обычные новые коммиты, история сохраняется. Запрещены push/merge/amend/rebase/reset/force push и изменение других веток. Reports file не может содержать SHA самого будущего report commit; latest full SHA возвращается в ответе.

## Результат
Создать reports/TASK-002-executor.md, вернуть READY_FOR_REVIEW либо BLOCKED:
- branch, полный starting SHA и latest SHA;
- изменения и файлы, версии добавленных dependencies;
- фактические команды/exit codes, browser scenarios и evidence;
- непроверенные условия, ограничения, предложения к документации.
После отчёта остановиться и ждать review Codex.

## Официальные источники
Проверены координатором 2026-10-08; исполнитель проверяет текущие API при установке:
- https://ui.shadcn.com/docs/installation/next — existing project, src/alias.
- https://ui.shadcn.com/docs/dark-mode/next — next-themes и theme provider.
