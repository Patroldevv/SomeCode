import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HighlightedLine } from '../lib/highlight.ts';
import { highlightTokens } from '../lib/highlight.ts';
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

  it('keeps mailto: and #fragment links (fragments stay in the same tab)', () => {
    render(<Markdown text="[m](mailto:x@y.z) [f](#bolum)" />);
    expect(screen.getByRole('link', { name: 'm' })).toHaveAttribute('href', 'mailto:x@y.z');
    const fragment = screen.getByRole('link', { name: 'f' });
    expect(fragment).toHaveAttribute('href', '#bolum');
    expect(fragment).not.toHaveAttribute('target');
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

  it('GFM footnotes and task lists render; footnote links stay in the page', () => {
    const { container } = render(<Markdown text={'note[^1]\n\n- [x] done\n\n[^1]: the footnote'} />);
    const ref = container.querySelector('sup a')!;
    expect(ref.getAttribute('href')).toMatch(/^#/);
    expect(ref).not.toHaveAttribute('target');
    expect(container.querySelector('input[type="checkbox"]')).toBeChecked();
    expect(container.textContent).toContain('the footnote');
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
});
