import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { BrowserSession } from './session.ts';

export const text = (value: string) => ({ content: [{ type: 'text' as const, text: value }] });
const failure = (error: unknown) => ({ isError: true, content: [{ type: 'text' as const, text: error instanceof Error ? error.message : String(error) }] });

const target = {
  ref: z.number().int().optional().describe('The number in front of an element in the last browser_snapshot.'),
  selector: z.string().optional().describe('A CSS selector, when there is no ref.'),
  x: z.number().optional().describe('Page x coordinate in pixels (with y), when there is neither ref nor selector.'),
  y: z.number().optional(),
};

/**
 * Runs one tool body, turning a thrown error into an error result the agent can read and react to. Calls run one
 * after the other: an agent may issue several at once (a snapshot and a screenshot), and one page cannot serve
 * them in parallel without some of them hanging.
 */
let queue: Promise<unknown> = Promise.resolve();
export function guarded(body: () => Promise<ReturnType<typeof text> | { content: ({ type: 'image'; data: string; mimeType: string } | { type: 'text'; text: string })[] }>) {
  const run = queue.then(async () => {
    try {
      return await body();
    } catch (error) {
      return failure(error);
    }
  });
  queue = run.catch(() => {});
  return run;
}

/** The browser tools of SomeCode's MCP server: an agent can open a page, look at it, use it and read its console. */
export function registerBrowserTools(server: McpServer, browser: BrowserSession): void {
  server.registerTool(
    'browser_open',
    {
      title: 'Open a page',
      description:
        'Opens an address in a hidden browser (use it to try out the app you are building: start its dev server, then open http://localhost:PORT). Returns the final address and the page title. Look at the result with browser_screenshot or browser_snapshot.',
      inputSchema: { url: z.string().describe('A full http:// or https:// address.') },
    },
    ({ url }) => guarded(async () => {
      const page = await browser.open(url);
      return text(`Opened ${page.url}\nTitle: ${page.title || '(none)'}`);
    }),
  );

  server.registerTool(
    'browser_screenshot',
    {
      title: 'Screenshot',
      description: 'A picture of what the page shows now, so you can check how it looks. fullPage captures the whole scrollable page.',
      inputSchema: { fullPage: z.boolean().optional() },
    },
    ({ fullPage }) => guarded(async () => {
      const shot = await browser.screenshot(fullPage === true);
      const page = await browser.pageInfo().catch(() => null);
      // The caption says which page the picture is of; the chat shows it next to the picture.
      const caption = page ? `Screenshot of "${page.title || page.url}" (${page.url})` : 'Screenshot';
      return { content: [{ type: 'text' as const, text: caption }, { type: 'image' as const, data: shot.data, mimeType: shot.mimeType }] };
    }),
  );

  server.registerTool(
    'browser_snapshot',
    {
      title: 'Page snapshot',
      description:
        'The page as text: its title, headings, the visible text and a numbered list of the things you can use (buttons, links, fields). Use the numbers as `ref` in browser_click and browser_type. Cheaper than a screenshot; take a new one after the page changes.',
      inputSchema: {},
    },
    () => guarded(async () => {
      const s = await browser.snapshot();
      const parts = [`URL: ${s.url}`, `Title: ${s.title || '(none)'}`];
      if (s.headings.length > 0) parts.push(`Headings: ${s.headings.join(' | ')}`);
      parts.push('', 'Elements:', ...(s.elements.length > 0 ? s.elements : ['(none)']), '', 'Visible text:', s.text);
      return text(parts.join('\n'));
    }),
  );

  server.registerTool(
    'browser_click',
    {
      title: 'Click',
      description: 'Clicks an element (scrolled into view first), or a point on the page. Returns nothing; look again afterwards.',
      inputSchema: { ...target, double: z.boolean().optional() },
    },
    ({ double, ...t }) => guarded(async () => {
      await browser.click(t, double === true);
      return text('Clicked.');
    }),
  );

  server.registerTool(
    'browser_type',
    {
      title: 'Type',
      description: 'Clicks a field and types into it, replacing what was there (clear: false keeps it). submit presses Enter afterwards.',
      inputSchema: { ...target, text: z.string(), submit: z.boolean().optional(), clear: z.boolean().optional() },
    },
    ({ text: value, submit, clear, ...t }) => guarded(async () => {
      await browser.type(t, value, { ...(submit !== undefined ? { submit } : {}), ...(clear !== undefined ? { clear } : {}) });
      return text('Typed.');
    }),
  );

  server.registerTool(
    'browser_press',
    {
      title: 'Press a key',
      description: 'Presses a key or a combination in the focused element: Enter, Escape, Tab, ArrowDown, "Control+K", "Shift+Tab", a letter, ...',
      inputSchema: { key: z.string() },
    },
    ({ key }) => guarded(async () => {
      await browser.press(key);
      return text(`Pressed ${key}.`);
    }),
  );

  server.registerTool(
    'browser_scroll',
    {
      title: 'Scroll',
      description: 'Scrolls the page by this many pixels (positive is down).',
      inputSchema: { deltaY: z.number() },
    },
    ({ deltaY }) => guarded(async () => {
      await browser.scroll(deltaY);
      return text('Scrolled.');
    }),
  );

  server.registerTool(
    'browser_wait',
    {
      title: 'Wait',
      description: 'Waits until some text appears on the page or a selector matches (up to ms, default 10 s), or just waits ms when given neither.',
      inputSchema: { text: z.string().optional(), selector: z.string().optional(), ms: z.number().optional() },
    },
    ({ text: value, selector, ms }) => guarded(async () => {
      const found = await browser.waitFor({ ...(value !== undefined ? { text: value } : {}), ...(selector !== undefined ? { selector } : {}), ...(ms !== undefined ? { ms } : {}) });
      return text(found ? 'Found it.' : 'It did not show up in time.');
    }),
  );

  server.registerTool(
    'browser_evaluate',
    {
      title: 'Run JavaScript',
      description: 'Evaluates a JavaScript expression in the page and returns its value as JSON (for reading state or checking a style; do not use it to click, use browser_click).',
      inputSchema: { expression: z.string() },
    },
    ({ expression }) => guarded(async () => text(await browser.evaluate(expression))),
  );

  server.registerTool(
    'browser_console',
    {
      title: 'Console and failed requests',
      description: 'What the page logged to its console (errors, warnings) and which requests failed since you last cleared it. The first place to look when something does not work.',
      inputSchema: { clear: z.boolean().optional() },
    },
    ({ clear }) => guarded(async () => {
      const lines = browser.consoleLog(clear === true);
      const failed = browser.failedRequests(clear === true);
      return text([`Console (${lines.length}):`, ...(lines.length > 0 ? lines : ['(empty)']), '', `Failed requests (${failed.length}):`, ...(failed.length > 0 ? failed : ['(none)'])].join('\n'));
    }),
  );

  server.registerTool(
    'browser_resize',
    {
      title: 'Resize the window',
      description: 'Sets the size of the page in pixels, for example 390 x 844 to see the phone layout. The default is 1280 x 800.',
      inputSchema: { width: z.number(), height: z.number() },
    },
    ({ width, height }) => guarded(async () => {
      await browser.resize(width, height);
      return text(`Now ${width} x ${height}.`);
    }),
  );

  server.registerTool(
    'browser_close',
    {
      title: 'Close the browser',
      description: 'Closes the hidden browser. It also closes by itself when the session ends.',
      inputSchema: {},
    },
    () => guarded(async () => {
      browser.close();
      return text('Closed.');
    }),
  );
}
