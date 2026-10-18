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
