import { describe, expect, it } from 'vitest';
import { collectResearch, hasResearch } from './researchSources.ts';
import type { Item } from './sessionState.ts';

const call = (id: string, name: string, rawInput: unknown, status = 'completed', text?: string): Item => ({
  kind: 'tool',
  key: id,
  id,
  title: `Run mcp_somecode_${name}`,
  toolKind: 'other',
  status,
  content: text ? [{ type: 'text', text }] : [],
  rawInput,
});

describe('collectResearch', () => {
  it('collects the noted sources (the last note of an address wins), the pages read and the searches', () => {
    const work = collectResearch([
      call('1', 'web_search', { query: 'quickshell' }, 'completed', 'Bing · "quickshell" · 5 results'),
      call('2', 'web_read', { url: 'https://a.example/doc' }),
      call('3', 'web_read', { url: 'https://b.example/other' }),
      call('4', 'research_note', { url: 'https://a.example/doc', title: 'Doc', finding: 'first', confidence: 'medium' }),
      call('5', 'research_note', { url: 'https://a.example/doc', title: 'Doc', finding: 'better', confidence: 'high', step: 2 }),
      call('6', 'web_search', { query: 'second try' }, 'in_progress'),
    ]);
    expect(work.sources).toEqual([{ url: 'https://a.example/doc', title: 'Doc', finding: 'better', confidence: 'high', step: 2 }]);
    expect(work.read).toEqual([{ url: 'https://b.example/other', running: false }]);
    expect(work.searches).toEqual([{ query: 'quickshell', engine: 'Bing', running: false }, { query: 'second try', engine: '', running: true }]);
    expect(work.busy).toBe(true);
    expect(hasResearch(work)).toBe(true);
  });

  it('ignores other tools, failed notes and unknown confidence values', () => {
    const work = collectResearch([
      { kind: 'agent', key: 'a', text: 'hello' },
      { kind: 'tool', key: 'x', id: 'x', title: 'Run npm test', toolKind: 'execute', status: 'completed', content: [] } as Item,
      call('2', 'research_note', { url: 'https://a.example', title: 'A', finding: 'f', confidence: 'weird' }),
      call('3', 'research_note', { url: 'https://b.example', title: 'B', finding: 'f', confidence: 'high' }, 'failed'),
    ]);
    expect(work.sources.map((s) => [s.title, s.confidence])).toEqual([['A', 'medium']]);
    expect(work.busy).toBe(false);
    expect(hasResearch(collectResearch([]))).toBe(false);
  });
});
