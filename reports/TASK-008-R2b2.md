# TASK-008-R2b2 — независимое review

Актуальный статус: R2b2 принят на 9d9566e; reports/TASK-008-R2b2-fix.md. Ниже историческое задание/review.

**NEEDS_FIXES — один небольшой остаток порядка вызовов**, 2026-10-09. Executor HEAD `556c9f77c6357dc0eff02310d048c98031709592`, correction base `4d81b7a651018d938ca3115c152bb63c94f27204`. Один scoped commit, 2 product files + browser spec + executor report. Дерево до review чистое; correction diff --check чист. Main чистая на `9a81313bb498fd1e584b14a0bc2b87b506102c6b`.

Реактивные anyPending/formOpen блокируют status и range controls. Синхронные anyInFlight/anyFormOpen запрещают смену status и эффекты navigate: URL/state/GET. Failed Save сохраняет editor и lock; Cancel освобождает. Inbox/Today, service/API/schema не менялись; R1/R2a/R2b1 сохранены.

## [P3] Расчёт даты ещё выполняется до guard

В upcoming-board.tsx `onClick={() => navigate(addCivilDays(startDate, -7))}` и аналогичный +7 сначала вычисляют аргумент addCivilDays, только потом входят в navigate с guard. Комментарий о guard «до вычисления нового диапазона» неверен. TASK-008-R2b2 явно требовал guard до расчёта; это отдельно от будущей R5-валидации допустимых границ. При входе в callback заблокированной попытки расчёт не должен выполняться вообще. Если он бросает исключение, guard внутри navigate его уже не перехватывает.

На обычных датах browser tests зелёные; runtime exception в этом review не воспроизводился. Это finding по доказуемому порядку вычисления аргументов в проверенном исходнике, а не новое заявление о падении E2E. Нужна минимальная правка одного файла: передать ленивый расчёт внутрь guarded handler либо проверять guard до addCivilDays в onClick. Сохранить существующие проверки и обновление URL/state/GET. Calendar bounds R5 не чинить здесь.

## Независимые проверки Codex

Node 24.21.0. lint exit 0, 0 warnings; typecheck exit 0; unit **63/63**, exit 0. Свежий production build PASS. `CI=1 E2E_PORT=3447 npm run test:e2e -- tests/e2e/write-guard.spec.ts tests/e2e/inbox.spec.ts tests/e2e/planning.spec.ts --project=chromium`: **37/37**, exit 0 (3 auth setup + 9 write guard + 12 Inbox + 13 planning). Новый held completion PATCH тест получает synthetic 200 через route.fulfill: проверяет write pending/release/read текущего mode, но не сохранение completion в БД; это допустимо для данного UI guard, не доказательство реального completion flow. Dirty editor/failed Save/Cancel regression проходит.

PostgreSQL **17.11** подтверждён SHOW server_version. Own guarded per-run test DB; после запуска test DB 0, test connections 0. Main не менялась; CRM/Colima/localhost3000/hooks не трогались. Продуктовый код Codex не менял; без merge/push/deploy.

Full auth/full E2E/no-env build/dev probe здесь не повторены. R6 timezone и прежние EOF/debug замечания не закрываются targeted green. Следующая выдача только tasks/TASK-008-R2b2-fix.md: guard до расчёта даты, один product file. R2b2 пока не принят; R1/R2a/R2b1 остаются принятыми, R2/R3–R8 открыты, TASK-008 NEEDS_FIXES.
