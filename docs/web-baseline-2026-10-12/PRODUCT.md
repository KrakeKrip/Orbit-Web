# Orbit — Product Requirements (MVP 1.0)

Status: draft for implementation, 2026-10-08.
Product type: personal task manager, designed for future multi-user use.
Initial user: owner only; public sign-up OFF by default.
Primary platforms: desktop browser, iPhone browser/home-screen PWA, Mac and Windows/Linux browsers.
Language: Russian-first; UI strings centralized for potential localization.

## 1. Product principle
A fast, reliable app that answers: What should I do today? What is due soon? What is overdue? It must remain fully useful without AI.

## 2. MVP scope (must have)
- Account sign-in and sign-out. Provision the first account securely, without leaving public registration open. No anonymous task access.
- Inbox: tasks without a planned date and optionally without a project.
- Today: overdue tasks first, then tasks planned for today; show upcoming hard deadlines as a distinct indication. A task scheduled today is not necessarily due today.
- Upcoming: list tasks grouped by day for the next 7 days; allow navigation farther ahead.
- Projects: create, rename, archive projects; each contains tasks and subtasks.
- Tasks: quick-add, edit, complete, reopen, delete with confirmation/undo when feasible.
- Task fields: title (required), notes (optional), project (optional), parent task (optional), priority P1–P4 (default P4), planned date (optional), optional planned time, deadline date (optional), completion status, stable manual ordering.
- Recurrence: daily, weekdays and weekly at minimum. On completion, record the occurrence and advance to the next appropriate planned date; never silently erase completion history.
- Full data persistence in PostgreSQL, responsive UI, keyboard access and light/dark themes.
- PWA manifest, icons, home-screen install. Online connectivity required for data access/editing in MVP; do not claim offline task editing.
- Task search by title and notes (basic, owner-scoped).

## 3. Deliberately out of scope
- MCP/ChatGPT integration; AI planning, natural-language task parsing.
- Team collaboration, shared projects, invitations, public registration UI.
- Native iOS/Android apps; push notifications; calendar sync; real-time multi-device collaboration; file attachments.
- Kanban, advanced statistics, time tracking, complex calendar time blocking, elaborate recurrence patterns.

## 4. Behavioral rules
- `planned_date`: date chosen for doing the work, used for Today/Upcoming. `deadline_date`: absolute due date, separately shown and never overwritten by moving the planned date.
- Default Inbox filter: incomplete tasks with no planned date. Overdue tasks are unfinished tasks whose planned date is before the current user-local date; hard deadlines are indicated separately.
- Today view: overdue planned tasks + tasks planned for today; tasks whose deadline is today but which are planned later should receive a deadline warning, not silently change their plan.
- Completing one-off task marks it completed and records completion. Reopening returns it to incomplete.
- Completing a recurring task records occurrence with its previous planned date, then moves series to next valid date in the user's timezone; future dates must be deterministic across retries. Completing a recurrence must be idempotent (double clicks/API retries do not skip occurrences).
- A recurring task should have a planned date. Recurrence applies only to planned date, not to deadline; disallow a recurring task with a hard deadline in MVP or clearly explain conflict in UI.
- Subtasks may belong only to the same user's task and project; cycles forbidden. Completing a parent task does not automatically complete its subtasks in MVP.
- Task and project queries/mutations always use the authenticated user identity and verify ownership, never trust a `user_id` received from the browser.
- User's timezone is saved per account; date calculations must be timezone-aware.
- New tasks should be creatable with a single input, without forcing a project or deadline.

## 5. Priority conventions
P1 urgent (strong accent), P2 high, P3 medium, P4 normal. Priority affects sorting when explicitly selected, not through undisclosed auto-rescheduling.

## 6. Acceptance criteria
1. Owner can log in, create a task via quick-add in under three deliberate interactions, and see it in Inbox or Today as appropriate.
2. Changes persist after page refresh and can be seen after logging in on another device.
3. Planned date and hard deadline can differ, and Today/Upcoming render them correctly.
4. Tasks can be assigned to projects and subtasks, edited, completed and reopened.
5. Recurrence daily/weekdays/weekly passes edge-case tests (weekend, overdue completion, duplicate submission, timezone boundary).
6. A user cannot read/change another user's tasks or projects, including by guessed IDs and nested associations.
7. Mobile UI works at 360 px wide; desktop works at 1280 px wide; no horizontal overflow.
8. Public signup is disabled in production; the first user can be provisioned by a documented one-time admin/bootstrap procedure.
9. PWA can be installed where supported, but offline mutation is explicitly unsupported.
10. `lint`, `typecheck`, `test`, `build` pass and instructions exist in README.

## 7. Success measure
Use as primary personal task list for 14 consecutive days with no critical bugs or loss of data. Record friction points before adding features.

