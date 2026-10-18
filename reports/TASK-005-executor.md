# TASK-005 — отчёт исполнителя (GLM)

## Статус

READY_FOR_REVIEW (после коррекции R1b по повторному review reports/TASK-005.md; R1/R2 закрыты Codex в production и не менялись; старт коррекции R1b `12ac7775c9958db4d5f1cde7e51a47bf1af0b104`).

## Correction R1b (StrictMode effect replay)

Изменён только `src/components/orbit/account-theme-select.tsx` (симметрия lifecycle-эффекта).

Корень: mounted-guard effect содержал один cleanup (`mounted=false`) без восстановления в setup. React StrictMode в `next dev` повторяет setup → cleanup → setup с сохранённым ref — после replay mounted оставался false навсегда, `isCurrentSave()` был всегда false даже для живого компонента текущего actor: успешный PATCH не подтверждался (UI застревал на «Сохранение темы…»), failure-rollback/alert пропускались. Production (next build) эффекты не переигрывает — поэтому 63 E2E оставались зелёными.

Исправление: симметричный effect — каждый setup восстанавливает `mountedRef.current = true`, cleanup ставит false. Actor-проверка (`actorRef` против запрошенного) и подавление stale async completions после ухода/смены пользователя сохранены без изменений; StrictMode не отключался; guard R1 не удалялся.

### Верификация на реальном next dev (StrictMode активен по умолчанию)

Процедура повторяема: уникальная проверенная БД (prepareTestDatabase, namespace orbit_test) + synthetic пользователь (`provisionLocalUser`, credentials через env, не в отчёте) → `DATABASE_URL/BETTER_AUTH_URL/SECRET` этого запуска → `npm run dev -- --port 3238 --hostname 127.0.0.1` → временный untracked playwright-скрипт против живого dev-сервера (удалён после проверки):

- `DEV_READY after 2s`;
- `DEV-SUCCESS: 200 подтверждён, pending сброшен, html.dark после reload` — выбор «Тёмная»: «Тема сохранена» видима, «Сохранение темы…» отсутствует (pending сброшен после replay), persist после reload (server write);
- `DEV-FAILURE: rollback к dark и alert видимы после 500` — route-intercept 500 → rollback к подтверждённой теме + role=alert;
- `DEV CHECK PASS`, exit 0.

Cleanup: dev-сервер остановлен (только слушатель 3238), dev-БД удалена, `next-env.d.ts` возвращён к HEAD-байтам (единственный side effect — dev-пути типов; AGENTS.md не менялся), временные скрипты удалены.

## Проверки после коррекции R1b (Node v24.21.0 / npm 11.19.0)

| Команда | Результат |
| --- | --- |
| `npm run lint` / `npm run typecheck` | exit 0 / exit 0, без warnings |
| `npm test` | exit 0 — 15 passed |
| `npm run test:db` | exit 0 — 47 passed |
| `npm run test:auth` №1 / №2 (последовательно) | exit 0 — **51/51** оба; 0 lifecycle-паттернов |
| `CI=1 E2E_PORT=3239` / `3240` (последовательно) | exit 0 — **63/63** оба; production regressions R1/R2 (delayed A failure после login, уход со Settings, timezone disabled при pending) зелёные; 0 lifecycle-паттернов |
| `npm run build` без `.env` | exit 0 |
| Real `next dev` browser probe | DEV CHECK PASS (см. выше); StrictMode не отключался |
| Leftovers | orbit_test\*-баз: 0; `git diff --check` чист; изменение — один файл компонента |

Известные ограничения — без изменений к предыдущим раундам (реальные устройства/production/reverse proxy не проверялись; timezone не влияет на расписание; limiter single-process; strict ordering конкурентной записи одного поля не asserted). Dev-mode постоянного автоматического regression в gates нет: production E2E StrictMode-переигрывание не воспроизводит; воспроизводимая dev-процедура описана выше и может быть закреплена как отдельный suite по решению Codex.

---

# Предыдущий раунд (исходная реализация)

## Correction R1/R2 (этап NEEDS_FIXES)

