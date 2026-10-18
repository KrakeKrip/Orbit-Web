# TASK-002 — отчёт исполнителя (GLM)

## Статус

READY_FOR_REVIEW (после коррекции R1 по review reports/TASK-002.md от 2026-10-08).

## Correction R1 — мобильные touch targets >= 44×44 (этап NEEDS_FIXES)

Старт коррекции: HEAD `c4aae5f` (coord-коммит с review) поверх `b9971e6`. Исправлены только затронутые R1 файлы: `src/components/orbit/theme-select.tsx`, `src/components/orbit/mobile-header.tsx`, `tests/e2e/navigation.spec.ts` + этот отчёт; зависимости/документы/прочий код не менялись.

Причины дефекта и исправление (consumer-классы, без правки библиотеки):
- SelectTrigger имел generated `data-[size=default]:h-8` → добавлен `min-h-11`: в CSS `min-height` перекрывает `height` независимо от специфичности data-size вариантов (проверена фактическая геометрия, не только классы в source).
- SelectItem имел компактный `py-1` (~28 px) → добавлен `min-h-11`.
- Ссылка Orbit в mobile header имела `min-h-11` без минимума ширины → добавлены `min-w-11 justify-center` (текст центрируется, область 44×44).

Фактическая геометрия после фикса (production build, viewport 360×740, getBoundingClientRect, замер отдельным Playwright-скриптом):
- header link Orbit: **44×44** (было 36.56×44);
- `#theme-select` (trigger): **224×44** (было 224×32);
- раскрытые options «Системная/Светлая/Тёмная»: **219×44** каждая (было 219×28).

Расширенное regression-покрытие (tests/e2e/navigation.spec.ts, ширины 360 и 390):
- реальные boundingBox триггера, всех трёх раскрытых options (≥44×44, правый/нижний край в пределах viewport — без clip/overflow) и ссылки Orbit;
- закрытие Escape с возвратом фокуса на триггер, scrollWidth ≤ ширины viewport;
- выбор темы клавиатурой (Enter/ArrowDown/Enter → класс light, фокус на триггере) при мобильной ширине.

Признание: исходные 43 e2e-теста не покрывали theme trigger/options и ссылку Orbit, поэтому критерий «все touch targets ≥44×44» ранее не был полностью подтверждён — замечание review справедливо.

Повторные проверки после фикса (Node v24.21.0 / npm 11.19.0): `npm run lint` 0; `npm run typecheck` 0; `npm test` 0 (4 tests); `npm run test:e2e` 0 — **47 passed / 0 failed** (43 прежних + 4 новых); `next build` в составе e2e — 0; `git diff --check` чисто. Коммиты коррекции: fix + обновление отчёта (SHA — в ответе пользователю и в Git-логе; в файл отчёта собственный SHA не вписывается).

---

## Исходная реализация (до коррекции, сохранено без изменений)

## TASK

TASK-002 — дизайн-система и адаптивная навигация Orbit (shell, маршруты, shadcn/ui, темы).

## Исходное состояние (проверено до изменений)

- Worktree: `/Users/atlhnv/Codex/orbit-worktrees/TASK-002` — совпадает с назначенным; старый worktree TASK-001 не использовался.
- Ветка: `task/TASK-002`.
- Стартовый полный SHA: `586dc4316970d93166a69e727f75baab81fc1380` (равен main на момент выдачи).
- База review `223e75cee2025e0644a0aee3f0de59a424d65f83` — предок HEAD; поверх базы только assignment-коммит `586dc43` (только координационные документы, без исходников/зависимостей — проверено `git diff --stat` от базы).
- `git status --short` — пусто.

## Реализовано

