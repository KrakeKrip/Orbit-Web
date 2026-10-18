# Orbit Web

Веб-версия Orbit: **Next.js · TypeScript · PostgreSQL · Drizzle · Better Auth**. Отдельна от [Orbit iOS](https://github.com/KrakeKrip/Orbit); базы и аккаунты между ними не синхронизируются.

Перенесена18октября2026 точным снимком tracked web-файлов из Orbit на коммите72417009de790211047e7e667f9e112ea25031fe. История до разделения: https://github.com/KrakeKrip/Orbit/tree/72417009de790211047e7e667f9e112ea25031fe. Apple-код, пользовательские базы, .env и локальные caches не переносились.

Реализованы Inbox/Today/Upcoming, one-off задачи, civil-планирование, проекты, настройки аккаунта и серверная авторизация. Состояние прошлой приёмки — reports/TASK-008*. Перенос не означает новый production deploy и не возобновляет автоматически разработку.

## Запуск

Node24LTS, npm11, PostgreSQL17 и Docker-совместимый runtime для локальной базы.

```sh
npm ci
cp .env.example .env
# Заполните собственные локальные секреты в .env.
docker compose up -d
npm run db:migrate
npm run auth:bootstrap
npm run dev
```

Не запускайте эти команды против неизвестной базы или действующего сервера. [Полная инструкция](docs/WEB-DEVELOPMENT.md) описывает auth/bootstrap, локальную БД и тесты.

## Проверки

```sh
npm run lint
npm run typecheck
npm test
npm run build
```

DB/auth/E2E требуют отдельных условий из инструкции. Существующие отчёты описывают проверки до разделения; свежие результаты переноса — reports/REPOSITORY-SPLIT.md.

[Требования](PRODUCT.md) · [Архитектура](ARCHITECTURE.md) · [Дизайн](DESIGN.md) · [Задачи](TASKS.md)
