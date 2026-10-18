# TASK-008-R8 — независимое review

**PRODUCT FIX ACCEPTED; FINAL TEST CLEANUP REQUIRED**, 2026-10-12. Executor HEAD `01ac0cea9dd44de1bd33b5f69daf737ce30c83ca`, correction base `beab5af8904748b00e21016ca003af60232eddca`. 11 files: timezone props/label, browser regression, executor report и необходимая адаптация двух unit-render calls к обязательному timezone prop. Последнее выходит за перечисленный test scope, но необходимо для typecheck и не меняет assertions.

Timezone только из существующего server context: SSR Inbox → refresh open context → общий row/editor; Today/Upcoming используют свои context.timezone. Под TIME видимая подпись, input aria-describedby с уникальным id. Frozen snapshot/dirty calculation не меняются, metadata refresh не remount editor; DATE/TIME не конвертируются. Latest/mounted/actor read guards сохранены. Продуктовых блокирующих замечаний не найдено.

## Остаток для финального прохода

tests/e2e/planning.spec.ts, R8 scenario: восстановление timezone находится после assertions, без try/finally. Комментарий «finally-семантика» этого не исправляет. При ошибке после первого PATCH зона остаётся Asia/Tokyo/Moscow для остальных tests. Требование задания — настоящий finally: охватить его блоком до первой мутации settings, в finally восстановить исходную зону, assert200 + GET confirmation. Assertions не ослаблять. Это test cleanup, объединён с прежним EOF/debug cleanup в tasks/TASK-008-FINAL.md; отдельная продуктовая коррекция R8 не нужна.

## Независимые gates Codex

Node **24.21.0**, свой временный PostgreSQL **18.6**, guarded TEST_DATABASE_URL/loopback/собственный кластер/эфемерный пароль. PG17 недоступен; Colima/CRM не запускались.

- lint exit 0, 0 warnings; typecheck exit 0.
- npm test: **69/69**, exit 0.
- Свежий production build PASS.
- CI=1 E2E_PORT=3469 npm run test:e2e -- tests/e2e/planning.spec.ts tests/e2e/write-guard.spec.ts --project=chromium --grep 'R8:|snapshot|schedule': **14/14**, exit 0 (3 auth setup + R8 + R1 snapshot/schedule guard cases).

После тестов 0 тестовых БД/0 соединений; собственный PG остановлен, кластер/пароль удалены. Correction diff --check чист; cumulative diff от 394aef4 показывает только прежние EOF task-row.tsx/tasks-planning.auth.test.ts. Main чистая на `9a81313bb498fd1e584b14a0bc2b87b506102c6b`; merge/push/deploy отсутствуют. Full auth/DB/E2E/no-env build/dev и устройства не проверялись в этом раунде.

Все продуктовые R1–R8 закрыты; TASK-008 всё ещё NEEDS_FIXES до финальной уборки, full gates и независимой приёмки. TASK-009 не назначен.
