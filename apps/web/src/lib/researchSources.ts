import type { Item, ToolItem } from './sessionState.ts';
import { researchTool } from './researchTools.ts';

export type Confidence = 'high' | 'medium' | 'low';
export type ResearchSource = { url: string; title: string; finding: string; confidence: Confidence; step?: number };
export type ResearchSearch = { query: string; engine: string; running: boolean };
export type ResearchWork = {
  /** What the agent wrote down with `research_note`, newest note of an address last. */
  sources: ResearchSource[];
  /** Pages it opened with `web_read` that it has not noted (yet). */
  read: { url: string; running: boolean }[];
  searches: ResearchSearch[];
  /** A research tool is running now. */
  busy: boolean;
};

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (input: unknown, key: string): string => (isRecord(input) && typeof input[key] === 'string' ? (input[key] as string).trim() : '');
const answer = (item: ToolItem): string => item.content.find((c): c is Extract<typeof c, { type: 'text' }> => c.type === 'text')?.text ?? '';
const running = (item: ToolItem): boolean => item.status === 'in_progress' || item.status === 'pending';

/** What a deep research has found so far, read from the research tool calls of the conversation. */
export function collectResearch(items: readonly Item[]): ResearchWork {
  const notes = new Map<string, ResearchSource>();
  const reads = new Map<string, boolean>();
  const searches: ResearchSearch[] = [];
  let busy = false;
  for (const item of items) {
    if (item.kind !== 'tool') continue;
    const tool = researchTool(item);
    if (!tool) continue;
    if (running(item)) busy = true;
    if (tool === 'research_note') {
      const url = str(item.rawInput, 'url');
      const confidence = str(item.rawInput, 'confidence');
      if (!url || item.status === 'failed') continue;
      const step = isRecord(item.rawInput) && typeof item.rawInput['step'] === 'number' ? (item.rawInput['step'] as number) : undefined;
      notes.set(url, {
        url,
        title: str(item.rawInput, 'title') || url,
        finding: str(item.rawInput, 'finding'),
        confidence: confidence === 'high' || confidence === 'low' ? confidence : 'medium',
        ...(step !== undefined ? { step } : {}),
      });
    } else if (tool === 'web_read') {
      const url = str(item.rawInput, 'url');
      if (url && item.status !== 'failed') reads.set(url, running(item));
    } else if (tool === 'web_search') {
      const query = str(item.rawInput, 'query');
      if (!query) continue;
      searches.push({ query, engine: /^([^·\n]+?) ·/.exec(answer(item))?.[1]?.trim() ?? str(item.rawInput, 'engine'), running: running(item) });
    }
  }
  return {
    sources: [...notes.values()],
    read: [...reads].filter(([url]) => !notes.has(url)).map(([url, isRunning]) => ({ url, running: isRunning })),
    searches,
    busy,
  };
}

/** Whether there is anything to show. */
export const hasResearch = (w: ResearchWork): boolean => w.sources.length > 0 || w.read.length > 0 || w.searches.length > 0;
