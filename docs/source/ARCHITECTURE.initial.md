# Orbit — Technical architecture

## Stack
- Next.js App Router, TypeScript, React.
- Tailwind CSS + shadcn/ui or equivalent accessible primitives.
- PostgreSQL + Drizzle ORM with checked-in migrations.
- Better Auth for email/password sessions and server-side authentication. Integrate through its documented Next.js and Drizzle APIs; verify package APIs during installation.
- Zod schema validation at server boundaries.
- Vitest for pure rules and integration tests; Playwright for minimum end-to-end flows.
- Docker Compose for local Postgres and, after local verification, application deployment. Reverse proxy with TLS for public access.

## Runtime architecture
Responsive Next.js UI -> authenticated server handlers / route handlers -> typed application service -> Drizzle/PostgreSQL.
No microservices or message bus in MVP. Keep task operations in reusable services so a future authenticated MCP adapter can call the same authorization and business logic, rather than duplicating queries.

## Data model (logical)
- Better Auth-managed `user` and session/account tables; do not manually assume their complete structure.
- `user_settings`: user_id PK/FK, timezone IANA string, theme, created_at, updated_at.
- `projects`: id UUID PK, owner_id FK, name, sort_order, archived_at nullable, created_at, updated_at.
- `tasks`: id UUID PK, owner_id FK, project_id nullable, parent_id nullable, title, notes, priority 1-4, planned_date nullable (DATE), planned_time nullable (TIME), deadline_date nullable (DATE), recurrence_rule nullable (restricted enum/config for MVP), sort_order, completed_at nullable, deleted_at nullable, created_at, updated_at.
- `task_completions`: id UUID PK, owner_id FK, task_id FK, occurrence_date nullable DATE, completed_at timestamptz, unique key / transaction guard to prevent duplicate recurrence advancement.

Indexes for owner_id and typical owner/date/completion queries. FK constraints, ownership checks for every nested reference; no reliance on frontend filtering. Avoid leaking task existence in cross-owner API responses.

## Date and recurrence policy
- DATE values represent calendar dates in the user's timezone, not UTC midnight timestamps. Optional planned TIME is interpreted in that timezone. All event timestamps use timestamptz in DB.
- `deadline_date` is independent of `planned_date`.
- MVP recurrence values: DAILY, WEEKDAYS, WEEKLY (weekly anchored to task's weekday). Additional recurrence patterns later.
- Recurrence requires planned_date; deadlines on recurring tasks are unsupported in MVP to avoid ambiguous meanings.
- Completion of recurring task transactionally inserts completion log and advances planned_date to the first eligible date strictly after the greater of current scheduled date and completion date. Guard against double-completion race/retry.
- Define a stable reopening rule: one-off tasks can be reopened; completion history for repeating tasks is shown, but undoing a past occurrence is postponed to a later version unless explicitly supported with safe transactional semantics.

## Security
- Public signups disabled via server-side auth configuration; initial account created by a documented one-time operator/admin procedure (no open temporary production signup endpoint).
- Secure session cookies and CSRF defenses from selected auth framework; secrets only server side. Protect against IDOR by checking owner on every project/task read and mutation.
- Validate inputs, apply lengths and date bounds; avoid raw SQL built from input.
- Rate-limit sign-in; enforce HTTPS in deployment; never expose database port publicly.
- Backups (nightly PostgreSQL dumps, encrypted if stored off-server) and documented restore procedure before production personal use.
- Distinct local/dev and production secrets; `.env.example` includes keys without values.

## Deployment constraints
Deploy to the user's existing VPS only after reviewing free RAM, disk space, open ports and reverse-proxy/VPN conflicts. Do not modify, interrupt or reconfigure the existing VPN deployment as a side effect. Use dedicated hostname and reverse proxy, isolated network/service, explicit resource and backup policy.

## API/business service capabilities
- projects: list/create/rename/archive.
- tasks: list with filters, quick-create, update, complete, reopen one-off, soft-delete, get detail; enforce project/parent ownership.
- occurrences: completion history and schedule advancement for recurring tasks.
- settings: get/update timezone/theme.

## Later MCP adapter (NOT in MVP)
User-authorized ChatGPT integration must call existing task services using a scoped user identity and appropriate consent/authorization. Never expose a single admin token or global data to all users. Avoid promising that arbitrary ChatGPT clients/plans support write operations before validating actual eligibility.

## Quality gates
- Typecheck, lint, unit tests for recurrence/timezone/date semantics, authorization integration tests, mobile navigation E2E, production build.
- Seed realistic development-only tasks with no personal private data.
- Document migrations, local startup, environment setup and backup restoration.

## References (reviewed 2026-10-08)
- https://nextjs.org/docs/app
- https://nextjs.org/docs/app/guides/progressive-web-apps
- https://better-auth.com/docs/installation
- https://better-auth.com/docs/adapters/drizzle
- https://better-auth.com/docs/reference/options