- Маршруты: `/` → redirect на `/today`; route-group `(workspace)` с общим layout: `/today`, `/inbox`, `/upcoming`, `/projects`, `/settings`. Server components по умолчанию; client-границы только там, где нужны pathname/тема/интерактив (sidebar, header, bottom nav, ThemeProvider/ThemeSelect).
- App shell `src/components/orbit/`: desktop sidebar ~240 px (Orbit, 4 раздела, Settings внизу) при **≥960 px**; ниже — компактный header (Orbit + доступ к Settings) и bottom nav из 4 ссылок с `env(safe-area-inset-bottom)`. Единый breakpoint: `--breakpoint-shell: 60rem` (compiled `@media (min-width:60rem)`), не стандартный lg=1024.
- Доступность: skip link «К содержимому» (Tab → фокус → Enter → фокус на `main#content`), `aria-current="page"` + ненцветовые индикаторы активной ссылки (индикаторная полоса в sidebar, точка в bottom nav), именованные nav-landmarks, скрытые версии nav исключены из AX tree/tab order (display:none; в e2e проверено через getByRole count=1), touch targets ≥44 px (bottom nav min-h-14, header-кнопка 44×44), visible focus (ring), уважение `prefers-reduced-motion`.
- Темы: next-themes (attribute="class", defaultTheme="system", enableSystem, `disableTransitionOnChange`, storageKey **`orbit-theme`**) по официальному shadcn Next.js guide. В Settings Select «Тема»: Системная/Светлая/Тёмная; применение сразу, persist после refresh и навигации. Hydration-безопасность: до mount согласованный fallback «Системная» (useSyncExternalStore вместо setState-в-эффекте — см. решения); `suppressHydrationWarning` только на `<html>`. Старый `prefers-color-scheme` CSS из foundation удалён: явный выбор не перебивается, dark управляется классом `.dark`.
- shadcn/ui: официальный existing-project workflow (`npx shadcn@latest init -b radix -p nova` + `add button select`) на существующем проекте; реально используются Button (mobile Settings access, sidebar Settings) и Select (тема). Tailwind остался на работающем Turbopack loader (второй CSS pipeline не добавлялся).
- Токены: shadcn-конвенция (background/foreground/card/popover/muted+muted-foreground/border/accent/primary+foreground/destructive/ring/sidebar-*) со сдержанным indigo primary и ring; baseColor neutral. Никаких произвольных hex в компонентах; системный шрифтовой stack; сетевых шрифтов/аналитики/внешних картинок нет.
- Контент: каждый экран — один h1 + статическое пояснение; Today/Inbox/Upcoming/Projects явно сообщают, что данные подключатся позже (EmptyView, без выдачи за ответ БД); Settings — только рабочий выбор темы; без search/quick-add/FAB/счётчиков/shortcut-ов и каких-либо fake accounts.
- i18n: все UI-строки в едином `src/lib/i18n/ru.ts`.
- Тесты: foundation smoke переработан в `tests/workspace-pages.test.tsx` (реальный SSR-рендер 4 экранов: один h1, пояснения); Playwright e2e `tests/e2e/` (43 теста) + `playwright.config.ts` (webServer = production `npm start` на loopback, порт 3123 по умолчанию, `E2E_PORT` переопределяется); скрипт `test:e2e` = `next build && playwright test`.
- README обновлён: маршруты, хранение темы, команды тестов, установка Chromium, честный перечень отсутствующего.

## Изменённые файлы

| Файл | Что изменено |
| --- | --- |
| `package.json` / `package-lock.json` | зависимости (см. ниже), скрипт `test:e2e` |
| `components.json` | новый: shadcn конфиг (style radix-nova, baseColor neutral, aliases @/, css src/app/globals.css) |
| `src/app/globals.css` | shadcn-токены light/dark, indigo primary/ring, dark через `.dark`, breakpoint shell, reduced-motion |
| `src/app/layout.tsx` | ThemeProvider (next-themes), `suppressHydrationWarning` на html; Geist от CLI убран — системные шрифты |
| `src/app/page.tsx` | `redirect("/today")` |
| `src/app/(workspace)/layout.tsx` | общий AppShell |
| `src/app/(workspace)/{today,inbox,upcoming,projects,settings}/page.tsx` | новые экраны (h1 + пояснение + EmptyView; settings — ThemeSelect) |
| `src/components/orbit/{app-shell,desktop-sidebar,mobile-header,bottom-nav}.tsx` | оболочка и навигации |
| `src/components/orbit/{theme-provider,theme-select}.tsx` | темы |
| `src/components/orbit/{empty-view,page-header}.tsx`, `nav-items.ts` | переиспользуемые элементы, конфиг навигации |
| `src/components/ui/{button,select}.tsx` | сгенерированные shadcn компоненты (без ручных правок) |
| `src/lib/i18n/ru.ts` | единый источник UI-строк |
| `src/lib/utils.ts` | `cn` (сгенерирован CLI) |
| `playwright.config.ts` | конфиг e2e (production webServer на loopback) |
| `tests/app-page.test.tsx` | удалён (страница стала redirect; покрытие перенесено) |
| `tests/workspace-pages.test.tsx` | новый vitest smoke экранов |
| `tests/e2e/{navigation,theme}.spec.ts` | браузерная регрессия (43 теста) |
| `README.md` | маршруты/темы/тесты/ограничения |
| `reports/TASK-002-executor.md` | этот отчёт |

