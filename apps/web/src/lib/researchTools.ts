import { t } from '../i18n/index.ts';
import type { ToolItem } from './sessionState.ts';

const NAMES = ['web_search', 'web_read', 'research_note', 'research_status', 'research_plan', 'research_progress', 'history_search', 'history_read', 'memory_list', 'memory_add', 'memory_forget', 'schedule_create', 'schedule_list', 'schedule_cancel'] as const;
export type ResearchToolName = (typeof NAMES)[number];

/** Which of SomeCode's research / memory tools a call is (`mcp__somecode__web_search`, `Run mcp_somecode_web_read`, ...), or null. */
export function researchTool(item: Pick<ToolItem, 'title'>): ResearchToolName | null {
  const lower = item.title.toLowerCase();
  if (!lower.includes('somecode')) return null;
  return NAMES.find((n) => new RegExp(`(?:^|[^a-z])${n}(?![a-z_])`).test(lower)) ?? null;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const clip = (text: string, max: number): string => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

const host = (url: string): string => {
  try {
    const u = new URL(url);
    return u.host.replace(/^www\./, '') + (u.pathname.length > 1 ? clip(u.pathname, 28) : '');
  } catch {
    return clip(url, 40);
  }
};

/** What the tool answered, as text (the first block). */
const answer = (item: Pick<ToolItem, 'content'>): string => item.content.find((c): c is Extract<typeof c, { type: 'text' }> => c.type === 'text')?.text ?? '';

/**
 * Calls that only keep the interface up to date (a plan step ticked off, the plan card itself) or that are the
 * agent's own bookkeeping with a terminal: they are not shown as rows, the plan card and the results say it already.
 */
export function isHiddenTool(item: Pick<ToolItem, 'title'>): boolean {
  const tool = researchTool(item);
  if (tool === 'research_progress' || tool === 'research_plan') return true;
  return /^(?:create[_ ]?terminal|start(?:ing)?[_ ]?terminal|terminal[_ ]?(?:create|start|started|output|wait_for_exit|release|kill)|release[_ ]?terminal|kill[_ ]?terminal|wait[_ ]?for[_ ]?terminal(?:[_ ]?exit)?)\b/i.test(item.title.trim());
}

/** A short line for a research or memory tool call: what it is doing now, or did, in the user's language. */
export function researchLabel(item: ToolItem): string | null {
  const tool = researchTool(item);
  if (!tool) return null;
  const running = item.status === 'in_progress' || item.status === 'pending';
  const input = isRecord(item.rawInput) ? item.rawInput : {};
  const str = (key: string): string => (typeof input[key] === 'string' ? (input[key] as string).trim() : '');
  const key = (name: string) => `tool.research.${name}.${running ? 'running' : 'done'}` as const;
  switch (tool) {
    case 'web_search': {
      const engine = /^([^·\n]+?) ·/.exec(answer(item))?.[1]?.trim();
      return t(key('search') as 'tool.research.search.running', { query: clip(str('query'), 60), engine: engine || str('engine') || t('tool.research.anyEngine') });
    }
    case 'web_read':
      return t(key('read') as 'tool.research.read.running', { page: host(str('url')) });
    case 'research_note':
      return t(key('note') as 'tool.research.note.running', { title: clip(str('title'), 50) });
    case 'research_status':
      return t(key('status') as 'tool.research.status.running');
    case 'history_search':
      return t(key('history') as 'tool.research.history.running', { query: clip(str('query'), 50) });
    case 'history_read':
      return t(key('historyRead') as 'tool.research.historyRead.running');
    case 'memory_add':
      return t(key('memoryAdd') as 'tool.research.memoryAdd.running');
    case 'memory_list':
    case 'memory_forget':
      return t(key('memory') as 'tool.research.memory.running');
    case 'schedule_create':
    case 'schedule_list':
    case 'schedule_cancel':
      return t(key('schedule') as 'tool.research.schedule.running');
    default:
      return null;
  }
}
