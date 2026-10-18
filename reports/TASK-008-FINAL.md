# TASK-008-FINAL — независимое review

**CLEANUP ACCEPTED; AUTH TEST FIX REQUIRED**, 2026-10-12. Executor HEAD `34998aea9cef6970e52c73d434d1e816db764360`, correction base `645c2161aa3034de8dd044fbfc6f00e2b5789ae1`. Cleanup source review: настоящий try/finally R8 до settings mutation, assertions сохранены; PROBE/R3 DEBUG удалены, trace retain-on-failure, EOF trim без поведения, README исправляет прежние заглушки. Рабочее дерево/correction/cumulative diff --check чистые. Main чистая на `9a81313bb498fd1e584b14a0bc2b87b506102c6b`.

## Сбой auth: подтверждённая причина

Гипотеза executor о том, что Better Auth продлевает уже истёкшую сессию, НЕ подтверждается. Установленная 1.7.7, node_modules/better-auth/dist/api/routes/session.mjs:155, проверяет expiresAt < new Date() и возвращает null/удаляет сессию ДО refresh branch (179–200). Schema auth expires_at — timestamp WITHOUT time zone; Drizzle date mapping интерпретирует его как UTC. Тест пишет now()-1 second, где now() приводится к timestamp в timezone SQL session.

Независимый эксперимент Codex: один и тот же собственный Homebrew PostgreSQL **18.6**, Node **24.21.0**, без изменения продукта/теста. SHOW TimeZone = Europe/Moscow; now()::timestamp - (now() AT TIME ZONE 'UTC') = 03:00:00. При timezone Europe/Moscow `npm run test:auth -- tests/auth/auth-flow.auth.test.ts`: **14/15**, expiry возвращает 200. В том же кластере меняется только собственная конфигурация timezone на UTC, свежая per-run DB: **15/15**, expiry 401. Оба на свежем production build. Это зависимость тестовой SQL fixture от timezone, а не отличие версий PG17/18 и не доказанная ошибка продуктовой авторизации. Для библиотеки ошибочно записанное expiry ещё примерно на 3 часа впереди.

После экспериментов 0 test DB/0 connections; свой PG остановлен, временный кластер/пароль удалены. Colima/CRM/main/hooks не менялись. Test artifacts — только private workspace logs, secrets не выводились.

## Разделение evidence

Executor сообщает полный final проход: lint/typecheck, 69 unit, 47 DB, auth123/124, E2E123/123, no-env build PASS, cleanup0/0. Codex в этом раунде независимо проверил source cleanup, оба diff checks и auth-flow timezone matrix выше; full suites/E2E/no-env build заново НЕ повторял. Ранее независимые R1–R8 проверки сохраняются, но итоговый full auth gate пока красный.

Назначен только tasks/TASK-008-FINAL-EXPIRY.md: test-only исправление auth expiry fixture и повтор full auth, без повторов остальных suites без причины. TASK-008 NEEDS_FIXES, DONE/merge/TASK-009 пока не разрешены.