Не изменялись: корневые PRODUCT/ARCHITECTURE/DESIGN/TASKS/DECISIONS/AGENTS, docs/source/, reports/TASK-001*, tasks/, next.config.ts, tsconfig.json, eslint.config.mjs, .gitignore (playwright-report/ и test-results/ уже игнорировались), существующие версии Next/React/tooling.

## Добавленные зависимости (точные версии)

| Пакет | Версия | Назначение |
| --- | --- | --- |
| next-themes | ^0.4.6 (latest) | темы, peer react ^16.8–^19 |
| radix-ui | ^1.7.0 | consolidated Radix primitives (Select, Slot) — текущий официальный вывод shadcn CLI |
| class-variance-authority | ^0.7.1 | варианты Button (cva) |
| cn | ^0.4.0 | утилита классов, на неё ссылается сгенерированный `src/lib/utils.ts` |
| lucide-react | ^1.53.0 | иконки (aria-hidden, декоративные) |
| shadcn | ^4.21.4 | **devDependencies** — CLI-пакет; используется только `shadcn/tailwind.css` (custom-variants/keyframes) на этапе сборки |
| tw-animate-css | ^1.4.0 | **devDependencies** — анимации, только CSS-импорт на этапе сборки |
| @playwright/test | ^1.64.0 (latest) | e2e; бинарник Chromium установлен `npx playwright install chromium` в пользовательский кеш, в Git не входит |

Установка через npm, lockfile актуален, peer-конфликтов нет. Источники: registry.npmjs.org (dist-tags), https://ui.shadcn.com/docs/installation/next, https://ui.shadcn.com/docs/dark-mode/next.

## Решения в рамках локальной реализации (для сведения Codex)

1. **Геист-шрифт от CLI удалён**: `shadcn init` («Updating fonts») подключил `next/font/google` Geist — противоречит требованию системных шрифтов/сборки без сети; откатано, `--font-sans` = системный стек в CSS.
2. **shadcn и tw-animate-css перемещены в devDependencies** (CLI добавил их в dependencies): оба используются только на этапе сборки через CSS-импорт; runtime-импортов нет. На установку/сборку не влияет (проверено npm ci/build).
3. **Новая архитектура shadcn 4.x**: сгенерированные компоненты импортируют `cn` из пакета `cn` и примитивы из consolidated `radix-ui` — это текущий официальный вывод CLI (style radix-nova); сохранён без ручных правок.
4. **`useSyncExternalStore` вместо `useState`+`useEffect` для mounted-fallback**: правило `react-hooks/set-state-in-effect` (React Compiler-эпоха) помечает setState в эффекте; семантика та же (false на сервере/при гидратации, true после mount), lint-чисто.
5. **`main tabIndex={-1}`**: чтобы skip link реально переводил фокус на контент (проверено e2e).
6. **Playwright как runner** (TASK допускал и ручной browser tool): даёт воспроизводимость; ручной browser использован дополнительно для визуальной evidence (тёмная тема — браузер в dark scheme) и отладки.
7. Breakpoint реализован кастомным `--breakpoint-shell: 60rem` с вариантами `shell:` (min-width 960); max-shell не понадобился (mobile-first базовые стили).

## Проверки (фактически выполненные, Node v24.21.0 / npm 11.19.0 — локальный официальный runtime, системный Node 26 не изменялся)

