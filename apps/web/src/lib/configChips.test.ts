import type { ConfigOption } from '@somecode/protocol';
import { describe, expect, it } from 'vitest';
import { chipLabel, chipOrder } from './configChips.ts';

const opt = (id: string, category: string | undefined, currentValue: string, names: Record<string, string> = {}): ConfigOption => ({
  id,
  name: id[0]!.toUpperCase() + id.slice(1),
  ...(category ? { category } : {}),
  currentValue,
  choices: Object.keys({ [currentValue]: 1, ...names }).map((value) => ({ value, name: names[value] ?? value })),
});

describe('chipOrder', () => {
  it('puts mode, model and thought_level first, then everything else in the agent order', () => {
    const claude = [opt('agent', undefined, 'default'), opt('effort', 'thought_level', 'high'), opt('model', 'model', 'sonnet'), opt('mode', 'mode', 'auto')];
    expect(chipOrder(claude).map((o) => o.id)).toEqual(['mode', 'model', 'effort', 'agent']);
    const agy = [opt('model', 'model', 'a'), opt('thought_level', 'thought_level', 'low'), opt('mode', 'mode', 'default')];
    expect(chipOrder(agy).map((o) => o.id)).toEqual(['mode', 'model', 'thought_level']);
  });

  it('drops options without choices and tolerates null or empty input', () => {
    expect(chipOrder(null)).toEqual([]);
    expect(chipOrder([])).toEqual([]);
    expect(chipOrder([{ ...opt('model', 'model', 'a'), choices: [] }])).toEqual([]);
  });
});

describe('chipLabel', () => {
  it('shows the display name of the current choice', () => {
    expect(chipLabel(opt('model', 'model', 'sonnet', { sonnet: 'Sonnet 5.5' }))).toEqual({ name: 'Model', value: 'Sonnet 5.5' });
  });

  it('falls back to the raw value when the current value is not among the choices', () => {
    const odd = { ...opt('model', 'model', 'a'), currentValue: 'ghost' };
    expect(chipLabel(odd).value).toBe('ghost');
  });
});
