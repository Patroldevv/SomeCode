# Browser tools for agents

SomeCode offers every agent it runs a small set of browser tools, as an MCP server (`bin/somecode-mcp.ts`), so an agent
can try out what it builds: open a page, look at it, click, type and read the console.

| Tool | What it does |
| --- | --- |
| `browser_open` | Opens an http(s) address in a hidden browser. |
| `browser_snapshot` | The page as text: title, headings, visible text and a numbered list of buttons, links and fields. |
| `browser_screenshot` | A JPEG of the page (or the whole page with `fullPage`); it shows in the chat on the tool card. |
| `browser_click`, `browser_type`, `browser_press`, `browser_scroll` | Use the page. Elements are named by the numbers from the snapshot (`ref`), a CSS selector, or x/y. |
| `browser_wait` | Waits for text or a selector. |
| `browser_evaluate` | Runs a JavaScript expression and returns its value. |
| `browser_console` | Console messages and failed requests since the last time. |
| `browser_resize` | Page size, for example 390 × 844 for the phone layout. |
| `browser_close` | Closes the browser (it also closes with the session). |

## Settings

Settings > Agents > Browser tool: **Off**, **This computer only** (default: only `localhost`-style addresses, and the
page may only load things from this computer too) or **Any web address**. `file:`, `javascript:` and similar addresses
are never opened.

## How it works

The MCP server starts a hidden browser the first time a tool is used: Chromium or Chrome if one is installed, else
Electron (`desktop/browser-host.cjs`, an off-screen window). It talks to it over the Chrome DevTools Protocol
(`apps/server/src/browser/`). Tool calls run one at a time, and the browser is closed when the agent session ends.
Every request the page makes passes the same address guard as the addresses the agent opens.