## 8. Уточнения координации INITIAL SETUP
- Документ описывает целевое MVP; функциональность пока не реализована.
- Вложенность подзадач в MVP — один уровень. Родитель не является подзадачей; перемещение родителя в другой проект атомарно переносит его дочерние задачи.
- Архивация проекта сохраняет его задачи. По умолчанию архивный проект и его задачи исключены из рабочих Inbox/Today/Upcoming/search; просмотр архива остаётся доступен. Разархивация возвращает их в рабочие списки.
- Удаление задачи — soft delete. Удаление родителя атомарно скрывает его подзадачи; восстановление удалённых задач и undo завершения повторения не входят в обязательный MVP.
- planned_time допустим только вместе с planned_date. Настройки timezone проверяются как IANA timezone.
- Если сегодня дедлайн задачи, запланированной на другой день или без даты, Today показывает отдельную секцию «Дедлайн сегодня», без изменения planned_date и без повторного вывода одной задачи в нескольких секциях.

## 9. Уточнение платформ пользователем
С первого релиза офлайн не требуется. После веб/PWA планируются отдельные приложения под iOS и macOS; возможен Telegram-клиент. Все используют общий аккаунт и серверные данные. Тип Telegram-клиента, технологии native UI, сроки и функциональные границы пока не определены; они не расширяют текущий web MVP и TASK-001.


## Уточнение account preferences для TASK-005
Настройки аккаунта: timezone (именованная IANA zone или UTC) и theme light/dark/system. Defaults нового аккаунта — UTC/system, пока пользователь явно не сохранит другое. Настройки сохраняются в PostgreSQL и доступны после refresh/нового входа на другом browser context. Browser local theme — визуальный cache, при авторизации настройки аккаунта имеют приоритет; изменение одного поля не сбрасывает другое. Ошибка сохранения видима и не считается успешной записью. Timezone расчёты Today/Upcoming/recurrence реализуются в соответствующих последующих TASK.


## Уточнение projects для TASK-006
Создание/переименование/архивирование/восстановление собственных проектов. Архив сохраняет проект и связанные задачи; активные и архивные проекты показываются отдельно, default list только active. Повторяющиеся названия разрешены, trim и максимум 120 Unicode code points. Rename доступен также в архиве; повтор archive сохраняет дату архива, restore не меняет id/name/order. Удаление/ручная сортировка/sharing и список задач внутри проекта не входят в TASK-006; task data/queries — следующие этапы.

TASK-006 принят и локально интегрирован: /projects показывает собственные активные/архивные проекты, поддерживает создание, переименование и archive/restore. Основной task CRUD пока отсутствует; следующий пункт очереди TASK-007. Работа на реальном iPhone и production ещё не проверена.

## Уточнение Inbox / one-off tasks для TASK-007 (реализовано и принято)
Quick-add во Входящие создаёт корневую one-off задачу только с заголовком, без проекта/дат, P4. Заголовок trim, 1–500 Unicode code points; имена с markup отображаются текстом. В Inbox открытые/завершённые задачи без planned_date, только свои non-deleted roots из неархивных проектов или без проекта. Завершение атомарно сохраняет task state и журнал; повтор не дублирует запись, reopen сохраняет прошлый журнал. Удаление с подтверждением — soft delete, parent и его direct children скрываются атомарно; undo не обязателен. Title editing/complete/reopen/delete — текущий subset; dates/schedule идут в TASK-008, notes/priority/project assignment/subtasks/details в TASK-009, recurrence в TASK-011. TASK-007 принят после независимого review и локальной интеграции.

Текущее проверенное состояние: Inbox поддерживает реальные one-off задачи create/rename/complete/reopen/soft delete с persistence и журналом завершений. Today/Upcoming/date editing ещё не реализованы (следующий TASK-008), прочие расширенные поля и project/subtask UI позже. Main integration regression PASS; реальные iPhone/macOS устройства/production не проверены.

## Уточнение planning для TASK-008 (задание)
Плановая DATE и deadline DATE независимы, supported Gregorian range 1900-01-01..2199-12-31; optional plannedTime HH:mm требует plannedDate, clearing plan clears time, deadline сохраняется. Task timezone берётся из account settings (default UTC), дата сегодня считается сервером из одного reference instant; timezone change не переписывает сохранённые date/time values. Today default open включает overdue/today plans и независимые overdue/today deadlines, один ID в одной секции; выполненные task dates нейтральны. Upcoming — planned-date groups за 7 дней включительно, browse далее; deadline badge не переносит task в другую группу. Schedule editor и Today quick-add входят, notes/priority/project/subtasks/recurrence позже. Задание не подтверждает реализацию; детали API, UI state matrix и acceptance — tasks/TASK-008.md.
