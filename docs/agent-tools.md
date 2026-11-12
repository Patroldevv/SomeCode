# Tools SomeCode gives to agents

SomeCode runs a small MCP server (`bin/somecode-mcp.ts`) for every chat. What it offers depends on the settings:

| Setting | Tools |
| --- | --- |
| Settings > Automation > memory and scheduling tools | `history_search`, `history_read`, `memory_list`, `memory_add`, `memory_forget`, `schedule_create`, `schedule_list`, `schedule_cancel` |
| Settings > Agents > Browser tool | `browser_open`, `browser_snapshot`, `browser_screenshot`, `browser_click`, ... (see `browser-tools.md`) |
| Settings > Agents > Gemini Scout | `scout` |

## Memory of past chats
`history_search` finds messages of earlier chats that contain every word (this project, or all projects) and returns chat
ids; `history_read` reads one back as text, in pieces for long chats.

## Project memory
Short notes saved per project (`memory_add`; you can also add and delete them in Settings > Automation). Every agent that
starts a chat in the project is told them. `/learn` and "remember ..." make agents save one.

## Scheduled tasks
A prompt that opens a chat of its own: once, every N minutes (at least 5) or every day at a local time. They run while
SomeCode is open; a task missed while it was closed runs once when it opens. A task uses the access level new chats get
(so it waits for you when it needs approval). Manage them in Settings > Automation (pause, run now, delete).

## Deep research
Mode menu > Deep research (or start a message with `/research`). The agent stays in its plain mode and gets research
instructions with every message: plan sub-questions, read many independent sources, cross-check, and write a cited
report with a source list.

## Checks after changes

Settings > Automation > "Checks after changes" sets, per project, the commands that check the work (typecheck, lint,
tests; "Use suggestions" reads them from `package.json`, Cargo, Go or Python files). When a turn that changed files ends,
SomeCode runs them once, in the project folder, and shows a card with each check. If one fails and automatic fixing is on,
the end of its output goes to the agent as a message of SomeCode's own (hidden in the chat), at most the set number of
rounds (default 2) per message of yours. Nothing runs while the agent works and nothing is sent when everything passes,
so a green project costs no extra tokens. The card has "Run again"; `POST /api/sessions/:id/verify` does the same.

## Deep research: sources and follow-ups

While a research runs, the Sources tab of the workspace panel lists what the agent noted with `research_note` (with its
trust level and a link), the pages it read and the searches it made. When the report is done, buttons under it send the
next question (go deeper, refute a source, check the sources, fill the gaps, make a table, shorten). A long answer can be
saved as a Markdown file.
