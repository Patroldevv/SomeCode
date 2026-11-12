import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HighlightedLine } from '../lib/highlight.ts';
import { highlightTokens } from '../lib/highlight.ts';
import { COST_FACTOR, LARGE_CODE, MIN_GAP_MS, STABLE_MS } from './CodeBlock.tsx';
import { setLanguageForTests } from '../i18n/index.ts';
import { LocalImageProvider } from './LocalImage.tsx';
import { Markdown } from './Markdown.tsx';

// Deterministic: no real Shiki in jsdom (lib/highlight.test.ts covers it in node).
vi.mock('../lib/highlight.ts', () => ({ highlightTokens: vi.fn() }));
const highlight = vi.mocked(highlightTokens);

const red = (code: string): HighlightedLine[] => code.split('\n').map((text) => [{ text, color: '#ff0000' }]);

/** A promise per call that the test resolves by hand. */
function manualHighlight() {
  const calls: { code: string; resolve: (lines: HighlightedLine[] | null) => void }[] = [];
  highlight.mockImplementation(
    (code) =>
      new Promise((resolve) => {
        calls.push({ code, resolve });
      }),
  );
  return calls;
}

let consoleError: ReturnType<typeof vi.spyOn>;
let consoleWarn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  highlight.mockReset();
  highlight.mockResolvedValue(null);
  consoleError = vi.spyOn(console, 'error');
  consoleWarn = vi.spyOn(console, 'warn');
});

afterEach(() => {
  // Pristine output: no act(...) warnings, no React key/prop warnings.
  expect(consoleError).not.toHaveBeenCalled();
  expect(consoleWarn).not.toHaveBeenCalled();
  consoleError.mockRestore();
  consoleWarn.mockRestore();
});

describe('Markdown: untrusted links', () => {
  it('(a) renders a javascript: link as plain text, never as a link', () => {
    const { container } = render(<Markdown text="[x](javascript:alert(1))" />);
    expect(container.querySelector('a[href^="javascript"]')).toBeNull();
    expect(container.querySelector('a')).toBeNull();
    expect(screen.getByText('x')).toBeInTheDocument();
  });

  it.each([
    ['mixed case', '[x](JaVaScRiPt:alert(1))'],
    ['entity-encoded scheme', '[x](&#106;avascript:alert(1))'],
    ['percent-encoded scheme', '[x](%6Aavascript:alert(1))'],
    ['autolink', '<javascript:alert(1)>'],
    ['reference definition', '[x][r]\n\n[r]: javascript:alert(1)'],
    ['data: URL', '[x](data:text/html,<b>x</b>)'],
    ['vbscript', '[x](vbscript:msgbox)'],
    ['file', '[x](file:///etc/passwd)'],
    ['relative path', '[x](/etc/passwd)'],
    ['protocol-relative', '[x](//evil.example)'],
  ])('(a) never links a dangerous or relative URL: %s', (_name, text) => {
    const { container } = render(<Markdown text={text} />);
    expect(container.querySelector('a')).toBeNull();
    expect(container.innerHTML).not.toMatch(/href=/i);
  });

  it('(d) external links open in a new tab without opener or referrer', () => {
    render(<Markdown text="[ext](https://example.com/a)" />);
    const link = screen.getByRole('link', { name: 'ext' });
    expect(link).toHaveAttribute('href', 'https://example.com/a');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('keeps mailto: and in-document #user-content- anchors (same tab); other fragments are plain text', () => {
    render(<Markdown text="[m](mailto:x@y.z) [f](#user-content-fn-1) [b](#bolum) [tok](#token=evil)" />);
    expect(screen.getByRole('link', { name: 'm' })).toHaveAttribute('href', 'mailto:x@y.z');
    const fragment = screen.getByRole('link', { name: 'f' });
    expect(fragment).toHaveAttribute('href', '#user-content-fn-1');
    expect(fragment).not.toHaveAttribute('target');
    expect(screen.queryByRole('link', { name: 'b' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'tok' })).toBeNull();
    expect(screen.getByText('tok')).toBeInTheDocument();
  });

  it('GFM bare URLs become safe external links', () => {
    render(<Markdown text="see www.example.com now" />);
    const link = screen.getByRole('link', { name: 'www.example.com' });
    expect(link).toHaveAttribute('href', 'http://www.example.com');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });
});

describe('Markdown: raw HTML and images', () => {
  it('(b) raw HTML is shown as text, never as elements', () => {
    const text = '<script>alert(1)</script>\n\nhello <img src=x onerror=y> world';
    const { container } = render(<Markdown text={text} />);
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('[onerror]')).toBeNull();
    expect(container.textContent).toContain('<script>alert(1)</script>');
    expect(container.textContent).toContain('<img src=x onerror=y>');
  });

  it.each([
    '<a href="javascript:alert(1)">x</a>',
    '<iframe src="https://evil.example"></iframe>',
    '<svg onload=alert(1)>',
    '<div style="background:url(https://evil.example/t.png)">x</div>',
    '<details open ontoggle=alert(1)>',
  ])('(b) inline HTML %j stays text', (html) => {
    const { container } = render(<Markdown text={`a ${html} b`} />);
    expect(container.querySelector('a, iframe, svg, div[style], details')).toBeNull();
    expect(container.textContent).toContain(html);
  });

  it('(c) images are never rendered as <img>; the alt text is shown', () => {
    const { container } = render(<Markdown text="![alt](http://evil.example/p.png)" />);
    expect(container.querySelector('img')).toBeNull();
    expect(container.innerHTML).not.toContain('evil.example');
    expect(screen.getByText('alt')).toBeInTheDocument();
  });

  it('(c) reference images and images inside links do not fetch either', () => {
    const text = '![ref][i] and [![inner](https://evil.example/a.png)](https://example.com)\n\n[i]: https://evil.example/b.png';
    const { container } = render(<Markdown text={text} />);
    expect(container.querySelector('img')).toBeNull();
    expect(container.innerHTML).not.toContain('evil.example');
    expect(screen.getByText('ref')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'inner' })).toHaveAttribute('href', 'https://example.com');
  });
});

