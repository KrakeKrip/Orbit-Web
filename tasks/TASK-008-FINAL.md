# TASK-008-FINAL — финальная уборка и gates

**CLEANUP ACCEPTED**, 2026-10-12: 34998aea9cef6970e52c73d434d1e816db764360; full auth gate NEEDS_FIXES из-за SQL timezone fixture, reports/TASK-008-FINAL.md. Следующее задание tasks/TASK-008-FINAL-EXPIRY.md.

## Старт и одна цель

Продуктовые R1–R8 приняты, последняя реализация 01ac0cea9dd44de1bd33b5f69daf737ce30c83ca; reports/TASK-008-R8.md оставляет только test cleanup. Начать с нового coordinator assignment HEAD; записать SHA, проверить root/branch/status. task/TASK-008, /Users/atlhnv/Codex/orbit-worktrees/TASK-008. Цель — небольшая уборка и один полный проверочный проход; новые функции не реализовывать.

## Разрешённые изменения

1. tests/e2e/planning.spec.ts, только новый R8 test: реальный try/finally ДО первой settings mutation. В finally восстановление захваченной initialZone с Origin/assert200/GET confirmation; работает и при упавшем assertion. Удалить ложный комментарий finally-семантика. Прежние проверки подписи/draft/PATCH/GET сохранить. Не добавлять новую suite ради проверки синтаксического исправления.
2. tests/e2e/inbox.spec.ts: удалить временные PROBE console listeners/console.log и отладочные остатки, не assertions/response synchronization/регрессии.
3. playwright.config.ts: убрать временные trace:'on' overrides из projects, общий trace вернуть к 'retain-on-failure' (или исходной принятой policy, проверить base). CI/reuse/globalTeardown/storageState/workers/guards не менять. Это меньше лишних артефактов на успешных прогонах, не ослабление проверки.
4. src/components/orbit/task-row.tsx и tests/auth/tasks-planning.auth.test.ts: только trim лишних EOF blank lines. Никаких изменений product behavior.
5. reports/TASK-008-executor.md: финальная секция с честным evidence. README можно исправить только если текущий текст противоречит завершённым R1–R8; без новой документационной переработки. Корневые coordination docs и review reports не менять.

Новые проблемы вне этого scope не исправлять самостоятельным расширением: записать точный repro/лог и вернуть NEEDS_FIXES/BLOCKED. Повторить тест допустимо при исправленной причине; бессмысленные повторные full runs не нужны.

## Один последовательный полный проход после cleanup

Node24 проверить до gates; /private/tmp/orbit-r4-review-runtime/node-v24.21.0-darwin-arm64/bin если ещё существует. Проверенный npm ci под Node24 один раз, lint 0 warnings, typecheck, npm test, npm run test:db, npm run test:auth, CI=1 E2E_PORT=<свободный loopback> npm run test:e2e. Строго последовательные DB/auth/E2E из-за общих runner markers; все suites без grep. Counts из фактического результата, не из старого отчёта. Проверить полный auth/E2E log на idle client error/terminating connection/57P01/uncaughtException; force cleanup не успешный gate.

No-env production build в отдельной временной копии tracked дерева без .env и credential env; использовать прежнюю проверенную процедуру из отчёта, не переименовывать/удалять пользовательский .env. Не менять global Node или зависимости package/lock. Dev StrictMode повторять не требуется: product effects не менялись; предыдущее evidence и ограничение постоянного dev suite явно указать.

PG17 если уже доступен. Если закрыт — не запускать Colima/CRM: свой временный guarded PG18 loopback разрешён, честно указать, что PG17 этим проходом не проверен. Существующий runner создаёт own unique orbit_test namespace; проверить 0 leftovers/соединений до stop, собственный кластер/пароль убрать. Credentials/URI/storageState не выводить. localhost3000/CRM/VPN/другие worktree не трогать.

После всего: git diff --check для своих изменений И git diff --check 394aef441a05d95969596bf088b37fb1f087432e..HEAD чистые; перед коммитом проверить весь накопленный diff с учётом uncommitted cleanup. Не reset/stash/rebase/amend. Secrets/logs/tmp artifacts не tracked.

## Передача результата

Один обычный scoped cleanup commit и отчёт в reports/TASK-008-executor.md (секция FINAL). В чат только 4–5 строк: READY_FOR_REVIEW/другой честный статус, полный SHA, cleanup итог, counts/версии, путь отчёта. GLM не присваивает DONE, не делает merge/push/deploy и не начинает TASK-009. Остановиться до независимой финальной приёмки Codex.
