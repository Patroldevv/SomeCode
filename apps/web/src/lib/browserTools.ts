import { t } from '../i18n/index.ts';
import type { ToolItem } from './sessionState.ts';

export type BrowserAction = 'open' | 'screenshot' | 'snapshot' | 'click' | 'type' | 'press' | 'scroll' | 'wait' | 'evaluate' | 'console' | 'resize' | 'close';

const ACTIONS: readonly BrowserAction[] = ['open', 'screenshot', 'snapshot', 'click', 'type', 'press', 'scroll', 'wait', 'evaluate', 'console', 'resize', 'close'];

/** Which browser tool of SomeCode's MCP server a call is (`mcp__somecode__browser_click`, ...), or null. */
export function browserAction(item: Pick<ToolItem, 'title'>): BrowserAction | null {
  const match = /(?:^|[_\s-])browser_([a-z]+)\b/i.exec(item.title);
  const name = match?.[1]?.toLowerCase();
  return ACTIONS.find((a) => a === name) ?? null;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** The "Screenshot of "Title" (url)" caption the screenshot tool puts next to its picture. */
export function screenshotCaption(item: Pick<ToolItem, 'content'>): { name: string; url: string | null } | null {
  for (const block of item.content) {
    if (block.type !== 'text') continue;
    const m = /^Screenshot of "(.*)" \((\S+)\)$/s.exec(block.text.trim());
    if (m) return { name: m[1]!, url: m[2]! };
  }
  return null;
}

const host = (url: string): string => {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
};

/** `localhost:5173` for the root, `localhost:5173/docs` for a path. */
function pageOf(url: string): string {
  try {
    const u = new URL(url);
    return u.host + (u.pathname === '/' ? '' : u.pathname);
  } catch {
    return url;
  }
}

/** A short line for a browser tool call: what was done and to which page, in the user's language. */
export function browserLabel(item: ToolItem): string | null {
  const action = browserAction(item);
  if (!action) return null;
  const input = isRecord(item.rawInput) ? item.rawInput : {};
  const str = (key: string): string => (typeof input[key] === 'string' ? (input[key] as string) : '');
  switch (action) {
    case 'open':
      return t('tool.browser.open', { page: str('url') ? pageOf(str('url')) : '…' });
    case 'screenshot': {
      const cap = screenshotCaption(item);
      return cap ? t('tool.browser.screenshotOf', { page: cap.name || host(cap.url ?? '') }) : t('tool.browser.screenshot');
    }
    case 'click':
      return str('ref') || typeof input['ref'] === 'number' ? t('tool.browser.clickRef', { ref: String(input['ref']) }) : t('tool.browser.click');
    case 'type':
      return t('tool.browser.type', { text: str('text').length > 40 ? `${str('text').slice(0, 37)}…` : str('text') });
    case 'press':
      return t('tool.browser.press', { key: str('key') });
    case 'wait':
      return t('tool.browser.wait');
    case 'resize':
      return t('tool.browser.resize', { width: String(input['width'] ?? '?'), height: String(input['height'] ?? '?') });
    default:
      return t(`tool.browser.${action}`);
  }
}
