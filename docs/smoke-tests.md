# Smoke tests

Automated tests use a scripted fake agent. These smoke tests exercise the real thing: the launcher, the built web UI and a real agent binary (OpenCode). They need a working `opencode` install, so they are run by hand and are not part of `npm test`.

## 1. Start the launcher

```sh
npm run build -w apps/web
npm start -- --no-open
```

The launcher prints exactly one line on stdout:

```
SomeCode: http://127.0.0.1:<port>#token=<token>
```

The token is random per start and is never printed anywhere else. `--port <n>` picks a fixed port (0 to 65535, default is a random free port). Without `--no-open` the launcher also opens the URL in a Chromium-family browser in app mode (falling back to `xdg-open`). The data directory is `$SOMECODE_DATA_DIR`, else `$XDG_DATA_HOME/somecode`, else `~/.local/share/somecode`; set `SOMECODE_DATA_DIR` to a temp directory to keep a smoke run away from your real data.

If `apps/web/dist` is missing, the launcher warns on stderr and serves the API only.

## 2. Manual smoke test (browser)

1. `mkdir -p /tmp/somecode-smoke`
2. Open the printed URL in a browser (the page reads the token from `#token=`).
3. Add `/tmp/somecode-smoke` as a project.
4. Start a session with the `OpenCode` agent.
5. Type `Merhaba de` and send it.

Expected:

- The session becomes `ready`.
- At least one `agent_message` and a `turn_end` appear.
- After a page reload, the history is replayed identically.

If `opencode` is not logged in, the expected outcome is either a session that goes `disconnected` with an `auth_required` reason (the agent refused to start), or a turn that ends with an error item showing the `auth_required` message (the agent refused the prompt). That is not a defect of this plan; the login flow comes in a later plan.

## 3. Scripted smoke test (no browser)

`scripts/smoke.ts` does the same through the REST and WebSocket API: it creates a project and a session, subscribes from sequence 0, sends the prompt, and prints each event as one compact line.

```sh
SOMECODE_URL=http://127.0.0.1:<port> SOMECODE_TOKEN=<token> \
  node scripts/smoke.ts opencode /tmp/somecode-smoke "Merhaba de"
```

`--url` and `--token` flags may be used instead of the environment variables. `SMOKE_TIMEOUT_MS` sets the overall timeout (default 120000).

Exit codes:

| Code | Meaning |
| --- | --- |
| 0 | `turn_end` arrived; the final line is `smoke: ok stopReason=<reason>` |
| 1 | a `turn_end` with an error (its code is printed), `status: disconnected` (the reason is printed), a server `error` message, a REST failure, or a timeout |
| 2 | usage error |

Expected with a logged-in OpenCode: a `status ready`, a `user_message`, `status running`, one or more `agent_message` lines, then `turn_end` and exit 0.

Expected with OpenCode not logged in: either no `turn_end` (the session disconnects at startup) or a `turn_end stopReason=error error=auth_required …` line; in both cases the run ends with `smoke: FAILED <reason>` where the reason mentions `auth_required`, and exit 1.

The logic lives in `apps/server/src/launcher/smoke.ts` (`runSmoke`) and is covered by `smoke.test.ts` against the fake agent.

## Results


### 2026-11-07 — OpenCode 2.2.6 (not logged in; free `opencode/big-pickle` model)

Launcher started with `--no-open` and a temp data dir; `node scripts/smoke.ts opencode /tmp/somecode-smoke "Merhaba de"`.

- `GET /api/agents` → `opencode` installed, version `opencode v2.2.6`.
- The ACP handshake and session creation worked against the real agent. Journal: `config_options` (model list from the agent, current value `opencode/big-pickle`), `status ready`, `user_message "Merhaba de"`, `status running`.
- No `agent_message` or `turn_end` arrived within 90 s, and the smoke client ended with `smoke: FAILED timed out` (exit 1).
- Cause is upstream, not SomeCode: `opencode run "Merhaba de"` run directly in the same directory also failed, retrying with `Upstream request failed: [overloaded] the server is overloaded` (`opencode auth list` shows no authenticated integrations).
- Not verified yet: a full real-agent turn (thought, message, tool call, `turn_end`). Re-run this smoke when the provider is available or after `opencode auth login`.
- Launcher stopped with SIGTERM and exited; no `fake-agent` or leftover `opencode acp` process remained.
