# SomeCode workspace experience

User requested implementation, including freedom over UI; proceed without another approval checkpoint.

Keep Node 26, React, Hono, ACP, SQLite and Linux local-only architecture. Develop in the current checkout on a feature branch so the user can run the result directly. No push or merge.

## Approach
Extend the existing implementation rather than replacing it or introducing Electron. Three independent ownership areas: session lifecycle/history; workspace services; application UI. Retain event journal as durable truth. No model prompts against real paid agents during verification.

## Behaviors
- Restore persisted ACP sessions with session/load when supported, with single-flight resume, failure states and no silent fresh session replacement. Expose explicit REST resume action; UI shows resuming state.
- Bounded server replay/query pages, bounded in-memory client session cache; older history remains accessible. Loading older content must preserve stream cursors and normalized state.
- Project-contained file listing, text preview and bounded file mention search; deny traversal and symlink escape. A server-side local folder browser selects real absolute paths.
- Interactive project terminal using PTY, bounded output and cleanup. Fixed driver-specific login commands run only on explicit UI action in terminal; unknown login methods show honest instructions. Do not collect agent credentials.
- New chat is a full main-area workspace, not a modal. Choose agent and folder, draft first prompt, show starting state, then create session and send the draft only after ready. Keep draft on failure.
- Sidebar: prominent New chat, search, project grouping, meaningful session titles/status. Right panel: Files, Preview, Terminal; file insertion into composer as @relative/path. Accessible keyboard controls, responsive layout, subtle reduced-motion-aware transitions.
- TR/EN user-facing strings. Real functional panels, no decorative placeholders.

## Validation
Behavioral regression tests for resume races, restart, path confinement, output limits and first-prompt failure/retry. Full tests, typecheck, build and browser demo. Report any unverified real-agent behavior.
