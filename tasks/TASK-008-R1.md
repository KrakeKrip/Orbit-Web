# TASK-008-R1 — snapshot планировочного редактора

## Назначение

Статус: **ACCEPTED (только R1)** после независимого review executor SHA `3b3688ad66845dc80216105bb20d85375293592e`; reports/TASK-008-R1.md. Это задание завершено; следующая выдача tasks/TASK-008-R2a.md.

Одна небольшая коррекция по независимому review `reports/TASK-008.md`, **только R1 [P1]**. Другие пункты review в этом запуске не исправлять.

Worktree `/Users/atlhnv/Codex/orbit-worktrees/TASK-008`, ветка `task/TASK-008`. Проверенная реализация `6388a088a13d657e236d4120ff094586c8317186`; старт correction — текущий coordinator review commit, проверить `git rev-parse HEAD`. Прочитать AGENTS.md, исходный tasks/TASK-008.md и R1 в review. Не начинать TASK-009.

## Дефект

Editor сравнивает локальный draft с меняющимся snapshot prop. Если второй клиент записал deadline и первый сделал refresh с открытым editor, его Save неожиданно отправляет `deadlineDate:null` и стирает чужую запись, хотя первый редактировал только plannedDate.

## Scope

Основной файл `src/components/orbit/task-schedule-editor.tsx`; при доказанной необходимости минимальная правка `task-row.tsx`. Browser regression в `tests/e2e/planning.spec.ts` или отдельном маленьком planning-editor spec; обновить `reports/TASK-008-executor.md` отдельной секцией коррекции R1. Не менять service/API/schema/owner guards/clock/other controllers/coordination docs. Не заниматься R2–R8 или общей уборкой кода в этой коррекции.

## Требуемый результат

- Snapshot конкретного открытия редактора неизменен до закрытия. Dirty/PATCH keys отражают изменения пользователя относительно этого snapshot.
- Refresh при открытом dirty editor не добавляет в PATCH чужие изменённые deadline/time поля и не теряет draft.
- После Cancel и нового открытия snapshot берётся заново из актуального task; rejected save сохраняет текущий draft.
- Явная очистка plannedDate по-прежнему очищает time; действительно изменённые date/time/deadline можно сохранять. No-op не отправляет PATCH. Публичные API контракты не меняются.

## Детерминированная browser-регрессия

1. Своя synthetic task: plan/time/deadline NULL.
2. Открыть editor, изменить только plannedDate на future day от server context.
3. Второй клиент через authenticated API с правильным Origin сохраняет deadline=D.
4. Нажать «Обновить» первого экрана, дождаться actual GET completion; editor остаётся открытым с draft.
5. Save: перехватить тело **настоящего** PATCH, который затем проходит в сеть. Assert plannedDate присутствует, deadlineDate/time отсутствуют, deadline=D сохраняется в GET item/DB после записи.
6. Проверить Cancel/new open snapshot и существующий failed-save/retry/clear-plan flow. По возможности симметричный сценарий independent time при редактировании только deadline.

Не увеличивать sleeps/timeouts вместо синхронизации и не ослаблять assertions. Использовать только текущий guarded runner/свою unique test DB, Node24, отдельный свободный loopback port и CI=1.

## Проверки и handoff

`npm run lint`, `npm run typecheck`, `npm test`; targeted browser новые R1-regressions + прежний planning editor save/failure/clear сценарий (штатный production build). Полный auth/E2E повторять в этой коррекции не требуется: R6 — уже известный отдельный auth test failure, он остаётся открытым до своего задания. Не выдавать весь TASK-008 за принятый по целевому прогону.

Обычный новый commit только scoped files/report; cumulative `git diff --check` проверить честно (старые EOF замечания относятся к отдельной финальной уборке, в R1 чужие файлы не править). Вернуть full SHA, файлы, команды/exit/counts и ограничения; остановиться до review R1. Без merge/push/amend/rebase/reset/stash/деплоя, без main/CRM/localhost3000/других worktree/настроек hooks. Secrets/storageState не коммитить.
