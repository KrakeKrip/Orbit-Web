# TASK-008-R5 — границы семидневного окна

**ACCEPTED**, 2026-10-12: a4e8a84f413c56c2a277690e8419671f8ef783f2, reports/TASK-008-R5.md. Следующая выдача tasks/TASK-008-R6.md.

## Одна цель

R5 из reports/TASK-008.md. Исправить допустимые границы календаря Upcoming без исключений/невалидных переходов. R1–R4 приняты на executor HEAD 69371354f13057b1cc4d6de334523029e38860aa, review reports/TASK-008-R4.md. Начать с нового coordinator assignment HEAD; проверить root/branch/status. Ветка task/TASK-008, worktree /Users/atlhnv/Codex/orbit-worktrees/TASK-008.

## Ограниченный scope

src/lib/calendar.ts и src/components/orbit/upcoming-board.tsx; targeted unit additions tests/calendar-view.test.ts и browser additions с R5 labels в planning.spec.ts (либо один маленький новый spec); executor report. Без service/schema/API изменений, общего controller, переработки guards/прочих экранов. R6–R8 и EOF/debug cleanup не трогать.

- civilDateRange не вызывает addCivilDays после последнего возвращаемого элемента. `civilDateRange('2199-12-25',7)` возвращает ровно 25..31 декабря без исключения; дни за пределами supported range всё ещё отвергаются. Прежние контракты других вызовов не расширять без необходимости.
- До navigation проверять ВЕСЬ destination window start..start+6, а не только start. Невозможные prev/next disabled; handler guard не допускает effects/RangeError даже при обходе disabled. URL/state/GET при недопустимой попытке неизменны.
- Не бросать исключение при вычислении доступности кнопок на render. Проверка write/form/listPending по принятой policy выполняется до расчёта нового окна. Current также проходит обычную проверку допустимого окна; нормальная current/prev/next навигация работает.
- Последнее допустимое окно 2199-12-25..31 и первое 1900-01-01..07 отображаются: семь групп, правильные даты, без uncaught/pageErrors. Start2199-12-20 +7 даёт допустимый start2199-12-27, но недопустимый end — переход запрещён. Границы и civil semantics 1900..2199 не менять.

## Целевые проверки

Unit: последняя допустимая семёрка/одноэлементный диапазон на max; реально выходящий за max диапазон отвергается; существующие leap/month/year/DST tests сохраняются.
Browser R5: нижняя граница (prev disabled, bypass URL неизменен), последнее допустимое окно (7 groups/end31, next disabled, bypass безопасен), промежуточный край start2199-12-20 (next запрещён из-за end). После безопасного перехода назад/вперёд normal navigation/reload работают. Own synthetic test DB, без реальных пользовательских задач/clock overrides. Sync по response/expect, без sleeps.

Node24 lint/typecheck; targeted `npm test -- tests/calendar-view.test.ts`; один свежий production E2E targeted R5 + existing Upcoming navigation/write guard cases (например planning.spec.ts и write-guard.spec.ts с --grep 'R5:|Upcoming:|Upcoming: prev'). Full auth/DB/full E2E пока не нужны.

Проверить `node --version` ДО gates: старый /tmp/orbit-node24 исчез. Проверенный временный runtime сейчас /private/tmp/orbit-r4-review-runtime/node-v24.21.0-darwin-arm64/bin; если исчез — восстановить отдельный официальный Node24, не менять системный Node. PG17 на 55432 сейчас недоступен: не запускать Colima/CRM ради тестов. Разрешён отдельный временный local PG с явным guarded TEST_DATABASE_URL, честным указанием версии и обязательным stop/cleanup собственного кластера/пароля. Не печатать credentials.

## Завершение

Подробный отчёт только reports/TASK-008-executor.md, секция R5 (команды/exits/counts/cleanup/ограничения). В чат 4–5 коротких строк: статус, full SHA, итог, targeted checks, путь к отчёту. Новый scoped обычный commit; остановиться до review. R6–R8 не начинать, TASK-008 DONE не объявлять. Без merge/push/amend/rebase/reset/stash/деплоя, main/CRM/localhost3000/hooks changes; secrets не коммитить.