Изменены только: `src/components/orbit/account-theme-select.tsx`, `src/components/orbit/timezone-field.tsx`, `src/app/(workspace)/settings/page.tsx` (проброс `actorId`), `tests/e2e/settings.spec.ts` (регрессии). Service/API/schema/persistence/owner isolation не менялись (подтверждены review).

### R1 — lifecycle/actor guard сохранения темы

Корень: `setTheme` из `useTheme()` — глобальный setter переживающего navigation root provider'а next-themes; catch/rollback старого экрана после unmount продолжал действовать и перекрашивал нового пользователя. Исправление: в `AccountThemeSelect` добавлены `mountedRef` (сброс в cleanup) и `actorRef` (текущий `actorId` с сервера, пробрасывается из settings page через `requireUserOrRedirect`); обработка завершения (успех/отказ/catch/rollback/finally/сброс pending) выполняется **только если экран жив и actor — тот же, что отправил запрос**; иначе — ранний return без setTheme/setState. Сам fetch НЕ прерывается (никакого abort на unmount): законная серверная запись прежнего аккаунта завершается, защищается только текущий UI. `actorId` — server-derived значение для клиентского guard'а, источником серверной identity он не является.

Регрессии (settings.spec):
1. **Смена аккаунта + поздний отказ** (переработанный leakage-тест, один sign-in C — бюджет limiter'а прежний): B (server dark) выбирает «Светлая» с удержанным route-intercept PATCH → optimistic light → настоящий logout B → настоящий login C (system, prefers light) → html light, select «Системная», timezone UTC → релиз 500 (доставка доказана `expect.poll`) → html остаётся light, `orbit-theme` ≠ "dark", «Тема сохранена» отсутствует. Без guard'а rollback старого обработчика перекрасил бы C в тёмную (confirmed B) — сценарий воспроизводит repro Codex.
2. **Уход со Settings при pending** (в тесте error-rollback): удержанный 500, выбор «Светлая», переход по «Сегодня» (client navigation, unmount) → релиз → без repaint (html остаётся light), затем reload применяет серверную тёмную и восстанавливает cache. Обычный rollback для текущего actor на экране сохранён прежним тестом (alert + html dark + без «Сохранено»).

### R2 — блокировка timezone-ввода на время pending

`TimezoneField`: Input заблокирован (`disabled={pending}`) вместе с кнопкой — ответ применяется ровно к отправленному значению, новый ввод во время запроса невозможен и не может быть потерян или помечен сохранённым (вариант «disable input при pending» из review). Ошибка по-прежнему оставляет доступный retry draft, Enter/keyboard работают.

Регрессия (новый тест): удержанный route → «Asia/Tokyo» + Enter → **input и кнопка disabled** asserted (кнопка в pending-лейбле «Сохранение…») → релиз 200 `{timezone:"Asia/Tokyo"}` → поле вновь доступно, значение Tokyo, «Часовой пояс сохранён» → далее обычное сохранение «Europe/Moscow» через реальный API (Enter/retry работают).

## Проверки после коррекции (Node v24.21.0 / npm 11.19.0)

| Команда | Результат |
| --- | --- |
| `npm run lint` / `npm run typecheck` | exit 0 / exit 0, без warnings |
| `npm test` | exit 0 — 15 passed |
| `npm run test:db` | exit 0 — 47 passed |
| `npm run test:auth` №1 / №2 (последовательно) | exit 0 — **51/51** оба; 0 lifecycle-паттернов в обоих логах |
| `CI=1 E2E_PORT=3233` / `3234` (последовательно) | exit 0 — **63/63** оба (62 + новая R2-регрессия); 0 lifecycle-паттернов |
| `npm run build` без `.env` | exit 0; /api/v1/settings и workspace маршруты ƒ Dynamic |
| Leftovers | orbit_test\*-баз: 0, соединений: 0; `git diff --check` чист; изменения — ровно 4 файла |

Известные ограничения — без изменений к предыдущему раунду (реальные устройства/production/reverse proxy не проверялись; timezone не влияет на расписание; limiter single-process; strict ordering конкурентной записи одного поля не asserted).

---

# Предыдущий раунд (исходная реализация)

## Исходное состояние (проверено до изменений)

- Worktree `/Users/atlhnv/Codex/orbit-worktrees/TASK-005`; ветка `task/TASK-005`; дерево чистое.
- База review `738dbec9a333147484284d63e3e51a4c5cde0312` (принятый TASK-004); **стартовый полный SHA: `d5c949249a359616f5d4fd78fea8b852f2e13b4f`** (assignment-коммит координатора, единственный коммит над базой).
- Node v24.21.0 / npm 11.19.0; Docker PostgreSQL Orbit healthy на 127.0.0.1:55432; localhost:3000, CRM, main не затрагивались.
- Local `.env` подготовлен из значений `.env.example`/рабочего окружения (тот же Orbit PostgreSQL; секрет сгенерирован на месте): untracked, `git check-ignore` подтверждён; значения не выводились и не коммитились. `npm ci` exit 0, lockfile не менялся (новых зависимостей нет — Intl/ имеющийся стек).

## Реализовано

### 1. Pure contracts — `src/lib/settings.ts` (новый)
`SETTINGS_THEME_VALUES` (light/dark/system), `DEFAULT_SETTINGS` (UTC/system), `resolveCanonicalTimezone` (trim; ≤100 chars; явное отсечение offset-подобных форм `^UTC±/^GMT±/^\d`, которые Intl в Node 24 иначе ПРИНИМАЕТ — проверено эмпирически; валидация через `Intl.DateTimeFormat` + `resolvedOptions().timeZone` — канонизация aliases; `UTC` принимается, хотя отсутствует в `Intl.supportedValuesOf('timeZone')`), `parseSettingsPatch` (строгий разбор: непустой plain object, только timezone/theme, типы, без raw input в ошибке).

### 2. Service — `src/server/settings/service.ts` (новый, server-only)
`getAccountSettings(actorId)`: SELECT строго `WHERE user_id = actor.id`; отсутствующая строка → defaults **без INSERT** (settings row не создаётся чтением и не добавлена в signup/bootstrap). `updateAccountSettings(actorId, patch)`: один атомарный `INSERT … ON CONFLICT (user_id) DO UPDATE`, set включает **только переданные поля** + явный `updatedAt`; при отсутствии строки создаёт её с defaults для остальных полей; `created_at` сохраняется. Конкурентные обновления разных полей сохраняют оба; одного поля — завершившийся последним. Никакого cross-request cache; ошибки сервиса не подменяются defaults.

### 3. HTTP — `src/app/api/v1/settings/route.ts` (новый)
GET: query → 400; 200 `{settings:{timezone,theme}}` из service. PATCH, задокументированный порядок проверок (покрыт тестами): transport (Content-Type ≠ application/json → 415; размер — pre-check Content-Length И потоковое чтение с лимитом 2 KiB → 413; malformed JSON → 400) → `requireUser` (401) → Origin (403) → валидация полей (400 `VALIDATION_ERROR` + опциональное `field`) → mutation. Origin-защита — **точное** сравнение с configured `BETTER_AUTH_URL` origin (`readAuthBaseOrigin`, новый export в `src/server/auth/env.ts`); missing/`null`/hostile → 403; Host/X-Forwarded-* не читаются. Session до mutation: анонимный вызов не создаёт row. Все ответы, включая ошибки: `Cache-Control: private, no-store`; тела ошибок без email/tokens/stack/SQL.

### 4. UI / account theme
- `(workspace)/layout.tsx`: `requireUserOrRedirect` + `getAccountSettings` → клиентский мост `AccountThemeSync` (`src/components/orbit/account-theme-sync.tsx`, новый) применяет server theme на всех пяти маршрутах; **setTheme берётся из ref, эффект — только по изменению серверного пропа**: `setTheme` в next-themes пересоздаётся при каждом изменении темы (useCallback по значению — проверено по исходникам), наивный `[theme, setTheme]` депс перезаписывал свежий локальный выбор (найдено прогоном, исправлено). Мост не отправляет PATCH.
- `settings/page.tsx`: server-side загрузка настроек; `AccountThemeSelect` (новый): optimistic preview + PATCH, pending guard (без гонок собственных сохранений), подтверждение только после 200, при ошибке — откат к последней подтверждённой account theme и видимая ошибка; значение Select — из серверного состояния аккаунта (не из localStorage: чужой cache не отображается и не сохраняется). `TimezoneField` (новый): label + IANA-пример + явное сохранение (кнопка/Enter), локальная pure-проверка с понятным сообщением, server 400 → invalid-подсказка, сетевая ошибка → draft сохраняется для retry, «Сохранено» только после server success. Login/root layout настройки не читают.
- `src/lib/i18n/ru.ts`: все новые строки; описание Settings/theme hint обновлены честно (timezone будет использоваться следующими этапами).

### 5. Тесты
- **Pure** `tests/settings-validation.test.ts` (11): UTC/зоны/aliases/канонизация, offset/неизвестные/длина/типы, строгий PATCH parse, defaults. Suite `npm test`: 4 UI + 11 pure = **15**.
- **Integration** `tests/auth/settings.auth.test.ts` (20): defaults без INSERT (и повторно), all-answers no-store, query 400, anonymous/tampered/revoked 401 без мутаций (плюс документированный порядок: аноним+hostile → 401, не 403), 17 невалидных payload'ов → 400 + row не создаётся, создание theme-only/timezone-only, сохранение created_at + рост updated_at, канонизация на сервере, идемпотентный повтор (ровно 1 строка), конкурентные разные поля → оба изменения, конкурентное одно поле → last-completed-wins, hostile/`null`/missing Origin → 403 без мутаций, точный Origin → 200, 415/413/query-400, actor isolation U/V + прямой чужой `user_id` в body отвергается.
  Фикстуры: отдельные синтетические U/V этого запуска (не общие A/B); сессии минтируются **server-side через поддерживаемый API** — новый export `signInLocalUser` в `src/server/auth/bootstrap-core.ts` (sign-in endpoint, тот же секрет запуска, без собственного session protocol): HTTP sign-in limiter (10/60s) намеренно исчерпывается auth-flow, а порядок vitest-файлов по размеру недетерминирован — fixtures не конкурируют за production bucket; сама лимитер-защита не ослаблена и по-прежнему тестируется HTTP-сценариями.
  Адаптация принятого auth-flow (разрешена TASK как fixtures-изоляция): счётчик сессий в тесте «rejected signup не создаёт строк» скоуплен на собственный fixture email вместо глобального count по таблице (соседние suite создают легитимные сессии своих пользователей; намерение теста сохранено).
- **E2E**: `tests/e2e/settings.spec.ts` (новый, 5): timezone невалид/валид/refresh; тема → серверная истина после `localStorage.clear()` + reload; server failure через route-intercept → rollback темы без ложного «Сохранено», timezone draft переживает ошибку и retry успешен; mobile 360 (header → settings, keyboard Enter, reload); **смена аккаунта** в одном контексте: B (dark) → logout → login C → применяется system/UTC C, а не локальный dark-cache прежнего пользователя (9-й sign-in за прогон — в бюджете limiter'а 10/60s).
  Изоляция owner'ов: settings.spec — пользователь B (+C через UI), сериализован `describe.configure({mode:"default"})`; theme.spec — пользователь A, сериализован; **мутирующие keyboard-тесты из navigation.spec (360/390) перенесены в theme.spec** (детерминированное предусловие мышью, прежние assertions сохранены) — в navigation.spec остались немутирующие измерения touch targets. keyboard-тесты дополнены мышиным предусловием также из-за гонки «фокус+Enter до гидрации» (найдено флейком). auth.setup сохраняет storageState B (+1 тест). `tests/e2e/credentials.ts` + `scripts/e2e-server.ts`: синтетический пользователь C. Итог E2E: **62** (56 прежних с сохранёнными assertions + настройки).

## Проверки (фактические)

| Команда | Результат |
| --- | --- |
| `npm ci` | exit 0, lockfile неизменен |
| `npm run lint` / `npm run typecheck` | exit 0 / exit 0 (strict), без warnings |
| `npm test` | exit 0 — **15 passed** (4 UI + 11 pure) |
| `npm run test:db` | exit 0 — **47 passed** (без изменений схемы) |
| `npm run test:auth` №1 / №2 (последовательно) | exit 0 — **51/51** оба (31 прежних + 20 settings); 0 совпадений `idle client error`/`terminating connection`/`57P01`/`uncaughtException` в обоих логах |
| `CI=1 E2E_PORT=3227` / `3228` (последовательно) | exit 0 — **62/62** оба; 0 lifecycle-паттернов; [WebServer] только ожидаемые WARN «Invalid password» из сценария ошибки входа |
| `npm run build` без `.env` (env переносился и возвращён) | exit 0; ƒ Dynamic: /api/auth/[...all], /api/v1/me, **/api/v1/settings**, /inbox, /login, /projects, /settings, /today, /upcoming; ○ Static: /, /_not-found, /icon.svg |
| Leftovers после всех прогонов | orbit_test\*-баз: **0**, соединений: 0; слушателей на e2e-портах нет; маркер/completion потреблены; test-results/.auth — только gitignored storageState A/B |
| `git diff --check` / `git status` | чисто |

Инцидент честно: один ручной запуск `npm run test:e2e` **без CI** (19:05, выполнен ошибочно в цепочке команд, вывод в /dev/null) оставил свою базу по задокументированной reuse-политике вне CI (живой сервер-владелец не сигналится); сервер позже завершился без зачистки. База удалена вручную (своя orbit_test\*, 0 соединений). Поведение воспроизведено и проверено диагностическим экспериментом: **падающие CI-прогоны зачищают свои базы полностью** (failing-run эксперимент с временным spec: новый leftover не появился), принятые gates оставляют 0 leftovers.

## Решения в рамках TASK (для сведения Codex)

1. **Порядок проверок PATCH**: parsing → auth → origin → validation → mutation (задокументирован в route.ts и зафиксирован тестами, включая «аноним + hostile Origin → 401»).
2. **signInLocalUser в bootstrap-core** — fixture-сессии мимо HTTP-лимитера (обоснование выше); HTTP-сценарии лимитера не тронуты.
3. **Скоупинг session-count в auth-flow** — изоляция fixtures без ослабления намерения теста.
4. **Перенос keyboard-тестов выбора темы** из navigation.spec в theme.spec + сериализация theme/settings specs по владельцам — прямая реализация требования «parallel theme scenarios изолированы по owner/fixture».
5. **Origin-проверка** — точное сравнение origins через `new URL(...).origin` с expected из `readAuthBaseOrigin` (единый источник истины с auth-конфигом).
6. Лимит PATCH body 2 KiB (пример из TASK), enforce при потоковом чтении с TextDecoder({stream:true}).

## Известные ограничения / не проверено

- Real iPhone/macOS устройства и production deployment не проверялись; Origin-политика за reverse proxy (TLS-терминация, forwarded заголовки) — предмет deployment-этапа.
- Timezone сейчас только сохраняется/канонизируется: Today/Upcoming/recurrence её пока не используют — UI явно сообщает об этом; browser locale/IP не анализируются.
- Конкурентная запись одного поля проверяется как «итог ∈ переданных значений» (строгий порядок завершения не asserted); revision/ETag не требуются по TASK.
- Sign-in limiter остаётся single-process memory (принято в TASK-004); durable/distributed защита — до deployment.
- Theme flash при первом рендере после login (локальный cache → server value на mount) допустим по TASK; подтверждённое значение другого actor не отображается в контролах и не сохраняется.
- `Intl`-канонизация зависит от ICU runtime (aliases могут резолвиться по-разному на других системах); тесты не зависят от конкретного alias-результата.
- npm audit не пересчитывался (новых зависимостей нет); прежние tooling-ограничения TASK-003/004 действуют.

## Git

- Ветка `task/TASK-005`, worktree `/Users/atlhnv/Codex/orbit-worktrees/TASK-005`.
- Стартовый SHA `d5c949249a359616f5d4fd78fea8b852f2e13b4f`; реализация — обычные новые коммиты поверх assignment; latest full SHA сообщён после commit (в файл не вписывался).
- Merge/push/amend/rebase/reset/stash не выполнялись; main, другие worktree, localhost:3000, CRM, coordination docs не менялись; secrets только в untracked `.env`.

## Итог

TASK-005 реализован по scope (timezone/theme persistence, защищённый GET/PATCH /api/v1/settings, Settings UI + account theme sync). TASK приёмкой не считается; остановка до независимого review Codex; TASK-006 не начинался.
