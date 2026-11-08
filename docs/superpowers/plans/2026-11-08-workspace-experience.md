# Workspace Experience Implementation Plan

> **For agentic workers:** Use scoped parallel agents for independent backend domains; controller implements frontend and integrates. Test new behavioral contracts before production changes.

**Goal:** Deliver persistent, navigable agent workspaces with polished first-message chat flow, files and terminal.
**Architecture:** Existing event-journal architecture with bounded history; independent workspace routes and PTY service; React main-area new-chat and right workspace panel.
**Tech Stack:** Node 26, TypeScript, ACP SDK, Hono, SQLite, React 19, Vite, Tailwind; node-pty and xterm for terminal if supported.
**Spec:** docs/superpowers/specs/2026-11-08-workspace-experience-design.md

## Global Constraints
- Local-only authenticated API; project root confinement for file routes; no shell interpolation of user data.
- No real-agent prompts or login automatically; preserve user's existing data.
- Shared checkout, disjoint file ownership, no commits by workers.
- User authorized implementation; keep working without design approval pauses.

## Review Focus
- ACP resume concurrent calls and unsupported load must not fork silently.
- Traversal and symlink targets outside project are forbidden.
- Delayed first session creation must not lose a draft or double-send.
- Bounded replay must not skip updates or destroy accumulated state.
- Terminal resources must close on server shutdown and pending login UI must describe actual state.

### Task 1: Durable session lifecycle and bounded history
Ownership: apps/server/src/acp, sessions, store, http/ws.ts, protocol, web lib connection/sessionClient/sessionsStore/sessionState, associated tests. HTTP route integration coordinated with controller.
- [ ] Add restart/resume tests with fake ACP and concurrent attempts; implement explicit resume, load capability check, replay suppression on load.
- [ ] Add bounded history page/replay contracts and tests; avoid full unbounded reads and retained inactive caches. Implement accessible older-history mechanism for UI integration.
- [ ] Run owned tests and typecheck; report API and frontend interfaces.

### Task 2: Workspace services
Ownership: new apps/server/src/workspace/* only; agent dependency edits via controller.
- [ ] Test directory browser, confined file list/read/search (absolute, traversal, symlink, binary, huge input).
- [ ] Implement mountWorkspaceRoutes(app, {store,registry,terminals}) under /api; expose folder browsing and project file routes.
- [ ] Implement PTY terminal create/read/write/resize/delete with bounded output and shutdown; explicit fixed login action.
- [ ] Test lifecycle and bounds; report exact routes for frontend integration.

### Task 3: Product UI and integration
Ownership: apps/web/src except worker-owned lib files; apps/server/src/http/app.ts, server.ts; dependency package files.
- [ ] Test main-area new chat and first-message handoff/failure behavior.
- [ ] Implement inline folder chooser, agent picker, starting status; polished sidebar, composer and workspace panel with files/preview/terminal.
- [ ] Integrate resume/history UI and APIs; bound inactive UI resources.
- [ ] Run whole suite, typecheck, production build; demo browser verification, final independent review and fixes.
