# TASK-008-FINAL-EXPIRY — auth fixture без зависимости от SQL timezone

**ACCEPTED**, 2026-10-12: 237f711018efdb8d299428f5390a6e870096afe5, reports/TASK-008-FINAL-EXPIRY.md. Все findings закрыты; следующий шаг — локальная интеграция координатором.

## Одна цель / старт

Исправить только expiry-тест из auth-flow: expires_at должен действительно быть в прошлом для Better Auth при SQL timezone UTC И Europe/Moscow. Cleanup FINAL принят на 34998aea9cef6970e52c73d434d1e816db764360; причина и независимая matrix — reports/TASK-008-FINAL.md. Начать с нового coordinator assignment HEAD, записать полный SHA, проверить root/branch/status. task/TASK-008, /Users/atlhnv/Codex/orbit-worktrees/TASK-008.

## Scope: два файла

Только tests/auth/auth-flow.auth.test.ts (два UPDATE expiry в существующем сценарии и необходимые проверки) и reports/TASK-008-executor.md (секция FINAL-EXPIRY). Не менять src/auth config/Better Auth options/cache/refresh/limiter/schema/migrations/runner. Не отключать refresh, не маскировать отказ ожидаемым200, не превращать тест в revoke вместо expiry, не менять чужие среды.

Установленный auth timestamp expires_at WITHOUT time zone хранит UTC wall-clock representation. now()-1 second через implicit cast пишет локальные часы SQL timezone; Moscow превращается в ещё действительную future expiry при чтении UTC. Better Auth сначала проверяет expiry, только затем refresh — версия PG причиной не является.

Записать expiry явно в UTC, например параметризованным UTC ISO timestamp, рассчитанным от JS времени и заведомо в прошлом (достаточный разумный запас вместо хрупкой 1 секунды), либо SQL expression с явным AT TIME ZONE UTC. Вставка исключительно в synthetic fixture sessions собственного actor/текущего теста. Параметры, не интерполяция данных в SQL. Проверить фактически затронутые rows и возвращённый expires_at, интерпретированный как UTC, < времени проверки в Node. До экспирации me200, после — me401, cookieCache off и контракт preserved. Не печатать cookie/token/credentials.

Доказать независимость от timezone: исходный test должен проходить на own temporary server Europe/Moscow и UTC, с отдельной per-run DB. Разрешён SET LOCAL TimeZone в своей test connection/transaction для записи fixture; глобальную timezone рабочего сервера не менять. Если используешь matrix через временный кластер — меняй только свою конфигурацию и честно зафиксируй версии. Не добавлять отдельный большой fixture framework.

## Соразмерные gates

Node24 (/private/tmp/orbit-r4-review-runtime/node-v24.21.0-darwin-arm64/bin), lint0 warnings/typecheck, targeted auth-flow на UTC/Moscow, затем один full npm run test:auth на non-UTC own target (либо эквивалентная доказанная non-UTC fixture write). Build свежий; если неизменённый свежий build переиспользуется для Vitest — явно указать это, штатные safety guards сохранить. Можно зачесть full auth как один из запусков matrix, чтобы не повторять файл отдельно без необходимости.

Остальные unit/DB/E2E/no-env build не повторять: test-only correction, final evidence 34998ae сохраняется с честной пометкой прошлого SHA. Если новая причина требует расширения — сначала точное evidence, не исправлять продукт вне scope. Full auth logs проверить на lifecycle errors; cleanup test DB/connections0/0.

PG17 если доступен. Если закрыт — own guarded temporary PG18 разрешён; Colima/CRM не запускать. Только loopback/свой кластер/эфемерный пароль/TEST_DATABASE_URL orbit_test namespace. Stop/cleanup собственных ресурсов обязательны. Никаких print URI/secrets, main/localhost3000/CRM/VPN/hooks изменений.

## Завершение

Обычный scoped новый commit, correction и cumulative git diff --check чистые. В отчёт добавить уточнение причины: прежний диагноз «refresh истёкшей сессии/PG18 отличие» был ошибочным; evidence показывает SQL timezone fixture. Точные commands/exits/counts/UTC-Moscow matrix/cleanup, full auth gate и ограничения. В чат 4–5 коротких строк: READY_FOR_REVIEW/честный статус, full SHA, итог, counts, путь файла. Не присваивать DONE/не merge/push/amend/rebase/reset/stash/deploy, TASK-009 не начинать; остановиться до review Codex.
