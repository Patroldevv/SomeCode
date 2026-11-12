import type { ConfigOption } from '@somecode/protocol';
import { describe, expect, it } from 'vitest';
import { researchInstructions } from './instructions.ts';
import { DEEP_RESEARCH, plainValueOf, withResearchMode } from './mode.ts';

const mode: ConfigOption = { id: 'mode', name: 'Mode', category: 'mode', currentValue: 'default', choices: [{ value: 'default', name: 'Default' }, { value: 'plan', name: 'Plan' }] };
const model: ConfigOption = { id: 'model', name: 'Model', category: 'model', currentValue: 'a', choices: [{ value: 'a', name: 'A' }] };

describe('withResearchMode', () => {
  it('adds deep research to the mode menu only, once, and shows it as current while it is on', () => {
    const [m, other] = withResearchMode([mode, model], false);
    expect(m!.choices.map((c) => c.value)).toEqual(['default', 'plan', DEEP_RESEARCH]);
    expect(m!.currentValue).toBe('default');
    expect(other).toBe(model);
    const on = withResearchMode(withResearchMode([mode], false), true)[0]!;
    expect(on.choices.filter((c) => c.value === DEEP_RESEARCH)).toHaveLength(1);
    expect(on.currentValue).toBe(DEEP_RESEARCH);
  });
  it('leaves an agent with no mode menu alone', () => {
    expect(withResearchMode([model], true)).toEqual([model]);
  });
  it('picks the plain value of the agent to hold it in', () => {
    expect(plainValueOf(mode)).toBe('default');
    expect(plainValueOf({ ...mode, choices: [{ value: 'plan', name: 'Plan' }, { value: 'x', name: 'X' }] })).toBe('plan');
  });
});

describe('researchInstructions', () => {
  it('names the tools that exist and no others', () => {
    const none = researchInstructions({ browser: 'off', scout: false, memory: false });
    expect(none).not.toContain('browser_open');
    expect(none).not.toContain('scout');
    expect(none).not.toContain('memory_add');
    const all = researchInstructions({ browser: 'any', scout: true, memory: true });
    expect(all).toContain('browser_open');
    expect(all).toContain('`scout`');
    expect(all).toContain('Sources');
  });

  it('with the research tools: plan first, several engines and phrasings, a ledger and a coverage check', () => {
    const text = researchInstructions({ browser: 'any', scout: false, memory: true, tools: true, plan: true, depth: 'exhaustive', engines: ['google', 'yandex', 'bing'] });
    for (const needle of ['site_inspect', 'research_plan', 'research_progress', 'web_search', 'web_read', 'research_note', 'research_status', 'Yandex', 'memory_add']) expect(text).toContain(needle);
    expect(text).toContain('25 noted sources');
    expect(text).toContain('wait for the answer');
    const local = researchInstructions({ browser: 'local', scout: false, memory: false, tools: true, plan: false });
    expect(local).not.toContain('web_search');
    expect(local).not.toContain('wait for the answer');
    expect(local).not.toContain('memory_add');
  });
});