| Команда | Результат |
| --- | --- |
| до изменений: pwd/toplevel/branch/status/HEAD/log от базы, node/npm | окружение совпало с TASK |
| `npm ci` | exit 0 — воспроизводимая установка по lockfile |
| `npm run lint` | exit 0 |
| `npm run typecheck` | exit 0 (strict) |
| `npm test` | exit 0 — 1 file, 4 tests passed (vitest run, без passWithNoTests) |
| `npm run build` | exit 0 — 8 маршрутов, все статические (`/`, `/icon.svg`, 5 разделов, /_not-found) |
| `npm start` на 127.0.0.1:3107 | Ready; `GET /` → **307 → /today**; все 5 маршрутов → 200; на каждой странице ровно один `<h1>` (Сегодня/Входящие/Предстоящее/Проекты/Настройки), `lang="ru"`; runtime-ошибок в логе нет; сервер остановлен, порт освобождён |
| `npm run test:e2e` (production build + Playwright, порт 3123) | exit 0 — **43 passed**, 0 failed |
| `git diff --check` | чисто |
| `git status --short` после коммитов | чисто |

Сценарии e2e (43): redirect `/` на 4 ширинах; прямой вход + ровно одна видимая активная ссылка с `aria-current` для 5 маршрутов × 360/390/768/1280; обход всех разделов через видимую навигацию на 4 ширинах; отсутствие horizontal overflow на всех маршрутах × 4 ширинах; skip link (Tab → фокус → Enter → `#content` в фокусе); touch targets ≥44×44 (4 ссылки bottom nav + доступ Settings на 360); тема: выбор «Светлая» (мышь) с persist после reload и корректной подписью Select; «Тёмная» с переходом на /inbox и reload; выбор клавиатурой (Enter/ArrowDown/Enter) и Escape с возвратом фокуса; системная тема следует за `prefers-color-scheme` в том числе динамически (emulateMedia dark→light); консоль браузера без ошибок на всех маршрутах; доступ к Settings из mobile header на 360 + persist тёмной темы.

Визуальная evidence (не коммитится): тёмная тема 360/1280 (Today, Settings, открытый Select) — скриншоты через ZCode in-app browser (браузер в dark scheme → режим «Системная»); светлая тема 360/1280 (Today, Settings) — `npx playwright screenshot --color-scheme=light` (файлы в /tmp).

## Дополнительные изменения (вне перечисленного scope)

Нет.

## Не проверено

- Реальное переключение системной темы на уровне ОС (проверено эмуляцией `colorScheme` в Playwright — стандартный способ; живой OS-переключатель не дёргался).
- Реальное touch-устройство/iPhone (вне TASK; 44 px targets и safe-area покрыты тестами/конструкцией).
- Игра radix-Select position="item-aligned" на очень малых высотах вьюпорта не проверялась отдельно (стандартное поведение shadcn).

## Известные проблемы

1. Известный с TASK-001 dev-аудит-риск (braces advisory через eslint-config-next) не менялся — по прямому запрету TASK; production audit не пересчитывался.
2. npm 11.19 (allowScripts) по-прежнему не запускает postinstall `unrs-resolver`/`fsevents`; lint/test/e2e работают (зафиксировано ранее, без изменений).
3. Хук координаторской среды (Mimosa) при коммите сообщил, что полная security-сканирующая процедура проекта не завершена; заявлений о безопасности проекта не делается — вопрос оставлен координатору.
4. В i18n оставлены нейтральные формулировки-заглушки EmptyView; при подключении данных тексты заменятся — вынесено в i18n осознанно.

## Предложения к документам (не менялись)

- DESIGN.md: роль «surface» реализована как shadcn-токен `card` (в CSS оставлен алиас `--surface: var(--card)`); при развитии дизайн-системы выбрать одно имя.
- TASKS/README: e2e-порт конфигурируется `E2E_PORT` (задокументировано в README).

## Git

- Ветка: `task/TASK-002` (назначенная); worktree `/Users/atlhnv/Codex/orbit-worktrees/TASK-002`.
- Стартовый SHA: `586dc4316970d93166a69e727f75baab81fc1380`.
- Коммиты TASK: `93e38ccd08fe90572601b25b9c727c8ae462fddd` (реализация) + отчётный коммит (SHA в файл передачи невозможен — возвращается в ответе пользователю).
- Рабочее дерево после коммитов: чистое; merge/push/amend/rebase/reset не выполнялись; main и другие ветки не изменялись.

## Итог

Реализация передана на независимое review Codex. TASK приёмкой не считается; merge в main не выполнялся; TASK-003 не начинался.
