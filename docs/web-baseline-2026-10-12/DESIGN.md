# Orbit — Interface specification

## Visual direction
Clean and utilitarian, not a pixel-copy of Todoist. Russian-first. Comfortable spacing, restrained accent color, light/dark color tokens, readable 14–16px body text, 44px minimum touch targets on mobile, visible keyboard focus and high-contrast priority markers. Prefer native, accessible components over custom animations.

## Desktop app shell (>= 960px)

```text
┌──────────────────────┬─────────────────────────────────────────────────────┐
│  ◯ Orbit             │  Сегодня                         Чт, 8 октября   │
│                      │─────────────────────────────────────────────────────│
│  🔎 Поиск      (/)   │  Просрочено (2)                                    │
│  ＋ Новая задача (Q) │  ○ Подготовить отчёт            🔴 P1  Проект     │
│                      │  ○ Сходить в магазин               P3             │
│  📥 Входящие    5    │                                                     │
│  ☀ Сегодня     4    │  Сегодня (2)                                       │
│  ▦ Предстоящее      │  ○ Python: 45 минут                  11:00          │
│                      │  ○ Тренировка                       19:00          │
│  ПРОЕКТЫ            │                                                     │
│  ▪ Университет      │  ＋ Добавить задачу                                 │
│  ▪ Обучение ML      │                                                     │
│  ▪ Личное           │                                                     │
│                      │                                                     │
│  ⚙ Настройки        │                                                     │
└──────────────────────┴─────────────────────────────────────────────────────┘
```

This is a structural wireframe, not a requirement for exact styling or mock task data.

## Mobile app shell (<= 959px)
- Header: view title, search, account menu.
- Scrollable single-column list of tasks with separate overdue/today sections.
- Bottom navigation: Today / Inbox / Upcoming / Projects.
- Fixed, reachable `+` new-task action above bottom navigation.
- Task tap opens full-height sheet; completion checkbox is a separate target (must not open detail).
- Safe-area insets, soft keyboard, sticky quick-add and screen readers tested.

## Core screens
1. **Inbox**: incomplete unscheduled tasks, quick-add at top, actions to schedule or move to project.
2. **Today**: overdue planned items, today's scheduled items, deadline warnings, counts; reorder within sections.
3. **Upcoming**: upcoming day groups, next-7-days default, browse subsequent dates; no drag-and-drop calendar required.
4. **Project**: project name, archive menu, task list with nested subtasks and add action.
5. **Settings**: timezone, theme, sign-out, minimal account details.
6. **Task details** (sheet/dialog): title, notes, project, parent, priority, planned date/time, deadline date, recurrence, complete/delete.
7. **Sign-in**: email/password or chosen secure auth method; no public registration screen during personal beta.

## Interaction requirements
- Fast add: input -> Enter creates a task (empty title blocked). Default: Inbox unless created within a project or Today.
- A task created in Today defaults planned date to today; in a project defaults to the current project.
- Feedback for save, failure, completion, and restore. No silent failures; optimistic updates must roll back on error.
- Keyboard shortcuts: `Q` quick-add, `/` search, `Esc` close modal (when focus is not inside editable text for shortcut triggers).
- Respect reduced-motion preference.

## Responsive breakpoint
A desktop sidebar on wide layouts; on small screens use bottom navigation. Avoid brittle pixel-perfect breakpoints; test at 360, 390, 768, 1280.

## Design system minimum
- Background, surface, muted, border, foreground, accent, danger token roles.
- Task row states: regular, overdue, completed, focused, saving, error.
- Buttons: primary, ghost, destructive; inputs, dialog, date picker, menu, toast, empty-state.
- No Todoist marks, exact iconography or copied proprietary assets.

## INITIAL SETUP clarification
TASK-001: только нейтральная стартовая страница «Orbit» на русском; полноценная навигация и theme — TASK-002. Не изображать работающие task actions или вымышленные списки.
В Today предусмотреть отдельную секцию «Дедлайн сегодня» для несовпадающих planned/deadline dates; не дублировать строки между секциями. Archived projects доступны отдельно от активных. Глубина subtasks — один уровень.

## Уточнения TASK-002
Маршруты /today, /inbox, /upcoming, /projects, /settings; / → /today. Общая оболочка, breakpoint 960 px. Первый app shell содержит реальные nav links и пустые поясняющие экраны, без mock data/counts/search/quick-add. Settings доступен из sidebar и mobile header.
Сдержанный indigo accent, системные шрифты, light/dark tokens; next-themes хранит light/dark/system под orbit-theme локально. Server/account persistence позднее, в TASK-005. Реально используемые shadcn Button/Select, skip link и visible focus. Полный task details/мобильные sheets после data TASK.

