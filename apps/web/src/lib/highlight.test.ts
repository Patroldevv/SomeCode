import { describe, expect, it, vi } from 'vitest';

// Real Shiki (JS regex engine) in the node environment; `createHighlighterCore` is wrapped only to count
// creations. A plain counter (not vi.fn) because Vitest clears mock call history between tests.
const creations = vi.hoisted(() => ({ count: 0 }));
vi.mock('shiki/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('shiki/core')>();
  return {
    ...actual,
    createHighlighterCore: (...args: Parameters<typeof actual.createHighlighterCore>) => {
      creations.count++;
      return actual.createHighlighterCore(...args);
    },
  };
});

const { highlightTokens } = await import('./highlight.ts');

const joined = (lines: { text: string }[][]) => lines.map((line) => line.map((token) => token.text).join(''));

describe('highlightTokens', () => {
  it('returns coloured tokens whose text joins back to each input line', { timeout: 20_000 }, async () => {
    const code = 'const a: number = 1;\nfunction f(x: string) {\n  return x.length;\n}';
    const lines = await highlightTokens(code, 'ts');
    expect(lines).not.toBeNull();
    expect(joined(lines!)).toEqual(code.split('\n'));
    expect(lines!.flat().some((token) => typeof token.color === 'string' && token.color.startsWith('#'))).toBe(true);
  });

  it('resolves null for an unknown language or no language', async () => {
    expect(await highlightTokens('x', 'no-such-language')).toBeNull();
    expect(await highlightTokens('x', undefined)).toBeNull();
    expect(await highlightTokens('x', '')).toBeNull();
  });

  it('resolves aliases (typescript, shell, yml, md)', { timeout: 20_000 }, async () => {
    for (const [lang, code] of [
      ['typescript', 'let x = 1'],
      ['shell', 'echo "hi" | wc -l'],
      ['yml', 'a: 1\nb: [2, 3]'],
      ['md', '# Title\n\n*x*'],
    ] as const) {
      const lines = await highlightTokens(code, lang);
      expect(lines, lang).not.toBeNull();
      expect(joined(lines!), lang).toEqual(code.split('\n'));
    }
  });

  it('loads every supported language under the JavaScript regex engine', { timeout: 30_000 }, async () => {
    const labels = ['ts', 'tsx', 'js', 'jsx', 'json', 'bash', 'sh', 'shell', 'python', 'rust', 'go', 'css', 'html', 'markdown', 'yaml', 'diff', 'sql', 'c', 'cpp', 'java', 'toml', 'typescript', 'javascript', 'md', 'yml', 'TS'];
    for (const label of labels) {
      const code = 'a = 1\nb';
      const lines = await highlightTokens(code, label);
      expect(lines, label).not.toBeNull();
      expect(joined(lines!), label).toEqual(code.split('\n'));
    }
  });

  it('does not treat Object.prototype keys as languages', async () => {
    expect(await highlightTokens('x', 'constructor')).toBeNull();
    expect(await highlightTokens('x', '__proto__')).toBeNull();
  });

  it('creates the highlighter once and reuses it on later calls (also across languages)', async () => {
    await highlightTokens('{"a": 1}', 'json');
    await highlightTokens('print(1)', 'python');
    await highlightTokens('{"b": 2}', 'json');
    expect(creations.count).toBe(1);
  });
});
