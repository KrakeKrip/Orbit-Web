# Prompt for Codex — Orbit, Milestone 0

You are implementing **Orbit**, a personal Todoist-like task manager designed for safe future multi-user access. Treat the repository root's PRODUCT.md, DESIGN.md, ARCHITECTURE.md and TASKS.md as the authoritative requirements.

YOUR TASK: implement **Milestone 0 only** from TASKS.md, then stop. Do not build the whole product in one step. Do not deploy to any remote server. Do not touch existing VPN or VPS services.

Constraints:
1. Use current stable compatible dependencies from official documentation. Stack: Next.js App Router/TypeScript, Tailwind, accessible shadcn/ui-style components, PostgreSQL, Drizzle, Better Auth, Zod. Confirm actual documented APIs before coding.
2. Build a polished but minimal responsive shell with navigation for Inbox, Today, Upcoming, Projects, Settings. Empty states are okay; no mock task data in production flows.
3. Set up local PostgreSQL, schema and migrations. Do not create custom authentication primitives; use library features. Keep signup disabled in production and document a safe one-time first-user provisioning procedure.
4. User-specific data must be protected server-side. Account timezone and theme settings. No passwords or secrets committed.
5. Add `.env.example`, local setup instructions and npm scripts for lint/typecheck/test/build.
6. Work incrementally with meaningful commits if inside git; never overwrite unrelated work.
7. Before editing, briefly show files to be added/changed. After editing, actually run lint, typecheck, tests and build. Report command outcomes factually, including failures and mitigations.
8. Update TASKS.md with only work completed. Clearly describe any simplifications or deviations requiring approval.

At the end, give: (a) what runs locally, (b) commands to start it, (c) tests actually run and results, (d) any remaining blockers. Then STOP and ask for Milestone 1 authorization.

## Superseded — 2026-10-08
Сохранено как исходный пользовательский материал. Поручение выше реализовать Milestone 0 целиком отменено текущим режимом координатора/reviewer. Действующий процесс — AGENTS.md; исполнитель получает только отдельный tasks/TASK-NNN.md. Никакой реализации Codex на этапе INITIAL SETUP.
