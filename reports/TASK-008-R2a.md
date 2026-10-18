# TASK-008-R2a — независимое review

Актуальный статус: R2a принят на 437e5a2, reports/TASK-008-R2a-fix.md. Ниже сохранено предыдущее задание/review.

**NEEDS_FIXES (только остаток R2a)**, 2026-10-09. Executor HEAD `9932004481c48dcd9429a102c7b5854987029f08`; correction base `73c65492b9405707572a8ec39fb482490d37318e`. Перед review ветка task/TASK-008 и дерево чистые. Проверены оба новых коммита, 7 файлов; correction diff --check чист. Main чистая на `9a81313bb498fd1e584b14a0bc2b87b506102c6b`, не изменялась.

Общий синхронный guard create/row writes работает: регистрация create до fetch, shared row handlers видят её, finally освобождает регистрацию. Create controls и кнопки обычных строк получают общий busy. Адаптация R3b focus assertion к auto-retrying toBeFocused сохраняет проверяемое поведение. Warning исправлен. Второй запрос в проверенных bypass-сценариях не отправляется.

## Единственный остаток: [P2] открытые формы не получают общий busy

`task-items-list.tsx` передаёт globalBusy только как state.busy. `task-row.tsx` использует его в обычных action buttons, но уже открытые rename/schedule/delete forms блокируются только собственными pending. В частности TaskScheduleEditor получает pending=state.schedulePending: во время create это false. Поэтому поле даты, Save и Cancel открытого editor остаются доступными; submit guard молча отклоняет Save. Аналогичное подключение own pending видно в rename и delete confirmation. Close handlers также проверяют только свой pending, а не общий синхронный guard.

Детерминированный repro Codex на свежем production build: создать свою Inbox task → открыть Планирование → dirty date=2099-01-10 → удержать POST quick-add → дождаться route delivery. Quick-add disabled, но assertion dateInput.toBeDisabled() падает: **Received enabled**. Это нарушение явного критерия TASK-008-R2a «при любой pending записи ... конфликтующие row action/form controls disabled». Проверка выбора одного editor и переключения mode сюда не относится и остаётся R2b.

Нужно маленькое дополнение: подключить уже открытые формы к общему busy, сохранить их draft и frozen opening snapshot, защитить cancel/Escape callbacks от обхода disabled во время чужого write. Не смешивать факт собственной операции (spinner/текст) с блокировкой из-за другой операции. Не переписывать hook/экраны и не чинить R2b–R8.

## Проверки Codex

Node 24.21.0. lint exit 0, **0 warnings**; typecheck exit 0; unit **63/63**, exit 0. Свежий штатный production build PASS. Целевой Chromium запуск write-guard + Inbox + planning: **31 штатная проверка прошла**, дополнительная Codex regression открытого editor — **1 failure**, общий exit 1. Команда: `CI=1 E2E_PORT=3441 npm run test:e2e -- tests/e2e/write-guard.spec.ts tests/e2e/inbox.spec.ts tests/e2e/planning.spec.ts tests/e2e/codex-review-r2a.spec.ts --project=chromium`.

Тесты выполнены на отдельном временном PostgreSQL **18.6**, собственный кластер /private/tmp, случайный loopback port и ephemeral password. Целевой PG17 не перепроверен: Colima выключена; Colima/dev DB/CRM/localhost3000 не запускались. Runner cleanup успешен; read-only check: 0 orbit_test* баз. Временный PostgreSQL остановлен, собственный кластер и пароль удалены. Codex диагностический spec удалён после сравнения с собственной scratch-копией; продуктовый код не менялся.

Full auth/full E2E/no-env build/dev StrictMode в этом узком review не повторялись. Старые debug/EOF remarks остаются для отдельной финальной уборки. R1 остаётся принят; R2a пока не принят, R2b–R8 открыты; TASK-008 NEEDS_FIXES. Следующая выдача только tasks/TASK-008-R2a-fix.md. Без merge/push/deploy.
