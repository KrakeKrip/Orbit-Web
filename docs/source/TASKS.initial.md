# Orbit — Incremental implementation plan

## Milestone 0 — Foundations
- [ ] Scaffold Next.js + TypeScript, lint/typecheck/test/build scripts.
- [ ] Add UI design tokens, shadcn/ui base elements and responsive app shell.
- [ ] Start local PostgreSQL via Docker; add Drizzle schema and migrations.
- [ ] Integrate Better Auth, disable public signup on server, document initial account bootstrap.
- [ ] Build protected pages and account settings (timezone, theme).
**Done when:** app boots locally, sign-in works, anonymous access is denied, test/build pass.

## Milestone 1 — Everyday core
- [ ] Implement projects CRUD and ownership protections.
- [ ] Implement task CRUD, Inbox and quick-add.
- [ ] Implement Today/Upcoming views, planned date vs deadline handling.
- [ ] Implement project task list, subtasks, P1-P4 and notes.
- [ ] Add task search and empty/error/loading states.
- [ ] Test mobile UI and keyboard navigation.
**Done when:** 10+ realistic tasks can be managed from both desktop and 390px mobile browser without UI breakage.

## Milestone 2 — Recurrences and polish
- [ ] Implement occurrence completion log + DAILY/WEEKDAYS/WEEKLY recurrence semantics.
- [ ] Add unit tests: Friday -> Monday, overdue completion, timezone boundary, duplicate complete.
- [ ] Add task editing sheet and keyboard shortcuts.
- [ ] Add PWA manifest and icons; verify install on a supported device/browser.
- [ ] Add E2E flow: sign in -> task -> schedule -> complete -> refresh -> sign in from second device.
**Done when:** full MVP acceptance criteria in PRODUCT.md pass.

## Milestone 3 — Safe personal deployment
- [ ] Confirm VPS resources and current services; avoid VPN disruption.
- [ ] Configure dedicated hostname/TLS/reverse proxy, DB private network, environment secrets.
- [ ] Configure encrypted/safe backups and test a restore.
- [ ] Deploy and verify real-device PWA install and task sync.
- [ ] Use app for 14 days, log friction, defer feature creep.
**Done when:** app serves real personal workflow with backup/restore verified.

## Milestone 4 — Later, separate proposal
- [ ] Design MCP adapter + per-user OAuth/token scoping; confirm ChatGPT integration eligibility.
- [ ] Registration with verification and abuse controls.
- [ ] Notifications/calendar sync/shared projects only after real usage data justifies them.

## Working rules for Codex
- Implement one milestone at a time. At the start of a milestone, summarize architecture choices and exact files to modify.
- Don't deploy or modify remote VPS/VPN without explicit user instruction.
- After each milestone: run lint/typecheck/tests/build and report concrete outputs, risks and next step.
- Never report unsupported features as complete. Keep TASKS.md checkboxes accurate.