describe('Markdown: GFM and code', () => {
  it('keeps table cells readable: they do not inherit the break-anywhere rule that squeezes a column to one letter', () => {
    const { container } = render(<Markdown text={'| Alt Sistem | Puan |\n|---|---|\n| Oturum & Durum | 9.7 / 10 |'} />);
    const cells = [...container.querySelectorAll('th, td')];
    expect(cells).toHaveLength(4);
    for (const cell of cells) {
      expect(cell.className).toContain('[overflow-wrap:break-word]');
      expect(cell.className).toContain('[word-break:normal]');
      expect(cell.className).toContain('min-w-[4.5rem]');
    }
  });

  it('(e) renders a GFM table', () => {
    const { container } = render(<Markdown text={'| a | b |\n| - | - |\n| 1 | 2 |'} />);
    expect(container.querySelector('table')).not.toBeNull();
    expect(screen.getByRole('columnheader', { name: 'a' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: '2' })).toBeInTheDocument();
  });

  it('(f) an unterminated fence still shows its code inside <pre>', () => {
    const { container } = render(<Markdown text={'```ts\nconst a'} />);
    const pre = container.querySelector('pre');
    expect(pre).not.toBeNull();
    expect(pre!.textContent).toBe('const a');
    expect(highlight).toHaveBeenCalledWith('const a', 'ts');
  });

  it('(g) every prefix of a document renders without throwing (streaming)', () => {
    const doc = [
      '# Plan',
      '',
      'Some *emphasis*, **bold**, `inline` and a [link](https://example.com).',
      '',
      '1. first',
      '2. second with <b>html</b>',
      '',
      '| col | val |',
      '| --- | --- |',
      '| a | `b` |',
      '',
      '```ts',
      'export function f(x: number) {',
      '  return x * 2;',
      '}',
      '```',
      '',
      '> quote ![img](https://evil.example/x.png)',
      '',
      '- [ ] task',
      '- [x] done ~~gone~~',
    ].join('\n');
    const { container, rerender } = render(<Markdown text="" />);
    for (let i = 1; i <= doc.length; i++) {
      rerender(<Markdown text={doc.slice(0, i)} />);
    }
    expect(container.querySelector('h1')?.textContent).toBe('Plan');
    expect(container.querySelector('table')).not.toBeNull();
    expect(container.querySelector('pre')?.textContent).toBe('export function f(x: number) {\n  return x * 2;\n}');
    expect(container.querySelector('img')).toBeNull();
  });

  it('(h) a very long single-line code block scrolls inside its own container', () => {
    const long = 'x'.repeat(5000);
    const { container } = render(<Markdown text={'```\n' + long + '\n```'} />);
    const pre = container.querySelector('pre')!;
    expect(pre.textContent).toBe(long);
    expect(pre).toHaveClass('overflow-x-auto', 'whitespace-pre', 'max-w-full');
  });

  it('GFM footnotes and task lists render; footnote links and back-references resolve in the page', () => {
    const { container } = render(<Markdown text={'note[^1]\n\n- [x] done\n\n[^1]: the footnote'} />);
    const ref = container.querySelector<HTMLAnchorElement>('sup a')!;
    const target = ref.getAttribute('href')!;
    expect(target).toMatch(/^#./);
    expect(ref).not.toHaveAttribute('target');
    const footnote = container.querySelector(`[id="${target.slice(1)}"]`);
    expect(footnote?.tagName).toBe('LI');
    expect(footnote?.textContent).toContain('the footnote');

    // The back-reference points at the reference's own id.
    expect(ref.id).not.toBe('');
    const back = footnote!.querySelector('a')!;
    expect(back.getAttribute('href')).toBe(`#${ref.id}`);

    // GFM's English "Footnotes" heading stays screen-reader-only.
    const heading = container.querySelector('section h2')!;
    expect(heading).toHaveClass('sr-only');
    expect(heading.id).not.toBe('');
    expect(ref.getAttribute('aria-describedby')).toBe(heading.id);

    expect(container.querySelector('input[type="checkbox"]')).toBeChecked();
  });

  it('footnote labels follow the UI language (Turkish), the heading stays screen-reader-only', () => {
    setLanguageForTests('tr');
    try {
      const { container } = render(<Markdown text={'a[^1] b[^1]\n\n[^1]: not'} />);
      const heading = container.querySelector('section h2')!;
      expect(heading).toHaveTextContent('Dipnotlar');
      expect(heading).toHaveClass('sr-only');
      const backs = [...container.querySelectorAll('section li a')];
      expect(backs.map((a) => a.getAttribute('aria-label'))).toEqual([
        '1. göndermeye geri dön',
        '1-2. göndermeye geri dön',
      ]);
    } finally {
      setLanguageForTests(null);
    }
  });

  it('footnotes with non-word labels still link both ways', () => {
    const { container } = render(<Markdown text={'a[^Not.ä]\n\n[^Not.ä]: text'} />);
    const ref = container.querySelector<HTMLAnchorElement>('sup a');
    expect(ref).not.toBeNull();
    expect(container.querySelector('section li a')).not.toBeNull();
  });

  it('footnote labels in English', () => {
    setLanguageForTests('en');
    try {
      const { container } = render(<Markdown text={'a[^1]\n\n[^1]: note'} />);
      expect(container.querySelector('section h2')).toHaveTextContent('Footnotes');
      expect(container.querySelector('section li a')).toHaveAttribute('aria-label', 'Back to reference 1');
    } finally {
      setLanguageForTests(null);
    }
  });

  it('inline code is not a block', () => {
    const { container } = render(<Markdown text="use `npm test` here" />);
    expect(container.querySelector('pre')).toBeNull();
    expect(container.querySelector('code')?.textContent).toBe('npm test');
  });
});

describe('CodeBlock highlighting', () => {
  it('shows plain text first, then swaps to highlighted tokens with the same text', async () => {
    const calls = manualHighlight();
    const { container } = render(<Markdown text={'```ts\nconst a = 1\nlet b\n```'} />);
    const pre = container.querySelector('pre')!;
    expect(pre.textContent).toBe('const a = 1\nlet b');
    expect(pre.querySelector('span[style]')).toBeNull();

    await act(async () => calls[0]!.resolve(red('const a = 1\nlet b')));
    const coloured = pre.querySelectorAll<HTMLElement>('span[style]');
    expect(coloured).toHaveLength(2);
    expect(coloured[0]!.style.color).toBe('rgb(255, 0, 0)');
    expect(pre.textContent).toBe('const a = 1\nlet b');
  });

  it('ignores a result for text that has changed meanwhile', async () => {
    const calls = manualHighlight();
    const { container, rerender } = render(<Markdown text={'```ts\nabc\n```'} />);
    rerender(<Markdown text={'```ts\nxyz\n```'} />);
    await act(async () => calls[0]!.resolve(red('abc')));
    const pre = container.querySelector('pre')!;
    expect(pre.textContent).toBe('xyz');
    expect(pre.querySelector('span[style]')).toBeNull();
  });

  it('while streaming, keeps the highlighted prefix and appends the new tail as plain text', async () => {
    highlight.mockImplementation(async (code) => (code === 'const a' ? red(code) : new Promise(() => {})));
    const { container, rerender } = render(<Markdown text={'```ts\nconst a'} />);
    const pre = container.querySelector('pre')!;
    await act(async () => {});
    expect(pre.querySelectorAll('span[style]')).toHaveLength(1);

    rerender(<Markdown text={'```ts\nconst a = 1'} />);
    expect(pre.textContent).toBe('const a = 1');
    expect(pre.querySelector('span[style]')?.textContent).toBe('const a');
  });

  it('does not update state after unmount', async () => {
    const calls = manualHighlight();
    const { unmount } = render(<Markdown text={'```ts\nconst a\n```'} />);
    unmount();
    await act(async () => calls[0]!.resolve(red('const a')));
    // afterEach asserts that React logged nothing.
  });

  it('keeps plain text when highlighting fails or the language is unknown', async () => {
    highlight.mockRejectedValue(new Error('boom'));
    const { container } = render(<Markdown text={'```weird\nzzz\n```'} />);
    await act(async () => {});
    expect(container.querySelector('pre')!.textContent).toBe('zzz');
    expect(container.querySelector('pre span[style]')).toBeNull();
  });

  it('never highlights an empty block (a half-typed fence label would load the wrong grammar)', () => {
    render(<Markdown text={'```java'} />);
    render(<Markdown text={'```javascript\n```'} />);
    expect(highlight).not.toHaveBeenCalled();
  });
});

describe('CodeBlock scheduling while streaming (fake timers)', () => {
  const COST_MS = 500;

  /** A mocked highlighter whose every run "takes" COST_MS of fake time; records starts, ends and concurrency. */
  function costlyHighlight() {
    const runs: { code: string; start: number; end: number }[] = [];
    let active = 0;
    let maxActive = 0;
    highlight.mockImplementation(async (code) => {
      active++;
      maxActive = Math.max(maxActive, active);
      const start = Date.now();
      vi.advanceTimersByTime(COST_MS); // synchronous tokenising cost
      runs.push({ code, start, end: Date.now() });
      await Promise.resolve();
      active--;
      return red(code);
    });
    return { runs, maxActive: () => maxActive };
  }

  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const block = (code: string) => '```ts\n' + code;

  it('waits max(MIN_GAP, COST_FACTOR × last cost) after each run, runs one at a time, and highlights the final text', async () => {
    const h = costlyHighlight();
    let code = 'let a = 0;';
    const { container, rerender } = render(<Markdown text={block(code)} />);
    // 60 chunks, one every 50 ms (3 s of streaming).
    for (let i = 1; i <= 60; i++) {
      code += `\nlet v${i} = ${i};`;
      rerender(<Markdown text={block(code)} />);
      await act(async () => {
        vi.advanceTimersByTime(50);
      });
    }
    const whileStreaming = h.runs.length;

    // Stream stops: the trailing run highlights the final text.
    await act(async () => {
      vi.advanceTimersByTime(10_000);
    });

    expect(h.maxActive()).toBe(1);
    const gap = Math.max(MIN_GAP_MS, COST_FACTOR * COST_MS);
    for (let i = 1; i < h.runs.length; i++) {
      expect(h.runs[i]!.start - h.runs[i - 1]!.end).toBeGreaterThanOrEqual(gap);
    }
    // Without the cost-based gap this would be ~one run per chunk.
    expect(whileStreaming).toBeLessThanOrEqual(Math.ceil((60 * 50) / (COST_MS + gap)) + 1);
    expect(h.runs.at(-1)!.code).toBe(code);

    const pre = container.querySelector('pre')!;
    expect(pre.textContent).toBe(code);
    const highlightedText = [...pre.querySelectorAll('span[style]')].map((s) => s.textContent).join('\n');
    expect(highlightedText).toBe(code); // no plain tail left
  });

  it('keeps the highlighted prefix with a plain tail between runs (no flicker back to plain)', async () => {
    costlyHighlight();
    const { container, rerender } = render(<Markdown text={block('const a = 1;')} />);
    await act(async () => {});
    rerender(<Markdown text={block('const a = 1;\nconst b = 2;')} />);
    const pre = container.querySelector('pre')!;
    expect(pre.textContent).toBe('const a = 1;\nconst b = 2;');
    expect(pre.querySelector('span[style]')?.textContent).toBe('const a = 1;');
  });

  it('highlights a large block only once its text has been stable for STABLE_MS', async () => {
    const h = costlyHighlight();
    const line = 'x'.repeat(99) + '\n';
    let code = line.repeat(Math.ceil(LARGE_CODE / line.length) + 1);
    const { rerender } = render(<Markdown text={block(code)} />);
    for (let i = 0; i < 20; i++) {
      code += line;
      rerender(<Markdown text={block(code)} />);
      await act(async () => {
        vi.advanceTimersByTime(STABLE_MS - 50);
      });
    }
    expect(h.runs).toHaveLength(0);
    await act(async () => {
      vi.advanceTimersByTime(STABLE_MS);
    });
    expect(h.runs.map((r) => r.code)).toEqual([code.replace(/\n$/, '')]);
  });

  it('does not run a pending highlight after unmount', async () => {
    const h = costlyHighlight();
    const { rerender, unmount } = render(<Markdown text={block('a')} />);
    await act(async () => {});
    rerender(<Markdown text={block('a\nb')} />); // trailing run is waiting for its gap
    unmount();
    await act(async () => {
      vi.advanceTimersByTime(10_000);
    });
    expect(h.runs).toHaveLength(1);
  });
});

describe('pictures given as a file path', () => {
  it('asks the loader for them and shows them as a screenshot; the alt text stays while loading and when it fails', async () => {
    const load = vi.fn(async (path: string) => (path.endsWith('ok.png') ? { data: 'AAAA', mimeType: 'image/png' } : null));
    render(
      <LocalImageProvider value={load}>
        <Markdown text={'![Shot one](/home/me/ok.png)\n\n![Missing](/home/me/gone.png)'} />
      </LocalImageProvider>,
    );
    expect(await screen.findByRole('img', { name: 'Shot one' })).toHaveAttribute('src', 'data:image/png;base64,AAAA');
    expect(await screen.findByText('Missing')).toBeInTheDocument();
    expect(load).toHaveBeenCalledWith('/home/me/ok.png');
  });

  it('still never turns a web image into a request', () => {
    const load = vi.fn();
    render(
      <LocalImageProvider value={load}>
        <Markdown text={'![Remote](https://example.com/a.png)'} />
      </LocalImageProvider>,
    );
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.getByText('Remote')).toBeInTheDocument();
    expect(load).not.toHaveBeenCalled();
  });
});
