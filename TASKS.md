# Orbit — очередь MVP

Этап EVERYDAY CORE, 2026-10-12. TASK-001–008 приняты и локально интегрированы после независимого review. Работают auth/settings/Projects, Inbox one-off CRUD, civil planning, Today/Upcoming. TASK-008 DONE, итоговый review reports/TASK-008.md. Выдан только TASK-009A — read API задач проекта; TASK-009–013 — исходные пакеты, а не разрешение реализовать их целиком.
Статусы: TODO → IN_PROGRESS → REVIEW → DONE; NEEDS_FIXES / BLOCKED при необходимости.
Каждый следующий TASK зависит от успешной интеграции предыдущего. Строка очереди не разрешает начать реализацию.

| TASK | Статус | Результат и граница приёмки |
| --- | --- | --- |
| TASK-001 | DONE | Next.js/TS/Tailwind foundation, npm scripts, Vitest smoke, локальный README; без app shell, auth и DB |
| TASK-002 | DONE | shadcn/ui, дизайн-токены, local light/dark/system, desktop sidebar и mobile bottom navigation с пустыми экранами; 360/390/768/1280 px и keyboard smoke |
| TASK-003 | DONE | Локальный PostgreSQL Compose, Drizzle, schema/migrations с owner/FK/check constraints и completion revision; apply на пустую dev DB, без auth flows |
| TASK-004 | DONE | Better Auth login/logout sessions, server signup OFF, локальный bootstrap пользователя, protected server boundary; тесты анонимного доступа и запрета signup |
| TASK-005 | DONE | Настройки timezone/theme, проверка сохранения и существующего sign-out, сохранение после refresh; IANA validation и owner isolation |
| TASK-006 | DONE | Projects create/rename/archive/unarchive, server ownership, исключение архивных данных; tests с двумя пользователями |
| TASK-007 | DONE | Task CRUD, quick-add/Inbox, one-off complete/reopen/soft delete, стабильный порядок; refresh persistence и IDOR tests |
| TASK-008 | DONE | Civil планирование DATE/TIME/deadline, Today/Upcoming, raw API ordering, account timezone labels; R1–R8/final cleanup/auth fixture закрыты. 69 unit/47 DB/124 auth/123 E2E + no-env build PASS, local merge 8ec7068; PG17 и реальные устройства финально не проверены |
| TASK-009 | TODO (пакет) | Project tasks, notes/priority/details/subtasks/move — отдельные малые задания; сейчас выдан только TASK-009A |
| TASK-009A | TODO | Read-only GET /api/v1/projects/[projectId]/tasks: owner/status/order/archive/context, без UI и mutations |
| TASK-010 | TODO | Owner-scoped search по title/notes, loading/error/empty states, shortcuts Q / Esc, rollback ошибок сохранения |
| TASK-011 | TODO | DAILY/WEEKDAYS/WEEKLY и completion history, transaction/revision/idempotency, конкуренция, overdue/Friday/timezone tests |
| TASK-012 | TODO | PWA manifest/icons, онлайн-режим, проверка реальной установки где доступно; без push/offline edits |
| TASK-013 | TODO | Итоговая интеграция и E2E: login → task → schedule → complete → refresh; два пользователя, mobile/desktop, сценарий второго устройства |

MVP считается принятым только после проверки критериев PRODUCT.md. Отдельный этап после MVP и разрешения пользователя: VPS audit, TLS/deployment, backup/restore и 14 дней личного использования. MCP, public signup, calendar sync и collaboration — отдельные будущие предложения.

## Исходный план (сохранённые вехи)
TASK-009–013 в таблице — прежние крупные пакеты результата, а не готовые задания GLM. Перед выдачей их необходимо разбить на небольшие последовательные TASK с одной целью; пользователь запретил огромные задания 2026-10-09. Итоговое число задач до MVP после дробления будет пересчитано, прежние «6 задач» больше не являются актуальным количеством handoff.

Milestone 0 Foundations: TASK-001–005. Milestone 1 Everyday core: TASK-006–010. Milestone 2 Recurrences and polish: TASK-011–013. Milestone 3 Safe personal deployment и Milestone 4 MCP/расширения пока не выданы.
Исходная редакция очереди сохранена в docs/source/TASKS.initial.md; README и доступные команды добавляет GLM в TASK-001.

## Путь до использования на iPhone
После TASK-008 до web/PWA MVP остаются task details/project flows, поиск, recurrence, PWA и итоговая интеграция; прежние пакеты TASK-009–013 будут разбиты на меньшие задания, поэтому точное число handoff пересчитывается. Inbox CRUD и Today/Upcoming уже реализованы; полноценная PWA и итоговая проверка — TASK-012/013. Это браузер/PWA, не native iOS app. Доступ с iPhone вне local Mac требует отдельного этапа TLS/deployment/backup и реальной проверки устройства; он пока не назначен. Нативное iOS/macOS приложение отдельная будущая очередь, её размер/технология ещё не утверждены. Число задач не является оценкой сроков и может измениться по результатам review.

## Ближайшие малые шаги после TASK-008

1. TASK-009A — read API задач проекта (выдано, tasks/TASK-009A.md).
2. TASK-009B — создание root one-off task в собственном активном проекте через API (план, не выдано).
3. TASK-009C — небольшой экран проекта со списком задач (план, не выдано).
4. TASK-009D — quick-add на экране проекта через принятый API (план, не выдано).
Далее отдельные решения для details/notes/priority, assignment/move и subtasks. Scope и порядок уточняются после review; весь пакет GLM не передавать.
