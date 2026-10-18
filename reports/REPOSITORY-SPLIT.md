# Перенос веб-версии

18 октября2026. Источник KrakeKrip/Orbit, SHA72417009de790211047e7e667f9e112ea25031fe. Новый репозиторий изначально пуст.

Скопировано200tracked web-файлов; каждый проверен SHA-256 до удаления из iOS tree. src/tests/drizzle, package/lock/configs/scripts сохранены без изменения поведения; docs/root обновлены для самостоятельного проекта. Исходная история остаётся в Orbit, здесь первый commit — снимок переноса, без переписывания исходной истории.

npm ci --offline --ignore-scripts PASS; lint/typecheck PASS;69unit tests PASS. Обычный Next/Turbopack build блокируется окружением: внутренний PostCSS-процесс не может bind локальный порт, Operation not permitted. Повтор вне обычного sandbox дал то же ограничение. Поддерживаемый npm run build -- --webpack — PASS (production pages/API compiled).

DB/auth/E2E/production deployment в этом проходе не запускались. Никаких пользовательских .env, credentials, stores, volumes или caches в Git tree. Содержимое исходных файлов проверено как перенос, а не полная ревизия безопасности.