TASK-002 принят: surface реализован как alias shadcn card; minimum touch target 44×44 проверяется для theme trigger/options, mobile Orbit/Settings и bottom nav. Реальный дизайн task rows/details появится после data TASK.

## TASK-004: login/logout (реализовано и принято)
/login — самостоятельная русская email/password форма с labels/autocomplete/pending/generic error, без signup/reset/social links и без workspace nav. Theme сохранена; controls >=44 px, 360/390/1280px и keyboard. Settings получает только реальную кнопку Выйти; account preferences/timezone — TASK-005. Five workspace routes после auth guard сохраняют текущие честные data placeholders.


## TASK-005: account preferences (реализовано и принято)
Settings добавляет IANA timezone с label/example, явным сохранением и accessible feedback. Theme selector сохраняет выбор аккаунту и прежние touch/keyboard controls; pending/error видимы, failed optimistic preview откатывается. Defaults UTC/system; timezone не угадывается по browser/IP. DB theme применяется на всех workspace routes и в новом context; при смене аккаунта local theme cache не перезаписывает настройки другого user. Login/local presentation остаётся доступным без preferences query; account section/logout сохраняются. Даты задач пока placeholders, применение timezone к расписанию — следующий этап.

TASK-005 принят: theme save preview с подтверждением/error rollback, timezone explicit save/Enter с disabled input/button при pending. Server account defaults/cache authority и account switch/stale response behaviour проверены; новые controls >=44px, mobile/keyboard regression сохранена. Реальные iPhone/macOS устройства не проверены.


## TASK-006: Projects (реализовано и принято)
/projects становится реальным list/create/rename/archive/restore экраном с «Активные» и «Архив», accessible controls, explicit saving/error/retry, create по Enter и rename cancel/focus return. Project name — текст, без неработающего перехода на task view; sidebar topology не меняется. Архив не означает удаление, task counts/список/quick-add пока отсутствуют. 360/390/1280px, 44px touch controls, long Unicode names, light/dark/system. Pending form исключает double submit/потерю draft; delayed responses после ухода/смены actor не изменяют новый UI, lifecycle эффекты симметричны под StrictMode.

## TASK-007: Inbox (реализовано и принято)
Реальный quick-add title + Enter, открытые/завершённые controls, rows с complete/reopen, rename/cancel/focus-return и delete с явным accessible подтверждением. Server-confirmed responses, pending guards исключают double submit/переключение editor/потерю draft; ошибки и retry видимы, network failures не оставляют зависшее saving. Long Unicode title не обрезается UTF-16 maxlength. 360/390/1280px, ≥44px, keyboard и темы; stale callbacks scoped по lifecycle/actor/editor, StrictMode-safe effects. Только Inbox становится task screen; Today/Upcoming placeholders до TASK-008, dates/details/notes/project/subtask UI не входят.

TASK-007 принят после R1/R2/R3/R3b: сбой GET после подтверждённой записи показывает read error/retry без повторного POST; completion/rename/delete pending блокирует конфликтующие actions. Delete confirmation фокусирует безопасную Отмену; cancel/Escape возвращает trigger, HTTP/network failure возвращает enabled Отмену, successful deletion — quick-add. Browser desktop/mobile/keyboard/Unicode/no-overflow проверены; реальные устройства не проверены.

## TASK-008: Планирование, Today/Upcoming (задание)
Отдельная небольшая форма Планирование: дата выполнения/время/дедлайн, save/cancel, only dirty fields, pending/failure focus и retained draft. Today — overdue plan/на сегодня/overdue deadline/deadline сегодня без дублей, независимые badges, quick-add default server today. Upcoming — seven day groups, prev/next/current controls и range в URL, без нового quick-add/drag-drop. Open/completed controls позволяют reopening scheduled tasks; completed dates нейтральны. Shared existing row actions сохраняются. Один UI write в полёте, stale response guards, read-only retry после confirmed write, safe focus если task исчезла из view; detailed action matrix — TASK. Explicit refresh обновляет server timezone/today, continuous midnight/realtime sync не обещается. 360/390/1280px,44px,keyboard,themes; новые lifecycle effects проверить реальным Next dev.

## TASK-008: планирование (реализовано и принято)

Inbox общий редактор civil DATE/TIME/deadline, видимая server-derived timezone подпись у времени. Today показывает четыре взаимоисключающие plan/deadline секции, Upcoming семь дней и безопасные prev/next/current. Metadata Refresh сохраняет dirty draft; только одно открытое действие, pending записи блокируют конфликтующие controls/mode; stale reads и callbacks не перезаписывают актуальный экран. Frozen snapshot обеспечивает PATCH только dirty fields; cancel/reopen берёт актуальные server values. Mobile/desktop/keyboard проверены синтетическим Chromium, реальные iOS/macOS устройства ещё не проверены.
