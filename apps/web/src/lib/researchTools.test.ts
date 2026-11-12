import { beforeEach, describe, expect, it } from 'vitest';
import { setLanguageForTests } from '../i18n/index.ts';
import { isHiddenTool, researchLabel, researchTool } from './researchTools.ts';
import type { ToolItem } from './sessionState.ts';

beforeEach(() => setLanguageForTests('en'));

const call = (title: string, over: Partial<ToolItem> = {}): ToolItem => ({ kind: 'tool', key: 'k', id: 'k', title, toolKind: 'other', status: 'in_progress', content: [], ...over }) as ToolItem;

describe('research tool calls', () => {
  it('recognises the tools by their MCP names, however the agent spells the prefix', () => {
    expect(researchTool({ title: 'Run mcp_somecode_web_search' })).toBe('web_search');
    expect(researchTool({ title: 'mcp__somecode__research_note' })).toBe('research_note');
    expect(researchTool({ title: 'web_search' })).toBeNull();
    expect(researchTool({ title: 'Run mcp_other_web_search' })).toBeNull();
  });

  it('says what a search or a page read is doing, then what it did', () => {
    const search = call('Run mcp_somecode_web_search', { rawInput: { query: 'quickshell hyprland' } });
    expect(researchLabel(search)).toBe('Searching the web: quickshell hyprland');
    const done = call('Run mcp_somecode_web_search', { status: 'completed', rawInput: { query: 'quickshell hyprland' }, content: [{ type: 'text', text: 'Bing · "quickshell hyprland" · 10 results\n1. x' }] });
    expect(researchLabel(done)).toBe('Searched Bing: quickshell hyprland');
    expect(researchLabel(call('Run mcp_somecode_web_read', { rawInput: { url: 'https://github.com/foo/bar' } }))).toBe('Reading github.com/foo/bar');
    expect(researchLabel(call('Run mcp_somecode_research_note', { status: 'completed', rawInput: { title: 'Quickshell docs' } }))).toBe('Noted source: Quickshell docs');
  });

  it('hides plan bookkeeping and terminal start-up rows, but not real commands', () => {
    expect(isHiddenTool({ title: 'Run mcp_somecode_research_progress' })).toBe(true);
    expect(isHiddenTool({ title: 'Run mcp_somecode_research_plan' })).toBe(true);
    expect(isHiddenTool({ title: 'create_terminal' })).toBe(true);
    expect(isHiddenTool({ title: 'Terminal started' })).toBe(true);
    expect(isHiddenTool({ title: 'Run npm test' })).toBe(false);
    expect(isHiddenTool({ title: 'Run mcp_somecode_web_search' })).toBe(false);
  });
});
